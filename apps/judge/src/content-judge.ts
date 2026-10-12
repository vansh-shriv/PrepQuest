import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  runJob,
  type FinalVerdict,
  type JobSummary,
  type JudgeJob,
  type JudgeTest,
  type Language,
  type Signature,
} from "@prepquest/judge-core";
import { ProcessSandbox } from "./sandbox/process.js";

// Runs the content repository's solutions through the real judge pipeline: reference solutions in every
// language they exist in, editorial code, and mutants (known-wrong solutions that the tests must catch).
// Used by the vitest suite and by `pnpm content:judge` (the CI content gate).

export const EXT: Record<Language, string> = { python: "py", cpp: "cpp", java: "java" };

const works = (cmd: string, args: string[]) => {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** Whether this machine can compile and run `language` (the process sandbox needs the real toolchains). */
export const toolchainAvailable: Record<Language, boolean> = {
  python: works(process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3"), [
    "--version",
  ]),
  cpp: works(process.env.CXX_BIN ?? "g++", ["--version"]),
  java: works("javac", ["-version"]) && works("java", ["-version"]),
};

export interface ProblemFixture {
  slug: string;
  dir: string;
  signature: Signature;
  tests: Array<JudgeTest & { input: Buffer; expected: Buffer }>;
  limits: { timeMs: number; memoryKb: number };
  checker: "exact" | "tokens" | "float";
}

export function findProblemsDir(from = import.meta.dirname): string {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, "content", "problems");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("content/problems not found");
    dir = parent;
  }
}

export function listSlugs(problemsDir = findProblemsDir()): string[] {
  return readdirSync(problemsDir)
    .filter((d) => existsSync(path.join(problemsDir, d, "signature.json")))
    .sort();
}

export function loadFixture(slug: string, problemsDir = findProblemsDir()): ProblemFixture {
  const dir = path.join(problemsDir, slug);
  const read = (p: string) => readFileSync(path.join(dir, p), "utf8");
  const meta = JSON.parse(read("meta.json")) as {
    checker?: ProblemFixture["checker"];
    limits?: { timeLimitMs: number; memoryLimitKb: number };
  };
  const manifest = JSON.parse(read("tests/manifest.json")) as Array<{
    ordinal: number;
    kind: JudgeTest["kind"];
    label?: string;
  }>;
  return {
    slug,
    dir,
    signature: JSON.parse(read("signature.json")) as Signature,
    checker: meta.checker ?? "exact",
    limits: {
      timeMs: meta.limits?.timeLimitMs ?? 1000,
      memoryKb: meta.limits?.memoryLimitKb ?? 262_144,
    },
    tests: manifest.map((m) => {
      const n = String(m.ordinal).padStart(2, "0");
      return {
        ordinal: m.ordinal,
        kind: m.kind,
        ...(m.label ? { label: m.label } : {}),
        input: readFileSync(path.join(dir, "tests", `${n}.in`)),
        expected: readFileSync(path.join(dir, "tests", `${n}.out`)),
      };
    }),
  };
}

/** The same per-language multipliers the importer applies (doc 12 section 3). */
export function limitsFor(language: Language, base: { timeMs: number; memoryKb: number }) {
  if (language === "python") return { timeMs: base.timeMs * 5, memoryKb: base.memoryKb };
  if (language === "java") return { timeMs: base.timeMs * 2 + 300, memoryKb: base.memoryKb * 2 };
  return base;
}

export interface JudgeOptions {
  /** Only the first `n` tests (samples come first). */
  firstTests?: number;
  /** `submit` stops at the first failure (default); `run` judges every test. */
  kind?: "submit" | "run";
  /** Use the problem's base time limit without the per-language multiplier (for slow-solution mutants). */
  baseLimit?: boolean;
}

export async function judgeCode(
  fixture: ProblemFixture,
  language: Language,
  code: string,
  options: JudgeOptions = {},
): Promise<JobSummary> {
  const tests = fixture.tests.slice(0, options.firstTests ?? fixture.tests.length);
  const byOrdinal = new Map(tests.map((t) => [t.ordinal, t]));
  const job: JudgeJob = {
    submissionId: "content",
    kind: options.kind ?? "submit",
    language,
    code,
    signature: fixture.signature,
    checker: { type: fixture.checker },
    limits: options.baseLimit ? fixture.limits : limitsFor(language, fixture.limits),
    tests: tests.map(({ ordinal, kind, label }) => ({
      ordinal,
      kind,
      ...(label ? { label } : {}),
    })),
  };
  return runJob(job, {
    sandbox: new ProcessSandbox(),
    loadTest: async (t) => {
      const f = byOrdinal.get(t.ordinal) as ProblemFixture["tests"][number];
      return { input: f.input, expected: f.expected };
    },
    emit: () => undefined,
  });
}

