import { describe, expect, it } from "vitest";
import {
  addDays,
  advanceStreak,
  canGiveUp,
  currentStreak,
  daysBetween,
  editorialAccess,
  hintDecision,
  levelFor,
  localDay,
  newBadges,
  problemXp,
  recommendNext,
  topicMastery,
  weakAreas,
  xpForLevel,
  xpToNext,
  type Candidate,
  type ProblemEvidence,
  type StreakState,
} from "./index.js";

describe("XP and levels", () => {
  it("scales by difficulty with first-try and no-hint bonuses", () => {
    expect(problemXp({ difficulty: "easy", firstTry: true, hintTiers: 0 })).toBe(14); // 10 * 1.4
    expect(problemXp({ difficulty: "medium", firstTry: false, hintTiers: 0 })).toBe(30); // 25 * 1.2
    expect(problemXp({ difficulty: "hard", firstTry: true, hintTiers: 0 })).toBe(70);
  });

  it("takes 10% off per hint tier and never goes below 1", () => {
    expect(problemXp({ difficulty: "medium", firstTry: false, hintTiers: 1 })).toBe(23); // 25 * 0.9
    expect(problemXp({ difficulty: "medium", firstTry: false, hintTiers: 3 })).toBe(18); // 25 * 0.7
    expect(problemXp({ difficulty: "easy", firstTry: true, hintTiers: 3 })).toBe(9); // 10 * 0.9
    expect(problemXp({ difficulty: "medium", firstTry: true, hintTiers: 3 })).toBe(23); // 22.5 rounds up
    expect(
      problemXp({ difficulty: "easy", firstTry: false, hintTiers: 99 }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("follows the 100 * level^1.4 curve", () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBe(264);
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(3)).toBe(100 + 264);
  });

  it("maps XP to a level and progress inside it", () => {
    expect(levelFor(0)).toMatchObject({ level: 1, into: 0, needed: 100, fraction: 0 });
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100)).toMatchObject({ level: 2, into: 0 });
    expect(levelFor(100 + 132)).toMatchObject({ level: 2, into: 132, fraction: 0.5 });
    expect(levelFor(-5).level).toBe(1);
    const at = (lvl: number) => levelFor(xpForLevel(lvl)).level;
    for (const l of [1, 2, 5, 10, 25]) expect(at(l)).toBe(l);
  });
});

describe("streaks", () => {
  const base: StreakState = { current: 3, best: 5, lastActive: "2026-03-10", freezes: 1 };

  it("counts the first activity as day one", () => {
    const r = advanceStreak({ current: 0, best: 0, lastActive: null, freezes: 1 }, "2026-03-10");
    expect(r.state).toMatchObject({ current: 1, best: 1, lastActive: "2026-03-10" });
  });

  it("ignores a second activity on the same day", () => {
    const r = advanceStreak(base, "2026-03-10");
    expect(r.state).toBe(base);
    expect(r.milestone).toBeNull();
  });

  it("extends on consecutive days and tracks the best", () => {
    const r = advanceStreak({ ...base, current: 5 }, "2026-03-11");
    expect(r.state).toMatchObject({ current: 6, best: 6 });
  });

  it("bridges one missed day with a freeze, once", () => {
    const first = advanceStreak(base, "2026-03-12");
    expect(first).toMatchObject({ usedFreeze: true, state: { current: 4, freezes: 0 } });
    const again = advanceStreak(first.state, "2026-03-14"); // another missed day, no freeze left
    expect(again.state.current).toBe(1);
  });

  it("restarts after a longer gap but keeps the best", () => {
    const r = advanceStreak(base, "2026-03-20");
    expect(r.state).toMatchObject({ current: 1, best: 5, freezes: 1 });
  });

  it("reports milestones and earns a freeze back every seven days", () => {
    const r = advanceStreak(
      { current: 6, best: 6, lastActive: "2026-03-10", freezes: 0 },
      "2026-03-11",
    );
    expect(r.milestone).toBe(7);
    expect(r.state.freezes).toBe(1);
    const capped = advanceStreak(
      { current: 13, best: 13, lastActive: "2026-03-10", freezes: 1 },
      "2026-03-11",
    );
    expect(capped.state.freezes).toBe(1);
  });

  it("does not move when the day goes backwards (clock or time-zone change)", () => {
    expect(advanceStreak(base, "2026-03-09").state).toBe(base);
  });

  it("shows the streak as lapsed once it can no longer be saved", () => {
    expect(currentStreak(base, "2026-03-10")).toBe(3);
    expect(currentStreak(base, "2026-03-11")).toBe(3);
    expect(currentStreak(base, "2026-03-12")).toBe(3); // a freeze can still bridge it
    expect(currentStreak({ ...base, freezes: 0 }, "2026-03-12")).toBe(0);
    expect(currentStreak(base, "2026-03-13")).toBe(0);
    expect(currentStreak({ current: 0, best: 0, lastActive: null, freezes: 1 }, "2026-03-13")).toBe(
      0,
    );
  });

  it("works in calendar days, including month ends and leap days", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-03-10", "2026-03-09")).toBe(-1);
  });

  it("uses the user's time zone for the day", () => {
    const at = new Date("2026-03-10T22:30:00Z");
    expect(localDay(at, "UTC")).toBe("2026-03-10");
    expect(localDay(at, "Asia/Kolkata")).toBe("2026-03-11"); // UTC+5:30
    expect(localDay(at, "America/Los_Angeles")).toBe("2026-03-10");
    expect(localDay(at, "Not/AZone")).toBe("2026-03-10"); // falls back to UTC
  });
});

