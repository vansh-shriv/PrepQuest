import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CodecError, encodeInput, encodeOutput, parseOutput } from "./codec.js";
import { runPython, runReference } from "./harness.js";
import { loadCases, testFileName } from "./loader.js";
import {
  caseSchema,
  type Issue,
  type ManifestEntry,
  type ProblemBundle,
  type TestCase,
} from "./types.js";
import { z } from "zod";

export interface BuildResult {
  slug: string;
  count: number;
  issues: Issue[];
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i] as T, i);
      }
    }),
  );
  return results;
}

/**
 * Generates `tests/NN.in|out` and `manifest.json` for a problem:
 *   samples (from examples.json) + tests/cases.json + the output of tests/gen.py (if present).
 * Expected outputs come from running `solutions/ref.py` through the harness. Samples are also
 * cross-checked against the expected values written in examples.json, so a statement that disagrees
 * with the reference solution fails here.
 */
export async function buildTests(bundle: ProblemBundle, slug: string): Promise<BuildResult> {
  const issues: Issue[] = [];
  const { signature, examples } = bundle;
  const testsDir = join(bundle.dir, "tests");

  const cases: Array<TestCase & { sample?: boolean; expected?: unknown }> = examples.map((ex) => ({
    kind: "hidden" as const,
    args: ex.args,
    sample: true,
    expected: ex.expected,
  }));
  cases.push(...(await loadCases(bundle.dir, slug, issues)));

  const gen = join(testsDir, "gen.py");
  try {
    await stat(gen);
    const res = await runPython(gen, [], "", 120_000);
    if (res.code !== 0) {
      issues.push({
        level: "error",
        problem: slug,
        message: `gen.py failed: ${res.stderr.trim().split("\n").pop()}`,
      });
    } else {
      const parsed = z.array(caseSchema).safeParse(JSON.parse(res.stdout));
      if (parsed.success) cases.push(...parsed.data);
      else
        issues.push({
          level: "error",
          problem: slug,
          message: `gen.py output invalid: ${parsed.error.issues[0]?.message}`,
        });
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      issues.push({ level: "error", problem: slug, message: `gen.py: ${(e as Error).message}` });
    }
  }
  if (issues.some((i) => i.level === "error")) return { slug, count: 0, issues };

  // duplicate inputs add nothing: keep the first occurrence (samples always come first)
  const seen = new Set<string>();
  const unique: typeof cases = [];
  for (const c of cases) {
    let key: string;
    try {
      key = encodeInput(signature, c.args);
    } catch {
      unique.push(c); // reported with a proper message below
      continue;
    }
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  const built = await mapLimit(unique, 8, async (c, i) => {
    const ordinal = i + 1;
    try {
      const input = encodeInput(signature, c.args);
      const run = await runReference(bundle.dir, input);
      if (run.code !== 0) {
        return {
          error: `test ${ordinal}: reference solution crashed: ${run.stderr.trim().split("\n").pop()}`,
        };
      }
      parseOutput(signature, run.stdout);
      if (c.sample && run.stdout !== encodeOutput(signature, c.expected)) {
        return {
          error: `example ${ordinal} in examples.json disagrees with the reference solution (statement says ${JSON.stringify(c.expected)})`,
        };
      }
      return {
        ordinal,
        input,
        output: run.stdout,
        kind: c.sample ? ("sample" as const) : c.kind,
        label: c.label,
      };
    } catch (e) {
      return {
        error: `test ${ordinal}: ${e instanceof CodecError ? e.message : (e as Error).message}`,
      };
    }
  });

  const failures: string[] = [];
  for (const b of built) if ("error" in b && typeof b.error === "string") failures.push(b.error);
  if (failures.length > 0) {
    return {
      slug,
      count: 0,
      issues: failures.map((message) => ({ level: "error" as const, problem: slug, message })),
    };
  }

  // replace previous output only after everything built successfully
  await mkdir(testsDir, { recursive: true });
  for (const f of await readdir(testsDir)) {
    if (/^\d+\.(in|out)$/.test(f) || f === "manifest.json") await rm(join(testsDir, f));
  }
  const manifest: ManifestEntry[] = [];
  for (const b of built) {
    if ("error" in b) continue;
    await writeFile(join(testsDir, testFileName(b.ordinal, "in")), b.input);
    await writeFile(join(testsDir, testFileName(b.ordinal, "out")), b.output);
    manifest.push({
      ordinal: b.ordinal,
      kind: b.kind,
      weight: 1,
      ...(b.label ? { label: b.label } : {}),
    });
  }
  await writeFile(join(testsDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { slug, count: manifest.length, issues };
}

/**
 * Re-runs the reference solution on every committed `.in` and compares with the committed `.out`,
 * so edits to ref.py, the harness or the files can't silently drift apart.
 */
export async function verifyTests(bundle: ProblemBundle, slug: string): Promise<Issue[]> {
  const results = await mapLimit(bundle.tests, 8, async (t): Promise<Issue | null> => {
    const run = await runReference(bundle.dir, t.input);
    if (run.code !== 0) {
      return {
        level: "error",
        problem: slug,
        message: `test ${t.ordinal}: reference crashed: ${run.stderr.trim().split("\n").pop()}`,
      };
    }
    if (run.stdout !== t.output) {
      return {
        level: "error",
        problem: slug,
        message: `test ${t.ordinal}: reference output differs from ${testFileName(t.ordinal, "out")}`,
      };
    }
    return null;
  });
  const issues = results.filter((r): r is Issue => r !== null);
  // examples.json expectations must equal the sample outputs
  bundle.examples.forEach((ex, i) => {
    const sample = bundle.tests.find((t) => t.ordinal === i + 1);
    if (sample && sample.output !== encodeOutput(bundle.signature, ex.expected)) {
      issues.push({
        level: "error",
        problem: slug,
        message: `example ${i + 1} differs from sample test ${i + 1}`,
      });
    }
  });
  return issues;
}
