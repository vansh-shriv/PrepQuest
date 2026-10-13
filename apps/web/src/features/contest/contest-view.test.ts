import { describe, expect, it } from "vitest";
import {
  cellText,
  countdown,
  durationText,
  localInputValue,
  phaseHeadline,
  summaryText,
} from "./contest-view";

const cell = (over: object) => ({
  label: "A",
  solved: false,
  wrong: 0,
  minute: null,
  score: 0,
  pending: 0,
  ...over,
});

describe("contest text", () => {
  it("writes countdowns", () => {
    expect(countdown(9)).toBe("0:09");
    expect(countdown(725)).toBe("12:05");
    expect(countdown(3909)).toBe("1:05:09");
    expect(countdown(-4)).toBe("0:00");
  });
  it("heads the page by phase", () => {
    expect(phaseHeadline("upcoming", 600)).toBe("Starts in 10:00");
    expect(phaseHeadline("running", 61)).toBe("1:01 left");
    expect(phaseHeadline("past", 0)).toMatch(/ended/);
    expect(durationText(90)).toBe("1 h 30 min");
    expect(durationText(45)).toBe("45 min");
  });
  it("shows standings cells the way a scoreboard does", () => {
    expect(cellText(cell({ solved: true, minute: 12 }), "icpc")).toBe("+ (12')");
    expect(cellText(cell({ solved: true, wrong: 2, minute: 40 }), "icpc")).toBe("+2 (40')");
    expect(cellText(cell({ solved: true, score: 75, minute: 50 }), "points")).toBe("75 (50')");
    expect(cellText(cell({ wrong: 3 }), "icpc")).toBe("-3");
    expect(cellText(cell({ pending: 1 }), "icpc")).toBe("?");
    expect(cellText(cell({}), "icpc")).toBe("");
  });
  it("summarises a row", () => {
    expect(summaryText({ solved: 2, penalty: 80, score: 0 }, "icpc")).toBe(
      "2 solved, 80 min penalty",
    );
    expect(summaryText({ solved: 1, penalty: 5, score: 150 }, "points")).toBe("150 points");
  });
  it("formats a datetime-local value", () => {
    const d = new Date(2026, 2, 5, 9, 7);
    expect(localInputValue(d)).toBe("2026-03-05T09:07");
    expect(localInputValue(d, 60)).toBe("2026-03-05T10:07");
  });
});
