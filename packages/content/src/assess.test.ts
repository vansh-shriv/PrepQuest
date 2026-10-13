import { describe, expect, it } from "vitest";
import { loadAssess, validateAssess, type LoadedAssess } from "./assess.js";
import { findContentRoot } from "./root.js";

const quizCounts = new Map([
  ["os", 12],
  ["dbms", 12],
  ["cn", 12],
  ["oop", 12],
]);

const base = async (): Promise<LoadedAssess> => loadAssess(findContentRoot());

describe("assessment content", () => {
  it("loads and validates: SQL answers run, items are keyed, templates have enough questions", async () => {
    const a = await base();
    expect(a.issues).toEqual([]);
    expect(a.datasets).toHaveLength(3);
    expect(a.aptitude.length).toBeGreaterThanOrEqual(40);
    expect(a.templates.map((t) => t.slug)).toContain("campus-oa");
    expect(await validateAssess(a, quizCounts)).toEqual([]);
  }, 30_000);

  it("rejects a SQL problem whose expected query writes or fails", async () => {
    const a = await base();
    const d = structuredClone(a.datasets[0]!);
    d.problems = [
      { ...d.problems[0]!, slug: "writes", expected: "DELETE FROM employees" },
      { ...d.problems[0]!, slug: "broken", expected: "SELECT nope FROM employees" },
      { ...d.problems[0]!, slug: "empty", expected: "SELECT name FROM employees WHERE id < 0" },
    ];
    const issues = await validateAssess(
      { ...a, datasets: [d], aptitude: [], templates: [] },
      quizCounts,
    );
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringMatching(/refused by the guard/),
      expect.stringMatching(/fails/),
      expect.stringMatching(/no rows/),
    ]);
  }, 30_000);

  it("rejects bad aptitude keys and templates that ask for too much", async () => {
    const a = await base();
    const item = { ...a.aptitude[0]!, slug: "bad-key", answer: "z" };
    const t = { ...a.templates[0]!, sections: [{ ...a.templates[0]!.sections[0]!, count: 50 }] };
    const issues = await validateAssess(
      { ...a, datasets: [], aptitude: [item], templates: [t] },
      quizCounts,
    );
    const text = issues.map((i) => i.message).join("\n");
    expect(text).toMatch(/answer must be one of the option ids/);
    expect(text).toMatch(/asks for 50 but only \d+/);
  });
});