describe("hint unlocking", () => {
  const t0 = new Date("2026-03-10T10:00:00Z");
  const at = (sec: number) => new Date(t0.getTime() + sec * 1000);
  const ctx = (over: object = {}) => ({
    tier: 1,
    usedTiers: [] as number[],
    firstSeenAt: t0,
    lastHintAt: null as Date | null,
    now: at(0),
    mode: "strict" as const,
    ...over,
  });

  it("makes the first hint wait after the problem was opened", () => {
    expect(hintDecision(ctx({ now: at(60) }))).toMatchObject({
      allowed: false,
      reason: "cooldown",
    });
    const blocked = hintDecision(ctx({ now: at(60) }));
    expect(blocked.allowed === false && blocked.reason === "cooldown" && blocked.unlockAt).toEqual(
      at(180),
    );
    expect(hintDecision(ctx({ now: at(180) }))).toEqual({ allowed: true, alreadyUsed: false });
  });

  it("requires earlier tiers and a pause between tiers", () => {
    expect(hintDecision(ctx({ tier: 2, now: at(9999) }))).toEqual({
      allowed: false,
      reason: "previous_tier",
      missingTier: 1,
    });
    expect(hintDecision(ctx({ tier: 3, usedTiers: [2], now: at(9999) }))).toMatchObject({
      missingTier: 1,
    });
    const two = ctx({ tier: 2, usedTiers: [1], lastHintAt: at(200), now: at(300) });
    expect(hintDecision(two)).toMatchObject({ allowed: false, reason: "cooldown" });
    expect(hintDecision({ ...two, now: at(500) })).toEqual({ allowed: true, alreadyUsed: false });
  });

  it("always lets a hint you already viewed be read again", () => {
    expect(hintDecision(ctx({ usedTiers: [1], now: at(0) }))).toEqual({
      allowed: true,
      alreadyUsed: true,
    });
  });

  it("is quicker in relaxed mode", () => {
    expect(hintDecision(ctx({ mode: "relaxed", now: at(0) }))).toEqual({
      allowed: true,
      alreadyUsed: false,
    });
    const two = ctx({ mode: "relaxed", tier: 2, usedTiers: [1], lastHintAt: at(0), now: at(30) });
    expect(hintDecision(two)).toMatchObject({ allowed: false, reason: "cooldown" });
    expect(hintDecision({ ...two, now: at(60) }).allowed).toBe(true);
  });

  it("starts the clock at the first view when the problem was never seen", () => {
    expect(hintDecision(ctx({ firstSeenAt: null })).allowed).toBe(true);
  });
});

