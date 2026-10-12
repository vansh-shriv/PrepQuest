import { describe, expect, it } from "vitest";
import {
  adaptEfficiency,
  capacityMinutes,
  computeReadiness,
  DEFAULT_INPUTS,
  DEFAULT_WEIGHTS,
  diffPlans,
  estimateEta,
  evaluateGoals,
  generatePlan,
  GOAL_PRESETS,
  goalsComplete,
  interviewTrends,
  normalizeGoals,
  planPhases,
  READINESS_COMPONENTS,
  solveTiming,
  speedCoaching,
  speedScore,
  suggestGoalChange,
  summarizeTimes,
  topicMastery,
  weekdayOf,
  type ComponentInputs,
  type PlanContext,
  type PlanInputs,
  type PlanProblem,
  type PlanTask,
  type ProblemEvidence,
  type TrendSession,
} from "./index.js";

const at = (iso: string) => new Date(iso);

describe("time analysis (A5)", () => {
  const events = [
    { at: at("2026-03-01T10:00:00Z"), kind: "open" as const },
    { at: at("2026-03-01T10:10:00Z"), kind: "run" as const },
    { at: at("2026-03-01T10:15:00Z"), kind: "run" as const },
    { at: at("2026-03-01T10:20:00Z"), kind: "submit" as const, accepted: true },
  ];
  it("measures reading time, active time and the debug share", () => {
    const t = solveTiming(events);
    expect(t.toFirstRun).toBe(600);
    expect(t.toFirstAc).toBe(1200);
    expect(t.runs).toBe(2);
    expect(t.submits).toBe(1);
    expect(t.debugShare).toBeCloseTo(0.5, 5);
  });
  it("counts a long gap as a break, not as work", () => {
    const t = solveTiming([
      { at: at("2026-03-01T10:00:00Z"), kind: "open" },
      { at: at("2026-03-01T18:00:00Z"), kind: "submit", accepted: true },
    ]);
    expect(t.toFirstAc).toBe(20 * 60);
  });
  it("has no accept time when nothing was accepted", () => {
    expect(solveTiming(events.slice(0, 3)).toFirstAc).toBeNull();
  });
  it("scores speed against the expected time", () => {
    expect(speedScore("medium", 20 * 60)).toBe(1);
    expect(speedScore("medium", 50 * 60)).toBeCloseTo(0.5, 5);
  });
  it("summarises by difficulty with a median and outliers", () => {
    const s = summarizeTimes([
      { difficulty: "easy", seconds: 600 },
      { difficulty: "easy", seconds: 900 },
      { difficulty: "easy", seconds: 5000 },
    ]);
    const easy = s.find((x) => x.difficulty === "easy")!;
    expect(easy.count).toBe(3);
    expect(easy.medianSeconds).toBe(900);
    expect(easy.outliers).toBe(1);
    expect(easy.histogram.reduce((a, b) => a + b, 0)).toBe(3);
    expect(s.find((x) => x.difficulty === "hard")!.medianSeconds).toBeNull();
  });
  it("coaches from the biggest share", () => {
    expect(speedCoaching({ think: 0.3, debug: 0.5 }, 0)).toMatch(/dry-running/);
    expect(speedCoaching({ think: 0.7, debug: 0.1 }, 0)).toMatch(/brute force/);
    expect(speedCoaching(null, 0)).toBeNull();
  });
});

const ev = (over: Partial<ProblemEvidence> = {}): ProblemEvidence => ({
  slug: "p",
  difficulty: "medium",
  topics: ["graphs"],
  patterns: [],
  attempted: true,
  solved: true,
  firstTry: true,
  hinted: false,
  lastAt: at("2026-03-01T00:00:00Z"),
  verdicts: { WA: 0, TLE: 0, RE: 0, MLE: 0, CE: 0 },
  ...over,
});

