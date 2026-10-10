import { describe, expect, it } from "vitest";
import {
  judgeCode,
  listSlugs,
  loadEditorialSnippets,
  loadFixture,
  loadMutants,
  referenceFiles,
  toolchainAvailable,
} from "./content-judge.js";

// The full gate is `pnpm content:judge` (every reference, mutant and editorial snippet, a few minutes).
// This suite checks the loaders and a representative slice so `pnpm test` stays quick.

describe("content judge loaders", () => {
  it("finds every problem with mutants, a reference and an editorial", () => {
    const slugs = listSlugs();
    expect(slugs.length).toBeGreaterThanOrEqual(20);
    for (const slug of slugs) {
      expect(
        referenceFiles(slug).map((r) => r.language),
        slug,
      ).toContain("python");
      expect(loadMutants(slug).length, `${slug} has mutants`).toBeGreaterThanOrEqual(1);
      expect(
        loadEditorialSnippets(slug).length,
        `${slug} has editorial code`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("reads the expected verdict from each mutant's header", () => {
    const mutants = loadMutants("two-sum");
    expect(mutants.map((m) => [m.name, m.expect])).toEqual([
      ["brute_force_pairs", "TLE"],
      ["reuses_same_index", "WA"],
      ["unordered_indices", "WA"],
    ]);
  });
});

describe.skipIf(!toolchainAvailable.python)("content judge (Python)", () => {
  const two = loadFixture("two-sum");
  it("accepts the reference solution on every committed test", async () => {
    const ref = referenceFiles("two-sum").find((r) => r.language === "python")!;
    expect((await judgeCode(two, "python", ref.code)).verdict).toBe("AC");
  });

  it("catches known-wrong solutions with the verdict their header promises", async () => {
    for (const m of loadMutants("two-sum").filter((x) => x.expect === "WA")) {
      const r = await judgeCode(two, "python", m.code);
      expect(r.verdict, m.name).toBe(m.expect);
    }
  });

  it("catches a mutant that only fails on a special case (touching intervals)", async () => {
    const fixture = loadFixture("merge-intervals");
    const m = loadMutants("merge-intervals").find((x) => x.name === "touching_not_merged")!;
    expect((await judgeCode(fixture, "python", m.code)).verdict).toBe("WA");
  });
});
