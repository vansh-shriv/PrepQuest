import { describe, expect, it } from "vitest";
import {
  computeStandings,
  contestPhase,
  freezeFromMs,
  placeAmong,
  type ContestAttempt,
  type ContestScoring,
} from "./contest.js";

const MIN = 60_000;
const problems = [
  { id: "A", label: "A", points: 100 },
  { id: "B", label: "B", points: 200 },
];
const at = (user: string, problem: string, minutes: number, verdict: string): ContestAttempt => ({
  userId: user,
  problemId: problem,
  elapsedMs: Math.round(minutes * MIN),
  verdict,
});

interface Scenario {
  name: string;
  scoring: ContestScoring;
  duration: number;
  freeze?: number;
  users: string[];
  attempts: ContestAttempt[];
  /** user: [rank, solved, penalty, score] */
  expect: Record<string, [number, number, number, number]>;
}

// Hand-computed scenarios, in the spirit of "20 recorded scenarios" (doc 02, D7 acceptance).
const SCENARIOS: Scenario[] = [
  {
    name: "icpc: one problem at minute 10",
    scoring: "icpc",
    duration: 90,
    users: ["u"],
    attempts: [at("u", "A", 10, "AC")],
    expect: { u: [1, 1, 10, 0] },
  },
  {
    name: "icpc: a wrong attempt adds 20 minutes",
    scoring: "icpc",
    duration: 90,
    users: ["u"],
    attempts: [at("u", "A", 5, "WA"), at("u", "A", 12, "AC")],
    expect: { u: [1, 1, 32, 0] },
  },
  {
    name: "icpc: two wrong attempts",
    scoring: "icpc",
    duration: 90,
    users: ["u"],
    attempts: [at("u", "A", 5, "WA"), at("u", "A", 6, "TLE"), at("u", "A", 30, "AC")],
    expect: { u: [1, 1, 70, 0] },
  },
  {
    name: "icpc: attempts after the accepted one are ignored",
    scoring: "icpc",
    duration: 90,
    users: ["u"],
    attempts: [at("u", "A", 10, "AC"), at("u", "A", 20, "WA")],
    expect: { u: [1, 1, 10, 0] },
  },
  {
    name: "icpc: compile errors and infrastructure errors cost nothing",
    scoring: "icpc",
    duration: 90,
    users: ["u"],
    attempts: [at("u", "A", 3, "CE"), at("u", "A", 4, "IE"), at("u", "A", 9, "AC")],
    expect: { u: [1, 1, 9, 0] },
  },
  {
    name: "icpc: wrong attempts on an unsolved problem add no penalty",
    scoring: "icpc",
    duration: 90,
    users: ["u"],
    attempts: [at("u", "A", 5, "WA"), at("u", "A", 8, "RE")],
    expect: { u: [1, 0, 0, 0] },
  },
  {
    name: "icpc: two problems add up",
    scoring: "icpc",
    duration: 90,
    users: ["u"],
    attempts: [at("u", "A", 10, "AC"), at("u", "B", 20, "WA"), at("u", "B", 50, "AC")],
    expect: { u: [1, 2, 80, 0] },
  },
  {
    name: "icpc: more solved beats less penalty",
    scoring: "icpc",
    duration: 90,
    users: ["x", "y"],
    attempts: [at("x", "A", 60, "AC"), at("x", "B", 80, "AC"), at("y", "A", 1, "AC")],
    expect: { x: [1, 2, 140, 0], y: [2, 1, 1, 0] },
  },
  {
    name: "icpc: equal solved, lower penalty wins",
    scoring: "icpc",
    duration: 90,
    users: ["x", "y"],
    attempts: [at("x", "A", 30, "AC"), at("y", "A", 20, "WA"), at("y", "A", 25, "AC")],
    expect: { x: [1, 1, 30, 0], y: [2, 1, 45, 0] },
  },
  {
    name: "icpc: equal solved and penalty share a rank, the next rank skips",
    scoring: "icpc",
    duration: 90,
    users: ["a", "b", "c"],
    attempts: [at("a", "A", 10, "AC"), at("b", "A", 10, "AC"), at("c", "A", 11, "AC")],
    expect: { a: [1, 1, 10, 0], b: [1, 1, 10, 0], c: [3, 1, 11, 0] },
  },
  {
    name: "icpc: pending attempts are not wrong attempts",
    scoring: "icpc",
    duration: 90,
    users: ["u"],
    attempts: [at("u", "A", 5, "QUEUED"), at("u", "A", 10, "AC")],
    expect: { u: [1, 1, 10, 0] },
  },
  {
    name: "icpc: attempts after the end are ignored, the last millisecond counts",
    scoring: "icpc",
    duration: 90,
    users: ["u", "v"],
    attempts: [
      { userId: "u", problemId: "A", elapsedMs: 90 * MIN, verdict: "AC" },
      { userId: "v", problemId: "A", elapsedMs: 90 * MIN + 1, verdict: "AC" },
    ],
    expect: { u: [1, 1, 90, 0], v: [2, 0, 0, 0] },
  },
  {
    name: "icpc: attempts before the start are ignored",
    scoring: "icpc",
    duration: 90,
    users: ["u"],
    attempts: [at("u", "A", -5, "AC")],
    expect: { u: [1, 0, 0, 0] },
  },
  {
    name: "icpc: minutes are floored",
    scoring: "icpc",
    duration: 90,
    users: ["u"],
    attempts: [at("u", "A", 10.99, "AC")],
    expect: { u: [1, 1, 10, 0] },
  },
  {
    name: "icpc: a participant with no attempts is listed last",
    scoring: "icpc",
    duration: 90,
    users: ["idle", "u"],
    attempts: [at("u", "A", 40, "AC")],
    expect: { u: [1, 1, 40, 0], idle: [2, 0, 0, 0] },
  },
  {
    name: "icpc: the freeze hides late solves",
    scoring: "icpc",
    duration: 90,
    freeze: 10,
    users: ["u"],
    attempts: [at("u", "A", 85, "AC")],
    expect: { u: [1, 0, 0, 0] },
  },
  {
    name: "icpc: a solve just before the freeze is shown",
    scoring: "icpc",
    duration: 90,
    freeze: 10,
    users: ["u"],
    attempts: [at("u", "A", 79.9, "AC")],
    expect: { u: [1, 1, 79, 0] },
  },
  {
    name: "points: a solve at the start is worth everything",
    scoring: "points",
    duration: 100,
    users: ["u"],
    attempts: [at("u", "A", 0, "AC")],
    expect: { u: [1, 1, 0, 100] },
  },
  {
    name: "points: halfway through is worth 75%",
    scoring: "points",
    duration: 100,
    users: ["u"],
    attempts: [at("u", "A", 50, "AC")],
    expect: { u: [1, 1, 50, 75] },
  },
  {
    name: "points: at the end is worth 50%",
    scoring: "points",
    duration: 100,
    users: ["u"],
    attempts: [at("u", "A", 100, "AC")],
    expect: { u: [1, 1, 100, 50] },
  },
  {
    name: "points: each wrong attempt costs 10",
    scoring: "points",
    duration: 100,
    users: ["u"],
    attempts: [at("u", "A", 0, "WA"), at("u", "A", 0, "WA"), at("u", "A", 0, "AC")],
    expect: { u: [1, 1, 0, 80] },
  },
  {
    name: "points: a solve never drops below 30% of its points",
    scoring: "points",
    duration: 100,
    users: ["u"],
    attempts: [...Array.from({ length: 6 }, () => at("u", "A", 90, "WA")), at("u", "A", 100, "AC")],
    expect: { u: [1, 1, 100, 30] },
  },
  {
    name: "points: problems add up with their own weights",
    scoring: "points",
    duration: 100,
    users: ["u"],
    attempts: [at("u", "A", 0, "AC"), at("u", "B", 50, "AC")],
    expect: { u: [1, 2, 50, 250] },
  },
  {
    name: "points: equal score and equal solve minute tie",
    scoring: "points",
    duration: 100,
    users: ["slow", "fast"],
    attempts: [at("slow", "A", 50, "AC"), at("fast", "A", 50.5, "AC")],
    // both 75 points, both solved in minute 50: a tie
    expect: { slow: [1, 1, 50, 75], fast: [1, 1, 50, 75] },
  },
  {
    name: "points: the freeze hides late solves",
    scoring: "points",
    duration: 100,
    freeze: 20,
    users: ["u", "v"],
    attempts: [at("u", "A", 10, "AC"), at("v", "A", 90, "AC")],
    expect: { u: [1, 1, 10, 95], v: [2, 0, 0, 0] },
  },
];

