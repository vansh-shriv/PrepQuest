import { describe, expect, it } from "vitest";
import type { RoadmapNodeDto } from "@prepquest/shared";
import {
  accuracyText,
  barPercent,
  byLayer,
  clock,
  coverageText,
  dueLabel,
  intervalLabel,
  isAnswerReady,
  masteryText,
  retentionText,
  secondsLeft,
  toggleOption,
} from "./learning-view";

describe("reviews", () => {
  it("labels how overdue a card is", () => {
    expect(dueLabel(0)).toBe("Due today");
    expect(dueLabel(1)).toBe("1 day overdue");
    expect(dueLabel(4)).toBe("4 days overdue");
  });

  it("labels intervals in friendly units", () => {
    expect(intervalLabel(1)).toBe("1 day");
    expect(intervalLabel(3)).toBe("3 days");
    expect(intervalLabel(21)).toBe("3 weeks");
    expect(intervalLabel(90)).toBe("3 months");
  });

  it("formats retention and bar heights", () => {
    expect(retentionText(null)).toBe("No reviews yet");
    expect(retentionText(0.834)).toBe("83%");
    expect(barPercent(0, 5)).toBe(0);
    expect(barPercent(5, 5)).toBe(100);
    expect(barPercent(1, 50)).toBe(8);
  });
});

describe("quiz helpers", () => {
  it("knows when an answer is complete", () => {
    expect(isAnswerReady("single", undefined)).toBe(false);
    expect(isAnswerReady("single", "b")).toBe(true);
    expect(isAnswerReady("multi", [])).toBe(false);
    expect(isAnswerReady("multi", ["a"])).toBe(true);
    expect(isAnswerReady("tf", false)).toBe(true);
    expect(isAnswerReady("blank", "   ")).toBe(false);
    expect(isAnswerReady("output", "4")).toBe(true);
  });

  it("toggles multi-select options and keeps them sorted", () => {
    expect(toggleOption([], "c")).toEqual(["c"]);
    expect(toggleOption(["c"], "a")).toEqual(["a", "c"]);
    expect(toggleOption(["a", "c"], "a")).toEqual(["c"]);
  });

  it("counts down to a deadline and never goes negative", () => {
    const now = Date.parse("2026-03-02T09:00:00Z");
    expect(secondsLeft("2026-03-02T09:02:00Z", now)).toBe(120);
    expect(secondsLeft("2026-03-02T09:00:00.400Z", now)).toBe(1);
    expect(secondsLeft("2026-03-02T08:59:00Z", now)).toBe(0);
    expect(clock(125)).toBe("2:05");
    expect(clock(9)).toBe("0:09");
    expect(clock(-3)).toBe("0:00");
  });

  it("describes accuracy", () => {
    expect(accuracyText(0, 0)).toBe("Not started");
    expect(accuracyText(3, 4)).toBe("75% of 4");
  });
});

describe("roadmap and track helpers", () => {
  const node = (id: string, layer: number): RoadmapNodeDto =>
    ({ id, layer }) as unknown as RoadmapNodeDto;

  it("groups nodes into layers in order", () => {
    const layers = byLayer([node("a", 0), node("c", 1), node("b", 0), node("d", 2)]);
    expect(layers.map((l) => l.map((n) => n.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("formats mastery and coverage", () => {
    expect(masteryText(null)).toBe("No evidence yet");
    expect(masteryText(0.65)).toBe("65%");
    expect(coverageText(2 / 3)).toBe("67%");
  });
});