describe("mastery with speed and interview signals", () => {
  const now = at("2026-03-02T00:00:00Z");
  it("is unchanged when only solves are known", () => {
    const [m] = topicMastery([ev()], ["graphs"], now);
    expect(m!.mastery).toBeCloseTo(1, 5);
  });
  it("lowers mastery for slow solves and raises confidence with interviews", () => {
    const fast = topicMastery([ev({ solveSeconds: 600 })], ["graphs"], now)[0]!;
    const slow = topicMastery([ev({ solveSeconds: 5000 })], ["graphs"], now)[0]!;
    expect(slow.mastery).toBeLessThan(fast.mastery);
    const withInterview = topicMastery([ev()], ["graphs"], now, () => 1, {
      graphs: { score: 0.2, n: 3 },
    })[0]!;
    expect(withInterview.mastery).toBeLessThan(1);
    expect(withInterview.confidence).toBeGreaterThan(
      topicMastery([ev()], ["graphs"], now)[0]!.confidence,
    );
    expect(withInterview.signals?.interview).toBe(0.2);
  });
  it("keeps the weakness ranking stable after one extra submission", () => {
    const base: ProblemEvidence[] = [];
    for (let i = 0; i < 6; i++) {
      base.push(ev({ slug: `g${i}`, topics: ["graphs"], solved: i < 2, firstTry: false }));
      base.push(ev({ slug: `d${i}`, topics: ["dp"], solved: i < 5, firstTry: i < 3 }));
    }
    const rank = (e: ProblemEvidence[]) =>
      topicMastery(e, ["graphs", "dp"], now)
        .sort((a, b) => b.weakness - a.weakness)
        .map((m) => m.topic);
    const extra = [...base, ev({ slug: "d9", topics: ["dp"], solved: false })];
    expect(rank(extra)).toEqual(rank(base));
  });
});

const fullInputs = (score: number, confidence = 1): ComponentInputs =>
  Object.fromEntries(
    READINESS_COMPONENTS.map((k) => [k, { score, confidence }]),
  ) as ComponentInputs;
const none = (): ComponentInputs =>
  Object.fromEntries(
    READINESS_COMPONENTS.map((k) => [k, { score: null, confidence: 0 }]),
  ) as ComponentInputs;

