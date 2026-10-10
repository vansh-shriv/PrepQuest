import { describe, expect, it } from "vitest";
import {
  runJob,
  type JobSummary,
  type JudgeJob,
  type JudgeTest,
  type Language,
} from "@prepquest/judge-core";
import { IsolateSandbox } from "./isolate.js";

// The "malicious program" suite (doc 12 §14, doc 16). It needs a Linux container with `isolate`:
//   docker run --rm --privileged -e JUDGE_ISOLATE_TESTS=1 -e JUDGE_CGROUPS=true prepquest-judge \
//     pnpm --filter @prepquest/judge exec vitest run src/sandbox/isolate.container.test.ts
// Everywhere else it is skipped.
const enabled = process.env.JUDGE_ISOLATE_TESTS === "1";
const cgroups = process.env.JUDGE_CGROUPS === "true";

const sandbox = enabled
  ? new IsolateSandbox({ bin: process.env.ISOLATE_BIN ?? "isolate", cgroups, boxIds: [0, 1, 2, 3] })
  : (undefined as never);

const signature = {
  function: "twice",
  params: [{ name: "n", type: "int" as const }],
  returns: "int" as const,
};
const tests: JudgeTest[] = [{ ordinal: 1, kind: "custom", customInput: "21\n" }];
const GOOD_PY = "class Solution:\n    def twice(self, n):\n        return n * 2\n";

async function judge(
  language: Language,
  code: string,
  limits = { timeMs: 1000, memoryKb: 128 * 1024 },
): Promise<JobSummary> {
  const job: JudgeJob = {
    submissionId: "mal",
    kind: "run",
    language,
    code,
    signature,
    checker: { type: "exact" },
    limits,
    tests,
  };
  return runJob(job, {
    sandbox,
    loadTest: async (t) => ({ input: Buffer.from(t.customInput ?? "") }),
    emit: () => undefined,
  });
}

/** After every attack the sandbox must still be usable. */
async function stillHealthy() {
  const ok = await judge("python", GOOD_PY);
  expect(ok.verdict).toBe("AC");
  expect(ok.results[0]?.stdoutTail).toBe("42\n");
}

const py = (payload: string) => `${payload}\n${GOOD_PY}`;
const run = enabled ? it : it.skip;

describe("isolate: well-behaved programs", () => {
  const CPP = "class Solution {\npublic:\n    int twice(int n) { return n * 2; }\n};\n";
  const JAVA = "class Solution {\n    public int twice(int n) { return n * 2; }\n}\n";

  run("runs Python, C++ and Java solutions", async () => {
    for (const [language, code] of [
      ["python", GOOD_PY],
      ["cpp", CPP],
      ["java", JAVA],
    ] as const) {
      const r = await judge(language, code, { timeMs: 5000, memoryKb: 256 * 1024 });
      expect(r, language).toMatchObject({ verdict: "AC" });
      expect(r.results[0]?.stdoutTail, language).toBe("42\n");
    }
  });

  run("measures time and memory", async () => {
    const r = await judge("python", GOOD_PY);
    expect(r.timeMs).not.toBeNull();
    if (cgroups) expect(r.memoryKb).toBeGreaterThan(0);
  });

  run("a Java program that exhausts its heap is MLE", async () => {
    const hog = JAVA.replace(
      "return n * 2;",
      "java.util.List<long[]> l = new java.util.ArrayList<>(); while (true) l.add(new long[1 << 20]);",
    );
    const r = await judge("java", hog, { timeMs: 5000, memoryKb: 128 * 1024 });
    expect(["MLE", "RE"]).toContain(r.verdict);
    await stillHealthy();
  });
});

