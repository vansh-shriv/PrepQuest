import { describe, expect, it } from "vitest";
import {
  buildReport,
  closeAll,
  currentStep,
  newState,
  percentile,
  pickItems,
  saveAnswer,
  startSection,
  submitSection,
  syncClock,
  type KeyedItem,
  type OaState,
} from "./oa.js";

const t0 = new Date("2026-01-01T10:00:00Z");
const at = (sec: number) => new Date(t0.getTime() + sec * 1000);
const items = new Map<string, KeyedItem>(
  ["a", "b", "c", "d"].map((id, i) => [
    id,
    { id, topic: i < 2 ? "ratio" : "series", type: "single", answer: "x" } as KeyedItem,
  ]),
);
const fresh = () =>
  newState([
    { key: "q", itemIds: ["a", "b"] },
    { key: "l", itemIds: ["c", "d"] },
  ]);
const ok = (r: OaState | { error: string }): OaState => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("pickItems", () => {
  const pool = Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, difficulty: (i % 3) + 1 }));
  it("is deterministic for a seed and varies between seeds", () => {
    expect(pickItems(pool, 10, "s")).toEqual(pickItems(pool, 10, "s"));
    expect(pickItems(pool, 10, "s")).not.toEqual(pickItems(pool, 10, "other"));
  });
  it("mixes difficulty, has no repeats and copes with a short pool", () => {
    const got = pickItems(pool, 10, "s");
    expect(new Set(got).size).toBe(10);
    const diffs = new Set(got.map((id) => pool.find((p) => p.id === id)!.difficulty));
    expect(diffs.size).toBe(3);
    expect(pickItems(pool.slice(0, 4), 10, "s")).toHaveLength(4);
  });
});

describe("section clock", () => {
  it("runs sections in order and locks a finished one", () => {
    let s = fresh();
    expect(currentStep(s, t0)).toEqual({ kind: "between", next: 0 });
    expect("error" in startSection(s, 1, 10, t0)).toBe(true);
    s = ok(startSection(s, 0, 10, t0));
    expect(currentStep(s, at(60))).toEqual({ kind: "section", index: 0, secondsLeft: 540 });
    expect("error" in startSection(s, 1, 10, at(1))).toBe(true);
    s = submitSection(s, at(100));
    expect(currentStep(s, at(100))).toEqual({ kind: "between", next: 1 });
    expect("error" in saveAnswer(s, "a", "x", at(101))).toBe(true);
  });

  it("ends a section by itself when time is up, even if nobody is looking", () => {
    let s = ok(startSection(fresh(), 0, 1, t0));
    expect(syncClock(s, at(61)).sections[0]).toMatchObject({ status: "done", endedBy: "time" });
    expect("error" in saveAnswer(s, "a", "x", at(61))).toBe(true);
    s = ok(saveAnswer(s, "a", "x", at(59)));
    expect(s.sections[0]!.answers.a).toBeDefined();
  });

  it("clearing an answer removes it", () => {
    let s = ok(startSection(fresh(), 0, 5, t0));
    s = ok(saveAnswer(s, "a", "x", at(5)));
    s = ok(saveAnswer(s, "a", "", at(6)));
    expect(s.sections[0]!.answers).toEqual({});
  });
});

describe("report", () => {
  it("applies negative marking exactly", () => {
    let s = ok(startSection(fresh(), 0, 5, t0));
    s = ok(saveAnswer(s, "a", "x", at(10))); // right
    s = ok(saveAnswer(s, "b", "y", at(20))); // wrong
    s = closeAll(submitSection(s, at(30)), at(31));
    const r = buildReport(s, items, 0.25);
    expect(r.sections[0]).toMatchObject({
      correct: 1,
      wrong: 1,
      skipped: 0,
      marks: 0.75,
      percent: 38,
    });
    expect(r.sections[1]).toMatchObject({ attempted: 0, skipped: 2, marks: 0, accuracy: null });
    expect(r.marks).toBe(0.75);
    expect(r.maxMarks).toBe(4);
    expect(r.weakTopics.map((t) => t.topic)).toContain("series");
  });

  it("never lets a section go below zero and flags a rushed one", () => {
    let s = ok(startSection(fresh(), 0, 1, t0));
    s = ok(saveAnswer(s, "a", "y", at(5)));
    s = ok(saveAnswer(s, "b", "y", at(6)));
    s = closeAll(syncClock(s, at(120)), at(121));
    expect(buildReport(s, items, 1).sections[0]!.marks).toBe(0);

    let r = ok(startSection(fresh(), 0, 1, t0));
    r = closeAll(syncClock(r, at(120)), at(121));
    expect(buildReport(r, items, 0).rushed).toEqual(["q"]);
  });
});

describe("percentile", () => {
  it("needs enough other attempts", () => {
    expect(percentile(50, [10, 20, 30])).toBeNull();
    const others = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
    expect(percentile(55, others)).toBe(50);
    expect(percentile(100, others)).toBe(95);
  });
});
