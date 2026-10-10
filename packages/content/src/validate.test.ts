import { describe, expect, it } from "vitest";
import { contentHash } from "./hash.js";
import { listProblemSlugs, loadProblem } from "./loader.js";
import { findContentRoot, taxonomy } from "./root.js";
import { resolveStarters } from "./import.js";
import { signatureSchema, type ProblemBundle, type TestFile } from "./types.js";
import {
  hasErrors,
  MIN_TESTS,
  validateBundle,
  validateReferences,
  validateTests,
} from "./validate.js";

const sig = signatureSchema.parse({
  function: "total",
  params: [{ name: "nums", type: "int[]" }],
  returns: "int",
});

/** `n` valid tests: `samples` samples first, then hidden ones, with the given stress/edge counts. */
function makeTests(n: number, { samples = 1, stress = 2, edge = 1 } = {}): TestFile[] {
  return Array.from({ length: n }, (_, i) => {
    const ordinal = i + 1;
    const kind =
      ordinal <= samples
        ? "sample"
        : ordinal > n - stress
          ? "stress"
          : ordinal <= samples + edge
            ? "edge"
            : "hidden";
    const values = Array.from({ length: ordinal }, (_, k) => k);
    return {
      ordinal,
      kind,
      weight: 1,
      label: kind === "edge" || kind === "stress" ? `${kind} ${ordinal}` : undefined,
      input: `${values.length}\n${values.join(" ")}\n`,
      output: `${values.reduce((a, b) => a + b, 0)}\n`,
    } satisfies TestFile;
  });
}

describe("validateTests", () => {
  it("accepts a well-formed set", () => {
    expect(validateTests("p", sig, "easy", 1, makeTests(14))).toEqual([]);
  });

  it("enforces per-difficulty minimums of non-sample tests", () => {
    const issues = validateTests("p", sig, "hard", 1, makeTests(15));
    expect(issues.map((i) => i.message).join("\n")).toMatch(/hard problems need at least 20/);
    expect(validateTests("p", sig, "medium", 1, makeTests(MIN_TESTS.medium + 1))).toEqual([]);
    expect(hasErrors(validateTests("p", sig, "medium", 1, makeTests(MIN_TESTS.medium)))).toBe(true);
  });

  it("requires stress tests and labels on edge/stress tests", () => {
    expect(
      validateTests("p", sig, "easy", 1, makeTests(14, { stress: 1 })).map((i) => i.message),
    ).toContain("needs at least 2 stress tests (has 1)");
    const unlabeled = makeTests(14).map((t) =>
      t.kind === "edge" ? { ...t, label: undefined } : t,
    );
    expect(
      validateTests("p", sig, "easy", 1, unlabeled)
        .map((i) => i.message)
        .join(),
    ).toMatch(/edge tests need a label/);
  });

  it("rejects inputs and outputs that don't match the signature, naming the test and the problem", () => {
    const tests = makeTests(14);
    tests[4] = { ...tests[4]!, input: "3\n1 2\n" };
    tests[5] = { ...tests[5]!, output: "not a number\n" };
    const messages = validateTests("p", sig, "easy", 1, tests).map((i) => i.message);
    expect(messages).toContain(
      "test 5: input does not match the signature: nums: expected 3 value(s), found 2",
    );
    expect(
      messages.some((m) => m.startsWith("test 6: output does not match the return type")),
    ).toBe(true);
  });

  it("requires contiguous ordinals and samples to come first", () => {
    const gap = makeTests(14).filter((t) => t.ordinal !== 7);
    expect(
      validateTests("p", sig, "easy", 1, gap)
        .map((i) => i.message)
        .join(),
    ).toMatch(/without gaps/);
    const wrong = makeTests(14);
    wrong[0] = { ...wrong[0]!, kind: "hidden" };
    expect(
      validateTests("p", sig, "easy", 1, wrong)
        .map((i) => i.message)
        .join(),
    ).toMatch(/first 1 tests must be samples/);
    const late = makeTests(14);
    late[8] = { ...late[8]!, kind: "sample" };
    expect(
      validateTests("p", sig, "easy", 1, late)
        .map((i) => i.message)
        .join(),
    ).toMatch(/only the first 1 tests may be samples/);
  });

  it("warns about duplicate inputs and fails on an empty set", () => {
    const tests = makeTests(14);
    tests[9] = { ...tests[9]!, input: tests[8]!.input, output: tests[8]!.output };
    expect(
      validateTests("p", sig, "easy", 1, tests).some(
        (i) => i.level === "warning" && /same input as test 9/.test(i.message),
      ),
    ).toBe(true);
    expect(hasErrors(validateTests("p", sig, "easy", 1, []))).toBe(true);
  });
});