describe("isolate: malicious programs", () => {
  run("an infinite loop is TLE and does not hang the worker", async () => {
    const started = Date.now();
    const r = await judge("python", py("while True:\n    pass"), {
      timeMs: 500,
      memoryKb: 128 * 1024,
    });
    expect(r.verdict).toBe("TLE");
    expect(Date.now() - started).toBeLessThan(8000);
    await stillHealthy();
  });

  run("sleeping past the wall-clock limit is TLE", async () => {
    const r = await judge("python", py("import time\ntime.sleep(30)"), {
      timeMs: 500,
      memoryKb: 128 * 1024,
    });
    expect(r.verdict).toBe("TLE");
    await stillHealthy();
  });

  run("a fork bomb is contained", async () => {
    const r = await judge("python", py("import os\nwhile True:\n    os.fork()"), {
      timeMs: 1000,
      memoryKb: 128 * 1024,
    });
    expect(["RE", "TLE", "MLE"]).toContain(r.verdict);
    await stillHealthy();
  });

  run("allocating far more memory than allowed is MLE (or RE)", async () => {
    const r = await judge(
      "python",
      py("data = []\nwhile True:\n    data.append(bytearray(10 * 1024 * 1024))"),
      { timeMs: 3000, memoryKb: 64 * 1024 },
    );
    expect(["MLE", "RE"]).toContain(r.verdict);
    if (cgroups) expect(r.verdict).toBe("MLE");
    await stillHealthy();
  });

  run("flooding stdout is OLE", async () => {
    const r = await judge(
      "python",
      py("import sys\nwhile True:\n    sys.stdout.write('x' * 65536)"),
      { timeMs: 3000, memoryKb: 128 * 1024 },
    );
    expect(["OLE", "TLE"]).toContain(r.verdict);
    await stillHealthy();
  });

  run("cannot read the host's files", async () => {
    const r = await judge(
      "python",
      py("import sys\nsys.stderr.write(open('/app/package.json').read())"),
    );
    expect(r.verdict).toBe("RE");
    expect(r.stderrTail ?? "").not.toContain('"name"');
    const passwd = await judge(
      "python",
      py("import sys\nsys.stderr.write(open('/etc/shadow').read())"),
    );
    expect(passwd.verdict).toBe("RE");
  });

  run("cannot write outside its box", async () => {
    const r = await judge("python", py("open('/usr/pwned', 'w').write('x')"));
    expect(r.verdict).toBe("RE");
    const home = await judge("python", py("open('/root/pwned', 'w').write('x')"));
    expect(home.verdict).toBe("RE");
  });

  run("has no network (cannot reach Redis or the internet)", async () => {
    const code = py(
      [
        "import socket",
        "s = socket.socket()",
        "s.settimeout(1)",
        "s.connect(('127.0.0.1', 6379))",
      ].join("\n"),
    );
    const r = await judge("python", code);
    expect(r.verdict).toBe("RE");
    const dns = await judge(
      "python",
      py("import socket\nsocket.create_connection(('1.1.1.1', 53), timeout=1)"),
    );
    expect(dns.verdict).toBe("RE");
  });

  run("cannot see other processes or the worker's environment", async () => {
    const r = await judge(
      "python",
      py(
        "import os, sys\nsys.stderr.write('REDIS=' + os.environ.get('REDIS_URL', 'none') + ' pids=' + str(len(os.listdir('/proc'))))\nraise SystemExit(3)",
      ),
    );
    expect(r.verdict).toBe("RE");
    expect(r.stderrTail ?? "").toContain("REDIS=none");
  });

  run("a huge file write is stopped", async () => {
    const r = await judge(
      "python",
      py("f = open('big', 'wb')\nwhile True:\n    f.write(b'x' * 1048576)\n    f.flush()"),
      { timeMs: 3000, memoryKb: 128 * 1024 },
    );
    expect(["OLE", "RE", "TLE"]).toContain(r.verdict);
    await stillHealthy();
  });

  run("runaway recursion is a runtime error, not a crash", async () => {
    const r = await judge(
      "python",
      py("import sys\nsys.setrecursionlimit(10**9)\ndef f(n):\n    return f(n + 1)\nf(0)"),
      { timeMs: 3000, memoryKb: 128 * 1024 },
    );
    expect(["RE", "MLE", "TLE"]).toContain(r.verdict);
    await stillHealthy();
  });

  run("a compile bomb or hostile include cannot leak files", async () => {
    const include = await judge("cpp", '#include "/etc/shadow"\nclass Solution {};');
    expect(include.verdict).toBe("CE");
    const loop = await judge(
      "cpp",
      "template<int N> struct T { static const int v = T<N + 1>::v; };\nint x = T<0>::v;\nclass Solution {};",
    );
    expect(["CE"]).toContain(loop.verdict);
    await stillHealthy();
  });

  run("concurrent jobs never share a box", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        judge(
          "python",
          py(
            `open('mark${i}', 'w').write('${i}')\nimport glob, sys\nsys.stderr.write(str(len(glob.glob('mark*'))))`,
          ),
        ),
      ),
    );
    for (const r of results) expect(r.results[0]?.stderrTail).toBe("1");
  });
});