describe("editorial unlocking", () => {
  const t0 = new Date("2026-03-10T10:00:00Z");
  const ctx = (over: object = {}) => ({
    solved: false,
    usedTiers: [] as number[],
    openEditorials: false,
    gaveUp: false,
    firstSeenAt: t0,
    now: new Date(t0.getTime() + 60_000),
    mode: "strict" as const,
    ...over,
  });

  it("is locked by default and lists the ways in", () => {
    const a = editorialAccess(ctx());
    expect(a.unlocked).toBe(false);
    expect(a.reasons).toHaveLength(3);
    expect(a.giveUpAt).toEqual(new Date(t0.getTime() + 600_000));
  });

  it.each([
    ["solved", { solved: true }],
    ["hints", { usedTiers: [1, 2, 3] }],
    ["setting", { openEditorials: true }],
    ["gave_up", { gaveUp: true }],
  ])("unlocks via %s", (via, over) => {
    expect(editorialAccess(ctx(over))).toMatchObject({ unlocked: true, via });
  });

  it("two of three hints are not enough", () => {
    expect(editorialAccess(ctx({ usedTiers: [1, 2] })).unlocked).toBe(false);
  });

  it("allows giving up only after the wait", () => {
    expect(canGiveUp(ctx())).toBe(false);
    expect(canGiveUp(ctx({ now: new Date(t0.getTime() + 600_000) }))).toBe(true);
    expect(canGiveUp(ctx({ firstSeenAt: null }))).toBe(false);
    expect(canGiveUp(ctx({ mode: "relaxed", now: new Date(t0.getTime() + 120_000) }))).toBe(true);
  });
});

const evidence = (
  slug: string,
  topics: string[],
  over: Partial<ProblemEvidence> = {},
): ProblemEvidence => ({
  slug,
  difficulty: "easy",
  topics,
  patterns: [],
  attempted: true,
  solved: true,
  firstTry: true,
  hinted: false,
  lastAt: new Date("2026-03-10T00:00:00Z"),
  verdicts: { WA: 0, TLE: 0, RE: 0, MLE: 0, CE: 0 },
  ...over,
});
const NOW = new Date("2026-03-10T12:00:00Z");

describe("topic mastery", () => {
  it("leaves topics without evidence as seeds", () => {
    const [m] = topicMastery([], ["graphs"], NOW);
    expect(m).toMatchObject({
      mastery: 0,
      confidence: 0,
      weakness: 0,
      stage: "seed",
      attempted: 0,
    });
  });

  it("rewards first-try, hint-free solves and grows the plant", () => {
    const rows = Array.from({ length: 8 }, (_, i) => evidence(`p${i}`, ["arrays"]));
    const [m] = topicMastery(rows, ["arrays"], NOW);
    expect(m?.mastery).toBeCloseTo(1, 5);
    expect(m).toMatchObject({ confidence: 1, stage: "bloom", solved: 8 });
    expect(m?.diagnosis).toBeNull();
  });

  it("scores unsolved and hinted problems lower", () => {
    const failing = [evidence("a", ["dp"], { solved: false, firstTry: false })];
    expect(topicMastery(failing, ["dp"], NOW)[0]?.mastery).toBe(0);
    const slow = [evidence("a", ["dp"], { firstTry: false, hinted: true })];
    expect(topicMastery(slow, ["dp"], NOW)[0]?.mastery).toBeCloseTo((2 * 0.6 + 0) / 3, 5);
  });

  it("ignores problems that were never attempted", () => {
    const rows = [evidence("a", ["dp"], { attempted: false, solved: false })];
    expect(topicMastery(rows, ["dp"], NOW)[0]?.attempted).toBe(0);
  });

  it("lets old evidence fade (half-life 30 days)", () => {
    const old = new Date(NOW.getTime() - 90 * 86_400_000);
    const rows = [
      evidence("old", ["trees"], { solved: false, firstTry: false, lastAt: old }),
      evidence("new", ["trees"], { lastAt: NOW }),
    ];
    // the failure from 90 days ago weighs 1/8 of today's success
    expect(topicMastery(rows, ["trees"], NOW)[0]?.mastery).toBeGreaterThan(0.85);
  });

  it("lowers confidence when there is little evidence", () => {
    const [m] = topicMastery(
      [evidence("a", ["x"], { solved: false, firstTry: false })],
      ["x"],
      NOW,
    );
    expect(m?.confidence).toBeCloseTo(1 / 8, 5);
    expect(m?.weakness).toBeCloseTo(1 * (0.5 + 0.5 / 8), 5);
  });

  it("diagnoses the failure pattern", () => {
    const tle = [1, 2].map((i) =>
      evidence(`t${i}`, ["graphs"], {
        solved: false,
        firstTry: false,
        verdicts: { WA: 0, TLE: 2, RE: 0, MLE: 0, CE: 0 },
      }),
    );
    expect(topicMastery(tle, ["graphs"], NOW)[0]?.diagnosis).toMatch(/run out of time/);
    const wa = [1, 2].map((i) =>
      evidence(`w${i}`, ["graphs"], {
        solved: false,
        firstTry: false,
        verdicts: { WA: 2, TLE: 0, RE: 0, MLE: 0, CE: 0 },
      }),
    );
    expect(topicMastery(wa, ["graphs"], NOW)[0]?.diagnosis).toMatch(/wrong answers/);
    const re = [
      evidence("r", ["graphs"], {
        solved: false,
        firstTry: false,
        verdicts: { WA: 0, TLE: 0, RE: 2, MLE: 0, CE: 0 },
      }),
    ];
    expect(topicMastery(re, ["graphs"], NOW)[0]?.diagnosis).toMatch(/crash/);
  });

  it("ranks weak areas, weakest first, and skips strong or untouched topics", () => {
    const rows = [
      evidence("a", ["dp"], { solved: false, firstTry: false }),
      evidence("b", ["arrays"]),
      evidence("c", ["strings"], { firstTry: false }),
    ];
    const weak = weakAreas(topicMastery(rows, ["dp", "arrays", "strings", "graphs"], NOW));
    expect(weak.map((w) => w.topic)).toEqual(["dp", "strings"]);
  });
});