describe("readiness (A4)", () => {
  const today = "2026-03-10";
  it("default weights sum to 100", () => {
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("is deterministic", () => {
    const a = computeReadiness(fullInputs(0.6), { today });
    const b = computeReadiness(fullInputs(0.6), { today });
    expect(b).toEqual(a);
    expect(a.score).toBe(60);
  });
  it("withholds the score and points to the diagnostic when there is no data", () => {
    const r = computeReadiness(none(), { today });
    expect(r.score).toBeNull();
    expect(r.band).toBeNull();
    expect(r.label).toBe("Not enough data");
    expect(r.eta.message).toMatch(/diagnostic/i);
    expect(r.components.every((c) => c.score === null)).toBe(true);
  });
  it("withholds the score when the evidence is a sliver", () => {
    const i = none();
    i.consistency = { score: 1, confidence: 0.3 };
    expect(computeReadiness(i, { today }).score).toBeNull();
  });
  it("redistributes the weight of components without data", () => {
    const i = none();
    i.dsa_breadth = { score: 0.8, confidence: 1 };
    i.interview = { score: 0.4, confidence: 1 };
    const r = computeReadiness(i, { today });
    // weights 30 and 20 renormalise to 0.6 and 0.4
    expect(r.score).toBe(Math.round(0.6 * 80 + 0.4 * 40));
    expect(r.components.find((c) => c.key === "cs")!.score).toBeNull();
  });
  it("does not call a learner ready on a handful of clean solves", () => {
    const thin = fullInputs(1, 0.1); // perfect on almost no evidence
    const solid = fullInputs(1, 1);
    expect(computeReadiness(solid, { today }).score).toBe(100);
    const r = computeReadiness(thin, { today });
    expect(r.score).toBeLessThan(45);
    expect(r.label).not.toBe("Ready");
    expect(r.band).toBeGreaterThan(15);
  });
  it("widens the band as evidence thins", () => {
    const solid = computeReadiness(fullInputs(0.7, 1), { today });
    const thin = computeReadiness(fullInputs(0.7, 0.3), { today });
    expect(thin.band!).toBeGreaterThan(solid.band!);
    expect(solid.band).toBe(3);
  });
  it("names the limiting components and the highest-leverage actions", () => {
    const i = fullInputs(0.9);
    i.dsa_breadth = { score: 0.4, confidence: 1 };
    i.communication = { score: 0.5, confidence: 1 };
    const r = computeReadiness(i, {
      today,
      topicGaps: [
        { topic: "graphs", name: "Graphs", mastery: 0.2, share: 0.4 },
        { topic: "arrays", name: "Arrays", mastery: 0.85, share: 0.6 },
      ],
    });
    expect(r.limiting[0]!.key).toBe("dsa_breadth");
    expect(r.levers[0]!.action).toMatch(/Graphs/);
    expect(r.levers.every((l) => l.gain > 0)).toBe(true);
    expect(r.levers.some((l) => /Arrays/.test(l.action))).toBe(false);
  });
  it("estimates a date from the trend and compares it with the placement date", () => {
    const history = Array.from({ length: 8 }, (_, i) => ({
      date: `2026-03-0${i + 2}`,
      score: 40 + i * 2,
    }));
    const on = estimateEta(54, history, today, "2026-04-30");
    expect(on.date).toBe("2026-03-21"); // 21 points at 2 per day is 11 days
    expect(on.onTrack).toBe(true);
    const late = estimateEta(54, history, today, "2026-03-15");
    expect(late.onTrack).toBe(false);
    expect(late.message).toMatch(/step up/);
  });
  it("gives no date without a trend", () => {
    expect(estimateEta(50, [], today, null).date).toBeNull();
    expect(
      estimateEta(
        50,
        [
          { date: "2026-03-01", score: 50 },
          { date: "2026-03-05", score: 50 },
          { date: "2026-03-09", score: 50 },
        ],
        today,
        null,
      ).date,
    ).toBeNull();
    expect(estimateEta(80, [], today, null).message).toMatch(/there/);
  });
});

const sess = (i: number, over: Partial<TrendSession> = {}): TrendSession => ({
  id: `s${i}`,
  at: `2026-03-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
  type: "dsa",
  persona: "neutral",
  difficulty: 3,
  company: null,
  overall: 50 + i * 3,
  dimensions: { communication: 2 + (i > 4 ? 1 : 0) },
  completion: 0.9,
  redFlags: [],
  ...over,
});

describe("interview trends (A3)", () => {
  it("computes a moving average with best and worst markers", () => {
    const t = interviewTrends([0, 1, 2, 3].map((i) => sess(i)));
    expect(t.points.map((p) => p.overall)).toEqual([50, 53, 56, 59]);
    expect(t.points[2]!.moving).toBe(53);
    expect(t.best).toBe("s3");
    expect(t.worst).toBe("s0");
  });
  it("leaves out abandoned sessions unless asked", () => {
    const all = [sess(0), sess(1, { completion: 0.1 }), sess(2)];
    expect(interviewTrends(all).excluded).toBe(1);
    expect(interviewTrends(all).points).toHaveLength(2);
    expect(interviewTrends(all, { includeAbandoned: true }).points).toHaveLength(3);
  });
  it("marks a change of persona or difficulty so a dip is not misread", () => {
    const t = interviewTrends([
      sess(0),
      sess(1, { persona: "strict" }),
      sess(2, { persona: "strict" }),
    ]);
    expect(t.points.map((p) => p.settingsChanged)).toEqual([false, true, false]);
  });
  it("shows deltas over the last five sessions", () => {
    const t = interviewTrends(Array.from({ length: 10 }, (_, i) => sess(i)));
    const d = t.deltas.find((x) => x.dimension === "communication")!;
    expect(d.delta).toBeGreaterThan(0);
  });
  it("flags a recurring red flag as a habit", () => {
    const t = interviewTrends(
      [0, 1, 2, 3, 4].map((i) => sess(i, { redFlags: i === 4 ? [] : ["Skips edge cases"] })),
    );
    expect(t.habits).toHaveLength(1);
    expect(t.habits[0]!.message).toMatch(/4 of your last 5/);
  });
  it("handles an empty history", () => {
    const t = interviewTrends([]);
    expect(t.points).toEqual([]);
    expect(t.best).toBeNull();
  });
});

describe("daily goals (P2)", () => {
  const facts = {
    problemsToday: 2,
    xpToday: 30,
    interviewsThisWeek: 0,
    planTasksDone: 1,
    planTasksTotal: 3,
  };
  it("tracks progress and completion", () => {
    const g = evaluateGoals(GOAL_PRESETS.standard.items, facts);
    expect(g[0]).toMatchObject({ type: "problems", progress: 2, done: true });
    expect(g[1]).toMatchObject({ type: "interviews_week", done: false });
    expect(goalsComplete(g)).toBe(false);
    expect(goalsComplete(evaluateGoals([{ type: "problems", target: 2 }], facts))).toBe(true);
  });
  it("follows today's plan and ignores it when nothing is planned", () => {
    const withPlan = evaluateGoals([{ type: "plan_tasks", target: 1 }], facts);
    expect(withPlan[0]).toMatchObject({ target: 3, progress: 1, done: false });
    expect(
      evaluateGoals([{ type: "plan_tasks", target: 1 }], { ...facts, planTasksTotal: 0 }),
    ).toEqual([]);
  });
  it("normalises duplicates and silly targets", () => {
    expect(
      normalizeGoals([
        { type: "problems", target: 0 },
        { type: "problems", target: 3 },
        { type: "xp", target: 9999 },
      ]),
    ).toEqual([
      { type: "problems", target: 1 },
      { type: "xp", target: 50 },
    ]);
  });
  it("suggests lowering a missed goal and raising an easy one", () => {
    const days = (done: (i: number) => boolean) =>
      Array.from({ length: 14 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, "0")}`,
        completed: done(i),
      }));
    expect(suggestGoalChange(days(() => false))?.direction).toBe("lower");
    expect(suggestGoalChange(days(() => true))?.direction).toBe("raise");
    expect(suggestGoalChange(days((i) => i % 2 === 0))).toBeNull();
    expect(suggestGoalChange(days(() => false).slice(0, 5))).toBeNull();
  });
});

