import { describe, expect, it } from "vitest";
import type { PlanTaskDto } from "@prepquest/shared";
import {
  dayLabel,
  groupByDay,
  isRough,
  linePath,
  minutesLabel,
  progressPercent,
  scoreText,
  splitPlan,
} from "./plan-view";

const task = (over: Partial<PlanTaskDto>): PlanTaskDto => ({
  id: "x",
  date: "2026-03-02",
  kind: "problem",
  refType: "problem",
  ref: "a",
  title: "A",
  estMinutes: 30,
  status: "todo",
  locked: false,
  custom: false,
  why: "",
  phase: "foundations",
  topic: null,
  href: null,
  ...over,
});

describe("plan view helpers", () => {
  it("labels days relative to today", () => {
    expect(dayLabel("2026-03-02", "2026-03-02")).toBe("Today");
    expect(dayLabel("2026-03-03", "2026-03-02")).toBe("Tomorrow");
    expect(dayLabel("2026-03-01", "2026-03-02")).toBe("Yesterday");
    expect(dayLabel("2026-03-11", "2026-03-02")).toBe("Wed 11 Mar");
  });
  it("formats minutes", () => {
    expect(minutesLabel(45)).toBe("45 min");
    expect(minutesLabel(60)).toBe("1 h");
    expect(minutesLabel(95)).toBe("1 h 35 min");
  });
  it("groups by day in order and counts only unskipped minutes", () => {
    const g = groupByDay([
      task({ id: "1", date: "2026-03-04" }),
      task({ id: "2", date: "2026-03-02" }),
      task({ id: "3", date: "2026-03-02", status: "skipped" }),
    ]);
    expect(g.map((d) => d.date)).toEqual(["2026-03-02", "2026-03-04"]);
    expect(g[0]!.minutes).toBe(30);
  });
  it("splits a plan into today, upcoming and past (newest first)", () => {
    const s = splitPlan(
      [
        task({ date: "2026-03-01" }),
        task({ date: "2026-02-27" }),
        task({ date: "2026-03-02" }),
        task({ date: "2026-03-05" }),
      ],
      "2026-03-02",
    );
    expect(s.today?.date).toBe("2026-03-02");
    expect(s.upcoming.map((d) => d.date)).toEqual(["2026-03-05"]);
    expect(s.past.map((d) => d.date)).toEqual(["2026-03-01", "2026-02-27"]);
  });
  it("computes progress ignoring skipped tasks", () => {
    expect(progressPercent([])).toBe(0);
    expect(progressPercent([task({ status: "done" }), task({}), task({ status: "skipped" })])).toBe(
      50,
    );
  });
  it("draws a line and breaks it at gaps", () => {
    expect(linePath([0, 100], 100, 50)).toBe("M0.0 50.0 L100.0 0.0");
    expect(linePath([10, null, 20], 100, 50)).toMatch(/^M0\.0 .* M100\.0 /);
    expect(linePath([], 100, 50)).toBe("");
    expect(linePath([50], 100, 50)).toBe("M50.0 25.0");
  });
  it("words the score honestly", () => {
    expect(scoreText(null, null)).toBe("Not enough data");
    expect(scoreText(42, 18)).toBe("42 ± 18");
    expect(isRough(18)).toBe(true);
    expect(isRough(4)).toBe(false);
    expect(isRough(null)).toBe(false);
  });
});