describe("contest standings", () => {
  for (const s of SCENARIOS) {
    it(s.name, () => {
      const rows = computeStandings(
        s.users,
        problems,
        s.attempts,
        { scoring: s.scoring, durationMs: s.duration * MIN },
        { freezeFromMs: freezeFromMs(s.duration * MIN, s.freeze ?? 0) },
      );
      const got = Object.fromEntries(
        rows.map((r) => [r.userId, [r.rank, r.solved, r.penalty, r.score]]),
      );
      expect(got).toEqual(s.expect);
    });
  }

  it("keeps the table in rank order", () => {
    const rows = computeStandings(
      ["a", "b", "c"],
      problems,
      [
        at("c", "A", 5, "AC"),
        at("a", "A", 15, "AC"),
        at("b", "B", 30, "AC"),
        at("b", "A", 31, "AC"),
      ],
      { scoring: "icpc", durationMs: 90 * MIN },
    );
    expect(rows.map((r) => r.userId)).toEqual(["b", "c", "a"]);
  });

  it("counts attempts hidden by the freeze as pending", () => {
    const rows = computeStandings(
      ["u"],
      problems,
      [at("u", "A", 85, "WA"), at("u", "A", 88, "AC")],
      { scoring: "icpc", durationMs: 90 * MIN },
      { freezeFromMs: 80 * MIN },
    );
    expect(rows[0]!.cells[0]).toMatchObject({ solved: false, pending: 2, wrong: 0 });
  });
});