const TOPICS = ["arrays", "strings", "graphs", "dp", "trees"];
const problems = (): PlanProblem[] =>
  TOPICS.flatMap((t) =>
    (["easy", "easy", "medium", "medium", "hard"] as const).map((d, i) => ({
      slug: `${t}-${i}`,
      title: `${t} ${i}`,
      difficulty: d,
      topics: [t],
      solved: false,
      shaky: false,
      lastAt: null,
    })),
  );
const masteries = (over: Record<string, { mastery: number; attempted: number }> = {}) =>
  TOPICS.map((topic) => {
    const o = over[topic] ?? { mastery: 0, attempted: 0 };
    return {
      topic,
      mastery: o.mastery,
      confidence: o.attempted ? 1 : 0,
      weakness: o.attempted ? 1 - o.mastery : 0,
      stage: "seed" as const,
      attempted: o.attempted,
      solved: 0,
      diagnosis: null,
    };
  });
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  masteries: masteries({ graphs: { mastery: 0.2, attempted: 5 } }),
  problems: problems(),
  importance: () => 1,
  topicName: (t) => t,
  now: at("2026-03-02T00:00:00Z"),
  ...over,
});
const inputs = (over: Partial<PlanInputs> = {}): PlanInputs => ({
  ...DEFAULT_INPUTS,
  startDate: "2026-03-02", // a Monday
  ...over,
});

