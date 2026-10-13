import { encodeInput, encodeOutput, parseInput, parseOutput } from "./codec.js";
import { buildScaledInput, scaleIssues } from "@prepquest/analytics-core";
import type { Issue, ProblemBundle, ScaleFile, Signature, TestFile } from "./types.js";

/** Minimum non-sample tests per difficulty (doc 17 §3 step 4). */
export const MIN_TESTS = { easy: 10, medium: 15, hard: 20 } as const;
export const MIN_STRESS = 2;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_TESTS = 200;

export interface Taxonomy {
  topics: ReadonlySet<string>;
  patterns: ReadonlySet<string>;
}

const err = (problem: string, message: string): Issue => ({ level: "error", problem, message });
const warn = (problem: string, message: string): Issue => ({ level: "warning", problem, message });

/**
 * Validates a set of test files against a signature. Used by `content:validate` and by the admin
 * zip upload, so both enforce identical rules. `sampleCount` is how many leading tests must be samples.
 */
export function validateTests(
  problem: string,
  signature: Signature,
  difficulty: keyof typeof MIN_TESTS,
  sampleCount: number,
  tests: TestFile[],
): Issue[] {
  const issues: Issue[] = [];
  if (tests.length === 0)
    return [err(problem, "no tests (run `pnpm content:build-tests` or upload a test zip)")];
  if (tests.length > MAX_TESTS)
    issues.push(err(problem, `too many tests (${tests.length} > ${MAX_TESTS})`));

  const sorted = [...tests].sort((a, b) => a.ordinal - b.ordinal);
  sorted.forEach((t, i) => {
    if (t.ordinal !== i + 1)
      issues.push(
        err(
          problem,
          `test ordinals must be 1..N without gaps (found ${t.ordinal} at position ${i + 1})`,
        ),
      );
  });

  let total = 0;
  const seenInputs = new Map<string, number>();
  for (const t of sorted) {
    const id = `test ${t.ordinal}`;
    const bytes = Buffer.byteLength(t.input) + Buffer.byteLength(t.output);
    total += bytes;
    if (
      Buffer.byteLength(t.input) > MAX_FILE_BYTES ||
      Buffer.byteLength(t.output) > MAX_FILE_BYTES
    ) {
      issues.push(err(problem, `${id}: file larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`));
    }
    try {
      parseInput(signature, t.input);
    } catch (e) {
      issues.push(
        err(problem, `${id}: input does not match the signature: ${(e as Error).message}`),
      );
    }
    try {
      parseOutput(signature, t.output);
    } catch (e) {
      issues.push(
        err(problem, `${id}: output does not match the return type: ${(e as Error).message}`),
      );
    }
    const first = seenInputs.get(t.input);
    if (first !== undefined && t.kind !== "sample")
      issues.push(warn(problem, `${id}: same input as test ${first}`));
    else seenInputs.set(t.input, t.ordinal);

    if ((t.kind === "edge" || t.kind === "stress") && !t.label) {
      issues.push(err(problem, `${id}: ${t.kind} tests need a label (shown when they fail)`));
    }
    if (t.ordinal <= sampleCount && t.kind !== "sample")
      issues.push(err(problem, `${id}: the first ${sampleCount} tests must be samples`));
    if (t.ordinal > sampleCount && t.kind === "sample")
      issues.push(err(problem, `${id}: only the first ${sampleCount} tests may be samples`));
  }
  if (total > MAX_TOTAL_BYTES)
    issues.push(
      err(
        problem,
        `tests total ${(total / 1024 / 1024).toFixed(1)} MB (> ${MAX_TOTAL_BYTES / 1024 / 1024} MB)`,
      ),
    );

  const hidden = sorted.filter((t) => t.kind !== "sample").length;
  if (hidden < MIN_TESTS[difficulty]) {
    issues.push(
      err(
        problem,
        `${difficulty} problems need at least ${MIN_TESTS[difficulty]} non-sample tests (has ${hidden})`,
      ),
    );
  }
  const stress = sorted.filter((t) => t.kind === "stress").length;
  if (stress < MIN_STRESS)
    issues.push(err(problem, `needs at least ${MIN_STRESS} stress tests (has ${stress})`));
  if (!sorted.some((t) => t.kind === "edge")) issues.push(warn(problem, "no edge tests"));
  return issues;
}

