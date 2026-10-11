import { describe, expect, it } from "vitest";
import { loadBank, validateBank, type LoadedBank } from "./bank.js";
import { findContentRoot, taxonomy } from "./root.js";

const load = () => loadBank(findContentRoot());
const clone = (b: LoadedBank): LoadedBank => structuredClone(b);

describe("question bank and company packs", () => {
  it("the shipped content loads and passes every rule", async () => {
    const bank = await load();
    expect(bank.issues).toEqual([]);
    expect(validateBank(bank, taxonomy).filter((i) => i.level === "error")).toEqual([]);
    const by = (c: string) => bank.questions.filter((q) => q.category === c).length;
    expect(by("cs")).toBeGreaterThanOrEqual(32);
    expect(by("behavioral")).toBeGreaterThanOrEqual(24);
    expect(by("hld")).toBeGreaterThanOrEqual(8);
    expect(by("lld")).toBeGreaterThanOrEqual(8);
    expect(bank.packs.length).toBeGreaterThanOrEqual(5);
    for (const q of bank.questions) {
      expect(q.reference_answer.length, q.slug).toBeGreaterThan(60);
      expect(q.rubric_points.length, q.slug).toBeGreaterThanOrEqual(3);
    }
  });

  it("covers every CS topic and every competency the packs ask for", async () => {
    const bank = await load();
    const topics = new Set(bank.questions.filter((q) => q.category === "cs").map((q) => q.topic));
    expect([...topics].sort()).toEqual(["cn", "dbms", "oop", "os"]);
    const comps = new Set(bank.questions.map((q) => q.competency).filter(Boolean));
    for (const p of bank.packs)
      for (const c of p.behavioral_competencies) expect(comps.has(c), c).toBe(true);
  });

  it("rejects duplicate slugs, missing competencies and bad weights", async () => {
    const bank = await load();
    const dup = clone(bank);
    dup.questions.push({ ...dup.questions[0]! });
    expect(validateBank(dup, taxonomy).some((i) => /duplicate question/.test(i.message))).toBe(
      true,
    );

    const noComp = clone(bank);
    const beh = noComp.questions.find((q) => q.category === "behavioral")!;
    delete (beh as { competency?: string }).competency;
    expect(validateBank(noComp, taxonomy).some((i) => /need a competency/.test(i.message))).toBe(
      true,
    );

    const badSum = clone(bank);
    badSum.packs[0]!.rubric_weights.problem_solving = 0.9;
    expect(validateBank(badSum, taxonomy).some((i) => /sum to/.test(i.message))).toBe(true);

    const badBand = clone(bank);
    badBand.packs[0]!.difficulty_band = { easy: 0.5, medium: 0.5, hard: 0.5 };
    expect(validateBank(badBand, taxonomy).some((i) => /band/.test(i.message))).toBe(true);
  });

  it("rejects unknown topics, unknown rubric dimensions and unknown competencies", async () => {
    const bank = await load();
    const topic = clone(bank);
    topic.packs[0]!.topic_weights["underwater-basket-weaving"] = 0.5;
    expect(validateBank(topic, taxonomy).some((i) => /unknown topic/.test(i.message))).toBe(true);

    const dim = clone(bank);
    dim.packs[0]!.rubric_weights.vibes = 0;
    expect(
      validateBank(dim, taxonomy).some((i) => /unknown rubric dimension/.test(i.message)),
    ).toBe(true);

    const comp = clone(bank);
    comp.packs[0]!.behavioral_competencies.push("telepathy");
    expect(validateBank(comp, taxonomy).some((i) => /competency "telepathy"/.test(i.message))).toBe(
      true,
    );
  });

  it("warns about a pack that was not reviewed for six months", async () => {
    const bank = clone(await load());
    bank.packs[0]!.reviewed_at = "2020-01-01";
    expect(
      validateBank(bank, taxonomy).some((i) => i.level === "warning" && /6 months/.test(i.message)),
    ).toBe(true);
  });
});
