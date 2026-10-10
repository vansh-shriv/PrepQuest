import { describe, expect, it } from "vitest";
import {
  runJob,
  type JudgeEvent,
  type JudgeJob,
  type JudgeTest,
  type Language,
  type Sandbox,
} from "@prepquest/judge-core";
import { ProcessSandbox } from "./sandbox/process.js";

// Verdict behaviour of the whole pipeline (driver + sandbox + checker), with small Python programs.
// `double(n)` reads one int and returns twice it.

const signature = {
  function: "double",
  params: [{ name: "n", type: "int" as const }],
  returns: "int" as const,
};
const GOOD = "class Solution:\n    def double(self, n):\n        return n * 2\n";

const sample = (
  ordinal: number,
  n: number,
  out = n * 2,
): [JudgeTest, { input: string; expected: string }] => [
  { ordinal, kind: "sample" },
  { input: `${n}\n`, expected: `${out}\n` },
];
const hidden = (
  ordinal: number,
  n: number,
  out = n * 2,
): [JudgeTest, { input: string; expected: string }] => [
  { ordinal, kind: "hidden" },
  { input: `${n}\n`, expected: `${out}\n` },
];

async function judge(
  code: string,
  cases: Array<[JudgeTest, { input: string; expected?: string }]>,
  over: Partial<JudgeJob> = {},
  sandbox: Sandbox = new ProcessSandbox(),
  language: Language = "python",
) {
  const data = new Map(cases.map(([t, d]) => [t.ordinal, d]));
  const events: JudgeEvent[] = [];
  const job: JudgeJob = {
    submissionId: "s",
    kind: "submit",
    language,
    code,
    signature,
    checker: { type: "exact" },
    limits: { timeMs: 1000, memoryKb: 256 * 1024 },
    tests: cases.map(([t]) => t),
    ...over,
  };
  const summary = await runJob(job, {
    sandbox,
    loadTest: async (t) => {
      const d = data.get(t.ordinal);
      if (!d) throw new Error("missing test");
      return {
        input: Buffer.from(d.input),
        ...(d.expected !== undefined ? { expected: Buffer.from(d.expected) } : {}),
      };
    },
    emit: (e) => void events.push(e),
  });
  const results = events.flatMap((e) => (e.type === "test" ? [e.result] : []));
  return { summary, events, results };
}