describe("contentHash", () => {
  const bundle = (over: Partial<ProblemBundle> = {}): ProblemBundle => ({
    dir: "x",
    meta: {
      slug: "t",
      title: "Title",
      difficulty: "easy",
      topics: ["arrays"],
      patterns: [],
      companies: [],
      estMinutes: 10,
      source: "original",
      license: "CC0",
      checker: "exact",
      limits: { timeLimitMs: 1000, memoryLimitKb: 262144 },
    },
    statementMd: "statement",
    constraintsMd: "constraints",
    examples: [{ args: [[1]], expected: 1 }],
    signature: sig,
    starters: {},
    hints: {},
    editorial: null,
    tests: makeTests(3),
    ...over,
  });
  const hash = (b: ProblemBundle) => contentHash(b, resolveStarters(b));

  it("is stable and sensitive to every part of a version", () => {
    const base = hash(bundle());
    expect(hash(bundle())).toBe(base);
    expect(hash(bundle({ statementMd: "changed" }))).not.toBe(base);
    expect(hash(bundle({ constraintsMd: "changed" }))).not.toBe(base);
    expect(hash(bundle({ starters: { python: "# mine" } }))).not.toBe(base);
    const edited = makeTests(3);
    edited[2] = { ...edited[2]!, output: "999\n" };
    expect(hash(bundle({ tests: edited }))).not.toBe(base);
  });

  it("ignores hints and the editorial: editing them never creates a version", () => {
    const base = hash(bundle());
    expect(hash(bundle({ hints: { 1: "a nudge" } }))).toBe(base);
    const editorial = {
      approaches: [
        {
          name: "Brute force",
          intuition: "Try everything.",
          steps: ["loop"],
          code: {},
          time: "O(n)",
          space: "O(1)",
        },
      ],
      relatedSlugs: [],
    };
    expect(hash(bundle({ editorial }))).toBe(base);
  });

  it("ignores key order", () => {
    const a = bundle();
    const b = bundle({
      meta: Object.fromEntries(Object.entries(a.meta).reverse()) as ProblemBundle["meta"],
    });
    expect(hash(b)).toBe(hash(a));
  });
});

describe("committed content", () => {
  it("every problem in content/problems loads and validates with no errors or warnings", async () => {
    const root = findContentRoot();
    const slugs = await listProblemSlugs(root);
    expect(slugs.length).toBeGreaterThanOrEqual(20);
    const problems: string[] = [];
    for (const slug of slugs) {
      const { bundle, issues } = await loadProblem(root, slug);
      expect(bundle, `${slug}: ${issues.map((i) => i.message).join("; ")}`).not.toBeNull();
      const found = [...issues, ...validateBundle(bundle!, slug, taxonomy)];
      problems.push(...found.map((i) => `${i.level} ${i.problem}: ${i.message}`));
    }
    expect(problems).toEqual([]);
  });
});

describe("editorial validation", () => {
  const root = findContentRoot();

  it("loads every editorial with its reference code inlined", async () => {
    const { bundle } = await loadProblem(root, "two-sum");
    const optimal = bundle?.editorial?.approaches.at(-1);
    expect(optimal?.name).toBe("Hash map of seen values");
    expect(Object.keys(optimal?.code ?? {}).sort()).toEqual(["cpp", "java", "python"]);
    expect(optimal?.code.python).toContain("class Solution");
    expect(bundle?.editorial?.relatedSlugs).toContain("contains-duplicate");
    expect(bundle?.hints[1]).toBeTruthy();
  });

  it("flags related problems that do not exist", async () => {
    const { bundle } = await loadProblem(root, "two-sum");
    const broken = {
      ...bundle!,
      editorial: { ...bundle!.editorial!, relatedSlugs: ["ghost-problem"] },
    };
    const issues = validateReferences([broken]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("ghost-problem");
    const known = {
      ...bundle!,
      editorial: { ...bundle!.editorial!, relatedSlugs: ["contains-duplicate"] },
    };
    const other = {
      ...bundle!,
      meta: { ...bundle!.meta, slug: "contains-duplicate" },
      editorial: null,
    };
    expect(validateReferences([known, other])).toEqual([]);
  });
});