describe("virtual participation and phases", () => {
  it("places a score among a finished field", () => {
    const field = [
      { solved: 3, penalty: 200, score: 0 },
      { solved: 2, penalty: 100, score: 0 },
      { solved: 2, penalty: 150, score: 0 },
    ];
    expect(placeAmong({ solved: 2, penalty: 120, score: 0 }, field, "icpc")).toBe(3);
    expect(placeAmong({ solved: 4, penalty: 500, score: 0 }, field, "icpc")).toBe(1);
    expect(
      placeAmong(
        { solved: 0, penalty: 0, score: 90 },
        [{ solved: 1, penalty: 5, score: 80 }],
        "points",
      ),
    ).toBe(1);
  });

  it("knows whether a contest is upcoming, running or past", () => {
    const s = new Date("2026-03-01T10:00:00Z");
    const e = new Date("2026-03-01T11:30:00Z");
    expect(contestPhase(s, e, new Date("2026-03-01T09:59:59Z"))).toBe("upcoming");
    expect(contestPhase(s, e, s)).toBe("running");
    expect(contestPhase(s, e, e)).toBe("past");
  });

  it("freezes the last minutes only when asked", () => {
    expect(freezeFromMs(90 * MIN, 0)).toBeNull();
    expect(freezeFromMs(90 * MIN, 10)).toBe(80 * MIN);
    expect(freezeFromMs(5 * MIN, 10)).toBe(0);
  });
});