describe("recommendations", () => {
  const cand = (
    slug: string,
    difficulty: Candidate["difficulty"],
    topics: string[],
    patterns: string[] = [],
    solved = false,
  ): Candidate => ({
    slug,
    title: slug,
    difficulty,
    topics,
    patterns,
    solved,
  });

  it("starts a brand new user on easy problems in different topics", () => {
    const m = topicMastery([], ["arrays", "strings"], NOW);
    const r = recommendNext(m, [
      cand("a-hard", "hard", ["arrays"]),
      cand("a-easy", "easy", ["arrays"]),
      cand("s-easy", "easy", ["strings"]),
    ]);
    expect(r.map((x) => x.slug)).toEqual(["a-easy", "s-easy", "a-hard"]);
    expect(r[0]?.reason).toMatch(/New topic/);
  });

  it("targets the weakest topic just above the user's level and never repeats solved problems", () => {
    const rows = [
      evidence("done", ["dp"], { solved: false, firstTry: false }),
      evidence("fine", ["arrays"]),
    ];
    const m = topicMastery(rows, ["dp", "arrays"], NOW);
    const r = recommendNext(m, [
      cand("dp-easy", "easy", ["dp"]),
      cand("dp-medium", "medium", ["dp"]),
      cand("dp-solved", "easy", ["dp"], [], true),
      cand("arr-hard", "hard", ["arrays"]),
    ]);
    expect(r[0]).toMatchObject({ slug: "dp-easy", topic: "dp" });
    expect(r.map((x) => x.slug)).not.toContain("dp-solved");
  });

  it("prefers different patterns and respects the count", () => {
    const m = topicMastery([], ["arrays"], NOW);
    const r = recommendNext(
      m,
      [
        cand("one", "easy", ["arrays"], ["two-pointers"]),
        cand("two", "easy", ["arrays"], ["two-pointers"]),
        cand("three", "easy", ["arrays"], ["hashing"]),
      ],
      2,
    );
    expect(r.map((x) => x.slug)).toEqual(["one", "three"]);
  });

  it("returns nothing when there is nothing left to solve", () => {
    expect(
      recommendNext(topicMastery([], ["a"], NOW), [cand("x", "easy", ["a"], [], true)]),
    ).toEqual([]);
  });
});

describe("badges", () => {
  const stats = {
    solvedTotal: 0,
    solvedHard: 0,
    cleanSolves: 0,
    bestStreak: 0,
    languagesAccepted: 0,
  };
  it("awards each badge once its rule is met and never twice", () => {
    expect(newBadges(stats, new Set())).toEqual([]);
    expect(newBadges({ ...stats, solvedTotal: 1 }, new Set())).toEqual(["first-blood"]);
    expect(newBadges({ ...stats, solvedTotal: 1 }, new Set(["first-blood"]))).toEqual([]);
    expect(
      newBadges(
        { solvedTotal: 12, solvedHard: 1, cleanSolves: 5, bestStreak: 7, languagesAccepted: 3 },
        new Set(["first-blood"]),
      ),
    ).toEqual(["ten-down", "week-warrior", "hard-mode", "clean-sheet", "polyglot"]);
  });
});
