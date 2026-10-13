import { describe, expect, it } from "vitest";
import type { CodeReviewDto, ComplexityDto, ReviewCommentDto } from "@prepquest/shared";
import {
  chartGeometry,
  commentsByLine,
  complexityPollMs,
  msText,
  numberedLines,
  ratingText,
  reviewPollMs,
  severityCounts,
  sizeText,
} from "./review-view";

const c = (line: number, severity: ReviewCommentDto["severity"]): ReviewCommentDto => ({
  line,
  severity,
  category: "readability",
  message: `m${line}${severity}`,
});

describe("commentsByLine", () => {
  const all = [c(3, "nit"), c(3, "important"), c(5, "suggestion"), c(1, "nit")];
  it("groups by line with the most important first", () => {
    const map = commentsByLine(all, new Set(["important", "suggestion", "nit"]));
    expect([...map.keys()].sort()).toEqual([1, 3, 5]);
    expect(map.get(3)!.map((x) => x.severity)).toEqual(["important", "nit"]);
  });
  it("hides severities that are switched off", () => {
    const map = commentsByLine(all, new Set(["important", "suggestion"]));
    expect(map.has(1)).toBe(false);
    expect(map.get(3)).toHaveLength(1);
  });
  it("counts each severity", () => {
    expect(severityCounts(all)).toEqual({ important: 1, suggestion: 1, nit: 2 });
  });
});

describe("small text helpers", () => {
  it("draws a rating that reads without colour", () => {
    expect(ratingText(3)).toBe("■■■□□");
    expect(ratingText(undefined)).toBe("□□□□□");
    expect(ratingText(9)).toBe("■■■■■");
  });
  it("numbers lines from 1 and ignores Windows line endings", () => {
    expect(numberedLines("a\r\nb")).toEqual([
      { n: 1, text: "a" },
      { n: 2, text: "b" },
    ]);
  });
  it("formats sizes and times", () => {
    expect(sizeText(128000)).toBe("128,000");
    expect(msText(840)).toBe("840 ms");
    expect(msText(1400)).toBe("1.4 s");
    expect(msText(null)).toBe("not run");
  });
});

describe("polling", () => {
  const review = (over: Partial<CodeReviewDto>): CodeReviewDto => ({
    id: "r",
    submissionId: "s",
    strictness: "strict",
    status: "ready",
    summary: "",
    comments: [],
    ratings: {},
    refactor: { status: "none", code: null, notes: null },
    error: null,
    createdAt: "",
    ...over,
  });
  it("keeps polling while the review is written or the refactor is checked", () => {
    expect(reviewPollMs(null)).toBeNull();
    expect(reviewPollMs(review({ status: "pending" }))).not.toBeNull();
    expect(
      reviewPollMs(review({ refactor: { status: "checking", code: null, notes: null } })),
    ).not.toBeNull();
    expect(reviewPollMs(review({}))).toBeNull();
    expect(reviewPollMs(review({ status: "failed" }))).toBeNull();
  });
  it("polls a complexity check only while it runs", () => {
    expect(complexityPollMs({ status: "running" } as ComplexityDto)).not.toBeNull();
    expect(complexityPollMs({ status: "ready" } as ComplexityDto)).toBeNull();
    expect(complexityPollMs(null)).toBeNull();
  });
});

describe("chartGeometry", () => {
  const samples = [
    { n: 1000, timeMs: 100, memoryKb: null, limit: false },
    { n: 2000, timeMs: 400, memoryKb: null, limit: false },
    { n: 4000, timeMs: null, memoryKb: null, limit: false },
  ];
  it("puts the largest measured point at the top right and skips sizes that were not run", () => {
    const g = chartGeometry(samples, 400, 200);
    expect(g.points).toHaveLength(2);
    expect(g.maxN).toBe(2000);
    const last = g.points[1]!;
    expect(last.x).toBe(400 - 12);
    expect(last.y).toBe(12);
    expect(g.path.startsWith("M")).toBe(true);
    expect(g.path.split("L")).toHaveLength(2);
  });
  it("copes with nothing measured", () => {
    const g = chartGeometry([], 400, 200);
    expect(g.points).toEqual([]);
    expect(g.path).toBe("");
  });
});
