import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runJob,
  type JudgeEvent,
  type JudgeJob,
  type JudgeTest,
  type Language,
  type Signature,
} from "@prepquest/judge-core";
import { ProcessSandbox } from "./sandbox/process.js";

// Runs every shipped problem's committed tests through the real per-language drivers, using the
// reference solutions as "user code". This ties the judge drivers to the canonical I/O contract.

const problemsDir = path.resolve(import.meta.dirname, "../../../content/problems");
const slugs = readdirSync(problemsDir).filter((d) =>
  existsSync(path.join(problemsDir, d, "signature.json")),
);

const has = (cmd: string, args: string[]) => {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const available: Record<Language, boolean> = {
  python: has(process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3"), [
    "--version",
  ]),
  cpp: has(process.env.CXX_BIN ?? "g++", ["--version"]),
  java: has("javac", ["-version"]) && has("java", ["-version"]),
};

const EXT: Record<Language, string> = { python: "py", cpp: "cpp", java: "java" };

function load(slug: string, language: Language) {
  const dir = path.join(problemsDir, slug);
  const file = path.join(dir, "solutions", `ref.${EXT[language]}`);
  if (!existsSync(file)) return null;
  const signature = JSON.parse(readFileSync(path.join(dir, "signature.json"), "utf8")) as Signature;
  const manifest = JSON.parse(
    readFileSync(path.join(dir, "tests", "manifest.json"), "utf8"),
  ) as Array<{
    ordinal: number;
    kind: JudgeTest["kind"];
  }>;
  const files = new Map<string, Buffer>();
  const tests: JudgeTest[] = manifest.map((m) => {
    const n = String(m.ordinal).padStart(2, "0");
    files.set(`${m.ordinal}.in`, readFileSync(path.join(dir, "tests", `${n}.in`)));
    files.set(`${m.ordinal}.out`, readFileSync(path.join(dir, "tests", `${n}.out`)));
    return {
      ordinal: m.ordinal,
      kind: m.kind,
      inputKey: `${m.ordinal}.in`,
      outputKey: `${m.ordinal}.out`,
    };
  });
  return { code: readFileSync(file, "utf8"), signature, tests, files };
}

async function judge(slug: string, language: Language) {
  const data = load(slug, language);
  if (!data) return null;
  const job: JudgeJob = {
    submissionId: "t",
    kind: "submit",
    language,
    code: data.code,
    signature: data.signature,
    checker: { type: "exact" },
    limits: { timeMs: 10_000, memoryKb: 512 * 1024 },
    tests: data.tests,
  };
  const events: JudgeEvent[] = [];
  const summary = await runJob(job, {
    sandbox: new ProcessSandbox(),
    loadTest: async (t) => ({
      input: data.files.get(t.inputKey as string) as Buffer,
      expected: data.files.get(t.outputKey as string) as Buffer,
    }),
    emit: (e) => void events.push(e),
  });
  return { summary, events };
}

describe.each(["python", "cpp", "java"] as const)("%s driver", (language) => {
  const run = available[language] ? it : it.skip;
  for (const slug of slugs) {
    if (!existsSync(path.join(problemsDir, slug, "solutions", `ref.${EXT[language]}`))) continue;
    run(`${slug}: reference solution passes every committed test`, async () => {
      const out = await judge(slug, language);
      expect(out?.summary.compileOutput).toBeNull();
      expect(out?.summary.stderrTail).toBeNull();
      expect(out?.summary.verdict).toBe("AC");
      expect(out?.summary.passed).toBe(out?.summary.total);
    });
  }
});
