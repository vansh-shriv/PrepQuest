import { describe, expect, it } from "vitest";
import { diffLines, submissionCreateSchema, submissionListQuerySchema } from "./submissions.js";

describe("diffLines", () => {
  it("marks added, removed and unchanged lines", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc\nd")).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "x" },
      { type: "same", text: "c" },
      { type: "add", text: "d" },
    ]);
  });
  it("handles identical and empty inputs", () => {
    expect(diffLines("same", "same")).toEqual([{ type: "same", text: "same" }]);
    expect(diffLines("", "")).toEqual([{ type: "same", text: "" }]);
  });
});

describe("submission schemas", () => {
  const base = { problemSlug: "two-sum", language: "python", code: "x", kind: "run" };
  it("applies defaults and rejects bad input", () => {
    expect(submissionCreateSchema.parse(base)).toMatchObject({
      customTestIds: [],
      customInputs: [],
      mode: "practice",
    });
    expect(submissionCreateSchema.safeParse({ ...base, code: "x".repeat(70_000) }).success).toBe(
      false,
    );
    expect(submissionCreateSchema.safeParse({ ...base, code: "" }).success).toBe(false);
    expect(submissionCreateSchema.safeParse({ ...base, language: "ruby" }).success).toBe(false);
    expect(submissionCreateSchema.safeParse({ ...base, mode: "contest" }).success).toBe(false);
  });
  it("lists submissions only by default", () => {
    expect(submissionListQuerySchema.parse({}).kind).toBe("submit");
  });
});