/** Full structural validation of a loaded bundle (no code execution; see `verify` for that). */
export function validateBundle(bundle: ProblemBundle, folder: string, taxonomy: Taxonomy): Issue[] {
  const { meta, signature, examples } = bundle;
  const p = folder;
  const issues: Issue[] = [];

  if (meta.slug !== folder)
    issues.push(err(p, `meta.slug "${meta.slug}" must match the folder name "${folder}"`));
  for (const t of meta.topics)
    if (!taxonomy.topics.has(t)) issues.push(err(p, `unknown topic tag "${t}"`));
  for (const t of meta.patterns)
    if (!taxonomy.patterns.has(t)) issues.push(err(p, `unknown pattern tag "${t}"`));
  if (new Set(meta.topics).size !== meta.topics.length) issues.push(err(p, "duplicate topics"));

  if (bundle.statementMd.trim().length < 60)
    issues.push(err(p, "statement.md is too short to be a real statement"));
  if (bundle.constraintsMd.trim().length < 10) issues.push(err(p, "constraints.md is empty"));
  // statements render as markdown without raw HTML, but keep dangerous markup out of the source too
  if (
    /<\s*(script|iframe|object|embed|style|link)\b/i.test(bundle.statementMd + bundle.constraintsMd)
  ) {
    issues.push(err(p, "statement contains disallowed HTML"));
  }

  examples.forEach((ex, i) => {
    try {
      encodeInput(signature, ex.args);
      encodeOutput(signature, ex.expected);
    } catch (e) {
      issues.push(err(p, `examples.json[${i}]: ${(e as Error).message}`));
    }
  });
  for (const [lang, code] of Object.entries(bundle.starters)) {
    if (code.trim().length === 0) issues.push(err(p, `starter/${lang}.txt is empty`));
  }
  for (const tier of [1, 2, 3] as const) {
    const hint = bundle.hints[tier];
    if (hint !== undefined && hint.length < 10)
      issues.push(err(p, `hints/${tier}.md is too short`));
  }

  if (bundle.editorial) {
    const langs = new Set(bundle.editorial.approaches.flatMap((a) => Object.keys(a.code)));
    if (!langs.has("python")) issues.push(warn(p, "editorial has no Python code"));
    for (const a of bundle.editorial.approaches) {
      if (Object.keys(a.code).length === 0)
        issues.push(warn(p, `editorial approach "${a.name}" has no code`));
    }
    if (bundle.editorial.relatedSlugs?.includes(meta.slug)) {
      issues.push(err(p, "editorial lists the problem itself as related"));
    }
  } else {
    issues.push(warn(p, "no editorial.json"));
  }
  const missingHints = ([1, 2, 3] as const).filter((t) => bundle.hints[t] === undefined);
  if (missingHints.length) issues.push(warn(p, `missing hints: ${missingHints.join(", ")}`));

  if (bundle.scale) issues.push(...validateScale(p, signature, bundle.scale));

  issues.push(...validateTests(p, signature, meta.difficulty, examples.length, bundle.tests));
  return issues;
}

/** The complexity analyzer's generators must fit the signature and make inputs the codec accepts. */
function validateScale(p: string, signature: Signature, scale: ScaleFile): Issue[] {
  const problems = scaleIssues(scale, signature.params);
  if (problems.length > 0) return problems.map((m) => err(p, `scale.json: ${m}`));
  const out: Issue[] = [];
  const first = scale.sizes[0]!;
  const last = scale.sizes[scale.sizes.length - 1]!;
  try {
    // the format is the same at every size, so only the smallest is parsed; the largest only has to fit the size cap
    parseInput(signature, buildScaledInput(scale, signature.params, first));
    buildScaledInput(scale, signature.params, last);
  } catch (e) {
    out.push(err(p, `scale.json: ${(e as Error).message}`));
  }
  return out;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === "error");
}

/** Cross-problem rules: related problems named in editorials must exist. */
export function validateReferences(bundles: ProblemBundle[]): Issue[] {
  const known = new Set(bundles.map((b) => b.meta.slug));
  const issues: Issue[] = [];
  for (const b of bundles) {
    for (const slug of b.editorial?.relatedSlugs ?? []) {
      if (!known.has(slug))
        issues.push(err(b.meta.slug, `editorial relates to unknown problem "${slug}"`));
    }
  }
  return issues;
}
