import { describe, expect, it } from "vitest";
import {
  bannerVerdict,
  cellText,
  filterProblems,
  groupByDataset,
  marksText,
  minutesText,
  negativeText,
  paceText,
  percentileText,
  rowsText,
  sectionLabel,
} from "./assess-view";
import { calcPress, INITIAL_CALC } from "./calculator";

describe("sql results", () => {
  it("spells out NULL and empty text", () => {
    expect(cellText(null)).toBe("NULL");
    expect(cellText("")).toBe("''");
    expect(cellText("Asha")).toBe("Asha");
    expect(cellText(79.3)).toBe("79.3");
  });
  it("shows an error as a runtime error and counts rows", () => {
    expect(bannerVerdict("ERROR")).toBe("RE");
    expect(bannerVerdict("AC")).toBe("AC");
    expect(rowsText(1, false)).toBe("1 row");
    expect(rowsText(1000, true)).toMatch(/cut off/);
  });
  it("groups by dataset and filters", () => {
    const ps = [
      { dataset: "a", datasetTitle: "A", topic: "joins", difficulty: "easy", solved: true },
      { dataset: "b", datasetTitle: "B", topic: "windows", difficulty: "hard", solved: false },
      { dataset: "a", datasetTitle: "A", topic: "windows", difficulty: "easy", solved: false },
    ];
    expect(groupByDataset(ps).map((g) => [g.dataset, g.problems.length])).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
    expect(filterProblems(ps, { topic: "windows", difficulty: "", status: "all" })).toHaveLength(2);
    expect(filterProblems(ps, { topic: "", difficulty: "", status: "solved" })).toHaveLength(1);
    expect(filterProblems(ps, { topic: "", difficulty: "easy", status: "todo" })).toHaveLength(1);
  });
});

describe("assessment text", () => {
  it("writes minutes, marks and penalties", () => {
    expect(minutesText(47)).toBe("47 min");
    expect(minutesText(65)).toBe("1 h 5 min");
    expect(minutesText(120)).toBe("2 h");
    expect(marksText(8.25)).toBe("8.25");
    expect(marksText(6)).toBe("6");
    expect(negativeText(0)).toMatch(/No negative/);
    expect(negativeText(0.25)).toMatch(/0.25 mark/);
  });
  it("is honest about percentiles and section outcomes", () => {
    expect(percentileText(null)).toMatch(/Not enough/);
    expect(percentileText(70)).toBe("Better than 70% of other attempts");
    expect(sectionLabel({ status: "done", endedBy: "time" })).toBe("Time ran out");
    expect(sectionLabel({ status: "done", endedBy: "submitted" })).toBe("Handed in");
    expect(sectionLabel({ status: "pending", endedBy: null })).toBe("Waiting");
  });
  it("advises on pace", () => {
    expect(paceText(null, 60)).toMatch(/did not answer/);
    expect(paceText(90, 60)).toMatch(/slower/);
    expect(paceText(20, 60)).toMatch(/fast/);
    expect(paceText(55, 60)).toMatch(/steady/);
  });
});

describe("calculator", () => {
  const press = (keys: string[]) => keys.reduce((s, k) => calcPress(s, k), INITIAL_CALC).display;
  it("does arithmetic in order of entry", () => {
    expect(press(["1", "2", "+", "3", "="])).toBe("15");
    expect(press(["9", "-", "4", "*", "2", "="])).toBe("10");
    expect(press(["7", "/", "2", "="])).toBe("3.5");
  });
  it("handles decimals, repeated operators and division by zero", () => {
    expect(press([".", "5", "+", ".", "2", "5", "="])).toBe("0.75");
    expect(press(["5", "+", "-", "2", "="])).toBe("3");
    expect(press(["5", "/", "0", "="])).toBe("Error");
    expect(press(["5", "/", "0", "=", "8"])).toBe("8");
  });
  it("trims float noise", () => {
    expect(press(["0", ".", "1", "+", "0", ".", "2", "="])).toBe("0.3");
  });
});