describe("study plan (P1)", () => {
  it("is deterministic", () => {
    const i = inputs({ placementDate: "2026-04-15" });
    expect(generatePlan(ctx(), i).tasks).toEqual(generatePlan(ctx(), i).tasks);
  });

  it("never schedules more than the user's available time on a day", () => {
    for (const hours of [0.5, 1, 2, 4]) {
      for (const restDays of [[], ["sat", "sun"]] as const) {
        const i = inputs({
          defaultHours: hours,
          restDays: [...restDays],
          placementDate: "2026-04-10",
          mockPerWeek: 2,
        });
        const plan = generatePlan(ctx(), i);
        for (const [day, minutes] of Object.entries(plan.minutesPerDay)) {
          expect(minutes, `${day} at ${hours}h`).toBeLessThanOrEqual(capacityMinutes(i, day));
        }
      }
    }
  });

  it("keeps rest days empty and honours per-weekday hours", () => {
    const i = inputs({
      restDays: ["sun"],
      hoursPerDay: { sat: 4, mon: 0 },
      placementDate: "2026-03-30",
    });
    const plan = generatePlan(ctx(), i);
    expect(plan.tasks.filter((t) => weekdayOf(t.date) === "sun")).toHaveLength(0);
    expect(plan.tasks.filter((t) => weekdayOf(t.date) === "mon")).toHaveLength(0);
    expect(plan.tasks.some((t) => weekdayOf(t.date) === "sat")).toBe(true);
  });

  it("covers the period with phases in order and ends before the placement date", () => {
    const phases = planPhases("2026-03-02", "2026-04-30");
    expect(phases.map((p) => p.name)).toEqual([
      "foundations",
      "pattern_mastery",
      "company_focus",
      "mock_intensive",
      "final_polish",
    ]);
    expect(phases[0]!.start).toBe("2026-03-02");
    expect(phases.at(-1)!.end).toBe("2026-04-30");
    const plan = generatePlan(ctx(), inputs({ placementDate: "2026-04-01" }));
    expect(plan.tasks.every((t) => t.date < "2026-04-01")).toBe(true);
    expect(planPhases("2026-03-02", "2026-03-08").map((p) => p.name)).toEqual([
      "mock_intensive",
      "final_polish",
    ]);
  });

  it("starts the weakest topics first and never schedules solved problems", () => {
    const ps = problems().map((p) => (p.slug === "graphs-0" ? { ...p, solved: true } : p));
    const plan = generatePlan(ctx({ problems: ps }), inputs({ placementDate: "2026-04-15" }));
    const probs = plan.tasks.filter((t) => t.kind === "problem");
    expect(probs.some((t) => t.ref === "graphs-0")).toBe(false);
    expect(probs[0]!.topic).toBe("graphs");
    expect(probs[0]!.why).toMatch(/Weak spot/);
  });

  it("does not fill a day with one topic", () => {
    const plan = generatePlan(ctx(), inputs({ defaultHours: 4, placementDate: "2026-03-20" }));
    const day = plan.tasks.filter((t) => t.kind === "problem" && t.date === "2026-03-02");
    expect(day.length).toBeGreaterThan(2);
    expect(new Set(day.map((t) => t.topic)).size).toBeGreaterThan(1);
  });

  it("schedules mock interviews each week once the foundations are laid", () => {
    const plan = generatePlan(ctx(), inputs({ placementDate: "2026-05-01", mockPerWeek: 1 }));
    const mocks = plan.tasks.filter((t) => t.kind === "mock");
    expect(mocks.length).toBeGreaterThan(3);
    expect(new Set(mocks.map((m) => m.key)).size).toBe(mocks.length);
    const first = plan.phases[0]!;
    expect(mocks.every((m) => m.date > first.end)).toBe(true);
  });

  it("keeps history and locked tasks and re-plans only what is left to do", () => {
    const i = inputs({ placementDate: "2026-04-15" });
    const first = generatePlan(ctx(), i);
    const stored: PlanTask[] = first.tasks.map((t, n) => ({ ...t, id: `t${n}` }));
    const doneTask = stored.find((t) => t.kind === "problem")!;
    const lockedTask = stored.find((t) => t.kind === "problem" && t.date > "2026-03-04")!;
    doneTask.status = "done";
    lockedTask.locked = true;
    const today = "2026-03-04";
    const again = generatePlan(ctx(), i, stored, today);
    const find = (key: string) => again.tasks.find((t) => t.key === key)!;
    expect(find(doneTask.key)).toMatchObject({ status: "done", date: doneTask.date });
    expect(find(lockedTask.key)).toMatchObject({ locked: true, date: lockedTask.date });
    expect(again.tasks.filter((t) => t.key === lockedTask.key)).toHaveLength(1);
    // locked time still counts against the day
    for (const [day, minutes] of Object.entries(again.minutesPerDay)) {
      if (day >= today) expect(minutes).toBeLessThanOrEqual(capacityMinutes(i, day));
    }
  });

  it("rolls missed problems forward with priority and says so", () => {
    const i = inputs({ placementDate: "2026-04-15" });
    const first = generatePlan(ctx(), i);
    const stored = first.tasks.map((t, n) => ({ ...t, id: `t${n}` }));
    const missed = stored.filter((t) => t.kind === "problem" && t.date < "2026-03-05");
    expect(missed.length).toBeGreaterThan(0);
    const again = generatePlan(ctx(), i, stored, "2026-03-05");
    expect(again.carried.sort()).toEqual(missed.map((m) => m.ref!).sort());
    for (const m of missed) {
      const re = again.tasks.find((t) => t.key === m.key)!;
      expect(re.date >= "2026-03-05").toBe(true);
    }
    // the carried problems come before anything new on the first available day
    const todayKeys = again.tasks
      .filter((t) => t.kind === "problem" && t.date === "2026-03-05")
      .map((t) => t.ref);
    expect(missed.some((m) => todayKeys.includes(m.ref))).toBe(true);
    expect(again.warnings.join(" ")).toMatch(/rolled forward/);
    expect(again.diff.moved.length).toBeGreaterThan(0);
  });

  it("does not bring back problems the user skipped", () => {
    const i = inputs({ placementDate: "2026-04-15" });
    const first = generatePlan(ctx(), i);
    const stored = first.tasks.map((t) => ({ ...t }));
    const skipped = stored.find((t) => t.kind === "problem")!;
    skipped.status = "skipped";
    const again = generatePlan(ctx(), i, stored, "2026-03-02");
    expect(again.tasks.filter((t) => t.key === skipped.key && t.status === "todo")).toHaveLength(0);
  });

  it("warns and says what was left out when everything cannot fit", () => {
    const plan = generatePlan(ctx(), inputs({ placementDate: "2026-03-09", defaultHours: 1 }));
    expect(plan.warnings.join(" ")).toMatch(/Not everything fits before 2026-03-09/);
    const none = generatePlan(ctx(), inputs({ defaultHours: 0, placementDate: "2026-03-20" }));
    expect(none.tasks).toHaveLength(0);
    expect(none.warnings.join(" ")).toMatch(/No study time/);
  });

  it("copes with a placement date in the past", () => {
    const plan = generatePlan(ctx(), inputs({ placementDate: "2026-01-01" }));
    expect(plan.warnings[0]).toMatch(/passed/);
    expect(plan.tasks.length).toBeGreaterThan(0);
  });

  it("schedules reviews of shaky solves after a few days", () => {
    const ps = problems().map((p) =>
      p.slug === "arrays-0"
        ? { ...p, solved: true, shaky: true, lastAt: at("2026-02-20T00:00:00Z") }
        : p,
    );
    const plan = generatePlan(ctx({ problems: ps }), inputs({ placementDate: "2026-04-15" }));
    const review = plan.tasks.find((t) => t.kind === "review");
    expect(review?.ref).toBe("arrays-0");
  });

  it("weights topics by the target's importance", () => {
    const plain = generatePlan(ctx(), inputs({ placementDate: "2026-04-15" }));
    const biased = generatePlan(
      ctx({ importance: (t) => (t === "dp" ? 3 : 0.5) }),
      inputs({ placementDate: "2026-04-15" }),
    );
    const firstTopic = (p: typeof plain) => p.tasks.find((t) => t.kind === "problem")!.topic;
    expect(firstTopic(biased)).toBe("dp");
    expect(firstTopic(plain)).toBe("graphs");
  });

  it("summarises a diff and adapts efficiency", () => {
    const base: PlanTask = {
      key: "problem:a",
      kind: "problem",
      refType: "problem",
      ref: "a",
      title: "A",
      estMinutes: 20,
      date: "2026-03-02",
      why: "",
      status: "todo",
      locked: false,
      phase: "foundations",
    };
    const d = diffPlans(
      [base, { ...base, key: "problem:b", title: "B" }],
      [
        { ...base, date: "2026-03-03" },
        { ...base, key: "problem:c", title: "C" },
      ],
    );
    expect(d.moved).toHaveLength(1);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(1);
    expect(d.summary).toBe("1 moved, 1 added, 1 removed, 0 unchanged");
    expect(diffPlans([base], [base]).summary).toBe("No changes");
    expect(adaptEfficiency(0.8, 600, 200)).toBeLessThan(0.8);
    expect(adaptEfficiency(0.8, 600, 600)).toBeGreaterThan(0.8);
    expect(adaptEfficiency(0.8, 60, 0)).toBe(0.8);
    expect(adaptEfficiency(0.5, 600, 0)).toBe(0.5);
  });
});