export interface Mutant {
  name: string;
  expect: FinalVerdict;
  code: string;
}

export function loadMutants(slug: string, problemsDir = findProblemsDir()): Mutant[] {
  const dir = path.join(problemsDir, slug, "solutions", "mutants");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".py"))
    .sort()
    .map((f) => {
      const code = readFileSync(path.join(dir, f), "utf8");
      const expect = /^#\s*expect:\s*(\w+)/m.exec(code)?.[1] as FinalVerdict | undefined;
      if (!expect) throw new Error(`${slug}/${f}: missing "# expect: <VERDICT>" header`);
      return { name: f.replace(/\.py$/, ""), expect, code };
    });
}

export interface EditorialSnippet {
  approach: string;
  language: Language;
  code: string;
}

/** Inline editorial code (references to solution files are covered by the reference check). */
export function loadEditorialSnippets(
  slug: string,
  problemsDir = findProblemsDir(),
): EditorialSnippet[] {
  const file = path.join(problemsDir, slug, "editorial.json");
  if (!existsSync(file)) return [];
  const doc = JSON.parse(readFileSync(file, "utf8")) as {
    approaches: Array<{ name: string; code: Record<string, string | { file: string }> }>;
  };
  return doc.approaches.flatMap((a) =>
    Object.entries(a.code).flatMap(([language, code]) =>
      typeof code === "string" ? [{ approach: a.name, language: language as Language, code }] : [],
    ),
  );
}

export function referenceFiles(
  slug: string,
  problemsDir = findProblemsDir(),
): Array<{ language: Language; code: string }> {
  return (Object.keys(EXT) as Language[]).flatMap((language) => {
    const file = path.join(problemsDir, slug, "solutions", `ref.${EXT[language]}`);
    return existsSync(file) ? [{ language, code: readFileSync(file, "utf8") }] : [];
  });
}

// ------------------------------------------------------------------ command line

interface Row {
  slug: string;
  what: string;
  expected: string;
  got: string;
  ok: boolean;
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const slugs = listSlugs().filter((s) => only.length === 0 || only.includes(s));
  const rows: Row[] = [];
  for (const slug of slugs) {
    const fixture = loadFixture(slug);
    for (const ref of referenceFiles(slug)) {
      if (!toolchainAvailable[ref.language]) {
        rows.push({
          slug,
          what: `reference (${ref.language})`,
          expected: "AC",
          got: "skipped: no toolchain",
          ok: true,
        });
        continue;
      }
      const r = await judgeCode(fixture, ref.language, ref.code);
      rows.push({
        slug,
        what: `reference (${ref.language})`,
        expected: "AC",
        got: r.verdict,
        ok: r.verdict === "AC",
      });
    }
    for (const m of loadMutants(slug)) {
      // A slow-solution mutant must miss the plain limit by a wide margin: with Python's 5x allowance a
      // quadratic solution can squeak through on a fast runner, which made this gate flaky in CI.
      const r = await judgeCode(fixture, "python", m.code, { baseLimit: m.expect === "TLE" });
      rows.push({
        slug,
        what: `mutant ${m.name}`,
        expected: m.expect,
        got: r.verdict,
        ok: r.verdict === m.expect,
      });
    }
    for (const s of loadEditorialSnippets(slug)) {
      const r = await judgeCode(fixture, s.language, s.code, { firstTests: 3 });
      rows.push({
        slug,
        what: `editorial "${s.approach}" (${s.language}, samples)`,
        expected: "AC",
        got: r.verdict,
        ok: r.verdict === "AC",
      });
    }
    for (const row of rows.filter((r) => r.slug === slug)) {
      console.log(
        `${row.ok ? "ok  " : "FAIL"} ${slug.padEnd(28)} ${row.what.padEnd(48)} expected ${row.expected}, got ${row.got}`,
      );
    }
  }
  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length} checks, ${failed.length} failed`);
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