describe("verdicts", () => {
  it("accepts a correct solution and reports progress", async () => {
    const { summary, events, results } = await judge(GOOD, [sample(1, 2), hidden(2, 21)]);
    expect(summary).toMatchObject({ verdict: "AC", passed: 2, total: 2, failingOrdinal: null });
    expect(events.map((e) => e.type)).toEqual(["stage", "stage", "test", "test"]);
    expect(events[0]).toMatchObject({ stage: "COMPILING", total: 2 });
    expect(events[1]).toMatchObject({ stage: "RUNNING" });
    expect(results.every((r) => r.verdict === "AC")).toBe(true);
  });

  it("reports WA with a message on samples but never leaks hidden data", async () => {
    const wrong = "class Solution:\n    def double(self, n):\n        return n * 3\n";
    const { summary, results } = await judge(wrong, [sample(1, 2), hidden(2, 5)], { kind: "run" });
    expect(summary).toMatchObject({ verdict: "WA", passed: 0, failingOrdinal: 1 });
    const [s, h] = results;
    expect(s?.checkerMsg).toBe('Line 1: expected "4" but got "6".');
    expect(s?.stdoutTail).toBe("6\n");
    expect(s?.inputPreview).toBe("2\n");
    expect(s?.expectedPreview).toBe("4\n");
    expect(h?.verdict).toBe("WA");
    expect(h?.checkerMsg).toBe("Wrong answer on a hidden test.");
    expect(h?.stdoutTail).toBeUndefined();
    expect(h?.inputPreview).toBeUndefined();
    expect(h?.expectedPreview).toBeUndefined();
  });

  it("stops a submission at the first failure but runs every test of a run", async () => {
    const wrong = "class Solution:\n    def double(self, n):\n        return 0\n";
    const cases = [sample(1, 1), hidden(2, 2), hidden(3, 3)];
    const submit = await judge(wrong, cases, { kind: "submit" });
    expect(submit.results).toHaveLength(1);
    expect(submit.summary).toMatchObject({ verdict: "WA", passed: 0, total: 3 });
    const run = await judge(wrong, cases, { kind: "run" });
    expect(run.results).toHaveLength(3);
  });

  it("reports a runtime error with the error text", async () => {
    const boom = "class Solution:\n    def double(self, n):\n        return [][3]\n";
    const { summary, results } = await judge(boom, [hidden(1, 4)]);
    expect(summary.verdict).toBe("RE");
    expect(summary.stderrTail).toContain("IndexError");
    expect(results[0]?.stdoutTail).toBeUndefined();
  });

  it("reports RE when the function returns nothing", async () => {
    const none = "class Solution:\n    def double(self, n):\n        pass\n";
    const { summary } = await judge(none, [sample(1, 4)]);
    expect(summary.verdict).toBe("RE");
    expect(summary.stderrTail).toContain("returned None");
  });

  it("reports TLE for an infinite loop and stays responsive", async () => {
    const spin =
      "class Solution:\n    def double(self, n):\n        while True:\n            pass\n";
    const started = Date.now();
    const { summary } = await judge(spin, [hidden(1, 1)], {
      limits: { timeMs: 300, memoryKb: 256 * 1024 },
    });
    expect(summary.verdict).toBe("TLE");
    expect(Date.now() - started).toBeLessThan(8000);
  });

  it("reports CE with a cleaned compiler message", async () => {
    const { summary, results } = await judge(
      "class Solution { oops",
      [sample(1, 1)],
      {},
      new ProcessSandbox(),
      "cpp",
    );
    expect(summary.verdict).toBe("CE");
    expect(results).toHaveLength(0);
    expect(summary.compileOutput).toMatch(/error/);
    expect(summary.compileOutput).not.toMatch(/pq-box/);
  });

  it("applies a float checker", async () => {
    const half = "class Solution:\n    def double(self, n):\n        return n / 2\n";
    const sig = { ...signature, returns: "double" as const };
    const near = await judge(half, [hidden(1, 1, 0.5)], {
      signature: sig,
      checker: { type: "float", epsilon: 1e-6 },
    });
    expect(near.summary.verdict).toBe("AC");
  });

  it("runs custom inputs without a checker and shows their output", async () => {
    const { summary, results } = await judge(
      GOOD,
      [[{ ordinal: 101, kind: "custom" }, { input: "21\n" }]],
      { kind: "run" },
    );
    expect(summary.verdict).toBe("AC");
    expect(results[0]).toMatchObject({ kind: "custom", stdoutTail: "42\n", inputPreview: "21\n" });
    expect(results[0]?.expectedPreview).toBeUndefined();
  });

  it("returns IE (never a user verdict) when the infrastructure fails", async () => {
    const broken: Sandbox = {
      create: async () => {
        throw new Error("no boxes available");
      },
    };
    const { summary } = await judge(GOOD, [sample(1, 1)], {}, broken);
    expect(summary.verdict).toBe("IE");
    const missing = await judge(GOOD, [sample(1, 1)]);
    expect(missing.summary.verdict).toBe("AC");
  });

  it("reports IE when a test file cannot be loaded", async () => {
    const job: JudgeJob = {
      submissionId: "s",
      kind: "submit",
      language: "python",
      code: GOOD,
      signature,
      checker: { type: "exact" },
      limits: { timeMs: 1000, memoryKb: 1024 },
      tests: [{ ordinal: 1, kind: "hidden", inputKey: "nope.in", outputKey: "nope.out" }],
    };
    const summary = await runJob(job, {
      sandbox: new ProcessSandbox(),
      loadTest: async () => {
        throw new Error("not found");
      },
      emit: () => undefined,
    });
    expect(summary.verdict).toBe("IE");
    expect(summary.stderrTail).toContain("could not load test 1");
  });
});

describe("process sandbox", () => {
  it("kills runaway output and cleans up its directory", async () => {
    const sandbox = new ProcessSandbox();
    const box = await sandbox.create();
    await box.writeFile("main.py", "import sys\nwhile True:\n    sys.stdout.write('x' * 65536)\n");
    const res = await box.exec({
      argv: ["python3", "-S", "-B", "main.py"],
      stdin: null,
      cpuMs: 5000,
      wallMs: 10_000,
      memoryKb: 1024 * 1024,
      processes: 1,
      outputLimit: 1024 * 1024,
    });
    expect(res.status).toBe("output_limit");
    expect(res.stdout.length).toBeLessThanOrEqual(1024 * 1024);
    await box.cleanup();
    const { existsSync } = await import("node:fs");
    expect(existsSync(box.dir)).toBe(false);
  });
});
