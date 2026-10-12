// Adaptive study plan (doc 04 P1). Pure and deterministic: the same inputs give the same plan. The API
// loads the user's mastery and problems, calls `generatePlan` (first plan, re-plan, nightly job) and stores
// the result. A language model may write the narrative around it but never schedules anything.
//
// Rules the tests pin down: a day never holds more minutes than the user has; completed and skipped
// tasks are history and never move; locked tasks stay where they are and use up their day's time; missed
// tasks roll forward with priority; the same topic does not fill a whole day; if everything cannot fit
// before the placement date, the plan says what was dropped.

import { addDays, daysBetween } from "./streak.js";
import { WEAK_BELOW, type TopicMastery } from "./mastery.js";
import type { DifficultyName } from "./xp.js";

export type WeekdayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export const WEEKDAYS: readonly WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type TaskKind =
  "problem" | "mock" | "review" | "quiz" | "aptitude" | "reading" | "flashcards";
export type TaskStatus = "todo" | "done" | "skipped" | "moved";
export type PhaseName =
  "foundations" | "pattern_mastery" | "company_focus" | "mock_intensive" | "final_polish";

export const PHASE_LABEL: Record<PhaseName, string> = {
  foundations: "Foundations",
  pattern_mastery: "Pattern Mastery",
  company_focus: "Company Focus",
  mock_intensive: "Mock Intensive",
  final_polish: "Final Polish",
};

export interface PlanInputs {
  /** The first day of the plan (the user's today). */
  startDate: string;
  placementDate: string | null;
  /** Hours available per weekday; a missing weekday uses `defaultHours`. */
  hoursPerDay: Partial<Record<WeekdayKey, number>>;
  defaultHours: number;
  restDays: WeekdayKey[];
  /** Share of the available time actually usable for planned tasks (starts at 0.8, adapts). */
  efficiency: number;
  /** Mock interviews per week in the middle phases. */
  mockPerWeek: number;
  /** Interview types the planner may schedule (the API drops resume-based ones without a resume). */
  mockTypes: string[];
  packSlug: string | null;
}

export const DEFAULT_INPUTS: Omit<PlanInputs, "startDate"> = {
  placementDate: null,
  hoursPerDay: {},
  defaultHours: 1.5,
  restDays: [],
  efficiency: 0.8,
  mockPerWeek: 1,
  mockTypes: ["dsa", "cs", "behavioral"],
  packSlug: null,
};

export interface PlanTask {
  /** Database id when the task already exists. */
  id?: string;
  /** Stable identity across re-plans: `problem:<slug>`, `review:<slug>`, `mock:<type>:<week start>`. */
  key: string;
  kind: TaskKind;
  refType: "problem" | "interview" | null;
  ref: string | null;
  title: string;
  estMinutes: number;
  date: string;
  why: string;
  status: TaskStatus;
  locked: boolean;
  phase: PhaseName;
  topic?: string | null;
}

export interface PlanProblem {
  slug: string;
  title: string;
  difficulty: DifficultyName;
  topics: string[];
  solved: boolean;
  /** Solved, but needed hints or several tries: a candidate for a review. */
  shaky: boolean;
  /** When the user last solved or tried it. */
  lastAt: Date | null;
}

export interface PlanContext {
  masteries: readonly TopicMastery[];
  problems: readonly PlanProblem[];
  /** Topic importance for the target (1 = neutral). */
  importance: (topic: string) => number;
  /** Display names for topics. */
  topicName: (topic: string) => string;
  /** The weakest topic, if any, for mock interview focus. */
  now: Date;
}

export interface PlanPhase {
  name: PhaseName;
  label: string;
  start: string;
  end: string;
}

export interface PlanDiff {
  added: { key: string; title: string; date: string }[];
  removed: { key: string; title: string; date: string }[];
  moved: { key: string; title: string; from: string; to: string }[];
  unchanged: number;
  summary: string;
}

export interface GeneratedPlan {
  tasks: PlanTask[];
  phases: PlanPhase[];
  warnings: string[];
  /** Missed tasks that were rolled forward. */
  carried: string[];
  diff: PlanDiff;
  minutesPerDay: Record<string, number>;
  /** First and last day tasks were generated for. */
  from: string;
  until: string;
}

const MAX_DAYS = 120;
const DEFAULT_HORIZON_DAYS = 56;
const MOCK_MINUTES = 45;
const REVIEW_MINUTES = 15;
const EST_MINUTES: Record<DifficultyName, number> = { easy: 20, medium: 35, hard: 55 };
const LADDER: DifficultyName[] = ["easy", "medium", "hard"];

/** Where each topic sits in a sensible learning order; unknown topics follow alphabetically. */
export const TOPIC_ORDER = [
  "arrays",
  "strings",
  "hashing",
  "two-pointers",
  "sliding-window",
  "stack",
  "queue",
  "linked-list",
  "binary-search",
  "recursion",
  "sorting",
  "trees",
  "bst",
  "heap",
  "graphs",
  "greedy",
  "backtracking",
  "dp",
  "dynamic-programming",
  "trie",
];

const PHASE_SHARES: [PhaseName, number][] = [
  ["foundations", 0.2],
  ["pattern_mastery", 0.35],
  ["company_focus", 0.2],
  ["mock_intensive", 0.15],
  ["final_polish", 0.1],
];

interface PhaseRules {
  difficulties: DifficultyName[];
  /** Mock interviews per week as a multiple of `mockPerWeek`. */
  mockFactor: number;
  /** Share of a day's time given to reviews of earlier shaky solves. */
  reviewShare: number;
  /** Fresh topics (never tried) are ranked this fraction of their importance. */
  freshWeight: number;
  mockTypes: string[];
}

const RULES: Record<PhaseName, PhaseRules> = {
  foundations: {
    difficulties: ["easy"],
    mockFactor: 0,
    reviewShare: 0.1,
    freshWeight: 0.6,
    mockTypes: [],
  },
  pattern_mastery: {
    difficulties: ["easy", "medium"],
    mockFactor: 1,
    reviewShare: 0.15,
    freshWeight: 0.5,
    mockTypes: ["dsa", "cs"],
  },
  company_focus: {
    difficulties: ["medium", "hard"],
    mockFactor: 1,
    reviewShare: 0.15,
    freshWeight: 0.3,
    mockTypes: ["dsa", "behavioral", "cs"],
  },
  mock_intensive: {
    difficulties: ["medium", "hard"],
    mockFactor: 2,
    reviewShare: 0.15,
    freshWeight: 0.2,
    mockTypes: ["dsa", "behavioral", "cs", "project"],
  },
  final_polish: {
    difficulties: ["easy", "medium"],
    mockFactor: 1,
    reviewShare: 0.4,
    freshWeight: 0.1,
    mockTypes: ["dsa", "behavioral"],
  },
};

export const weekdayOf = (day: string): WeekdayKey =>
  WEEKDAYS[new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay()]!;

/** Monday of the week containing `day`. */
export const weekStart = (day: string): string => {
  const d = new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();
  return addDays(day, -((d + 6) % 7));
};

/** Minutes of planned work available on a day. */
export function capacityMinutes(inputs: PlanInputs, day: string): number {
  const key = weekdayOf(day);
  if (inputs.restDays.includes(key)) return 0;
  const hours = inputs.hoursPerDay[key] ?? inputs.defaultHours;
  return Math.max(0, Math.floor(hours * 60 * inputs.efficiency));
}

/** Efficiency moves towards what the user actually completes (clamped to 0.5 to 1). */
export function adaptEfficiency(
  previous: number,
  plannedMinutes: number,
  completedMinutes: number,
): number {
  if (plannedMinutes < 120) return previous;
  const ratio = Math.min(1.2, completedMinutes / plannedMinutes);
  const next = 0.7 * previous + 0.3 * ratio;
  return Math.round(Math.max(0.5, Math.min(1, next)) * 100) / 100;
}

/** The five phases laid over [start, end]; very short plans only get the last two. */
export function planPhases(start: string, end: string): PlanPhase[] {
  const total = daysBetween(start, end) + 1;
  if (total <= 0) return [];
  const shares: [PhaseName, number][] =
    total < 14
      ? [
          ["mock_intensive", 0.6],
          ["final_polish", 0.4],
        ]
      : total < 28
        ? [
            ["pattern_mastery", 0.4],
            ["mock_intensive", 0.35],
            ["final_polish", 0.25],
          ]
        : PHASE_SHARES;
  const out: PlanPhase[] = [];
  let cursor = 0;
  shares.forEach(([name, share], i) => {
    const len = i === shares.length - 1 ? total - cursor : Math.max(1, Math.round(total * share));
    if (len <= 0 || cursor >= total) return;
    out.push({
      name,
      label: PHASE_LABEL[name],
      start: addDays(start, cursor),
      end: addDays(start, Math.min(total - 1, cursor + len - 1)),
    });
    cursor += len;
  });
  return out;
}

const phaseOn = (phases: readonly PlanPhase[], day: string): PhaseName =>
  (phases.find((p) => day >= p.start && day <= p.end) ?? phases[phases.length - 1])?.name ??
  "pattern_mastery";

const topicRank = (topic: string) => {
  const i = TOPIC_ORDER.indexOf(topic);
  return i === -1 ? TOPIC_ORDER.length : i;
};

const idealDifficulty = (m: TopicMastery): number =>
  m.attempted === 0 || m.mastery < 0.4 ? 0 : m.mastery < WEAK_BELOW ? 1 : 2;

/**
 * Problems in the order they should be done for a phase: carried-over ones first, then topics by
 * priority (weak and important first; untried topics weighted by the phase), round-robin across topics so
 * one topic does not take over, each topic's problems nearest the user's level first.
 */
export function rankProblems(
  ctx: PlanContext,
  phase: PhaseName,
  exclude: ReadonlySet<string>,
  carried: readonly string[],
): { problem: PlanProblem; topic: string; why: string }[] {
  const rules = RULES[phase];
  const bySlug = new Map(ctx.problems.map((p) => [p.slug, p]));
  const out: { problem: PlanProblem; topic: string; why: string }[] = [];
  const used = new Set<string>(exclude);

  for (const slug of carried) {
    const p = bySlug.get(slug);
    if (!p || p.solved || used.has(slug)) continue;
    used.add(slug);
    out.push({ problem: p, topic: p.topics[0] ?? "", why: "Carried over from a day you missed." });
  }

  const priority = (m: TopicMastery) =>
    (m.attempted === 0 ? rules.freshWeight : Math.max(0.05, 1 - m.mastery)) *
    ctx.importance(m.topic);
  const topics = [...ctx.masteries].sort(
    (a, b) =>
      priority(b) - priority(a) ||
      topicRank(a.topic) - topicRank(b.topic) ||
      a.topic.localeCompare(b.topic),
  );

  const lists = topics.map((m) => {
    const ideal = idealDifficulty(m);
    const items = ctx.problems
      .filter(
        (p) => !p.solved && p.topics.includes(m.topic) && rules.difficulties.includes(p.difficulty),
      )
      .sort(
        (a, b) =>
          Math.abs(LADDER.indexOf(a.difficulty) - ideal) -
            Math.abs(LADDER.indexOf(b.difficulty) - ideal) || a.slug.localeCompare(b.slug),
      );
    return { m, items };
  });

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const { m, items } of lists) {
      const next = items.find((p) => !used.has(p.slug));
      if (!next) continue;
      used.add(next.slug);
      progressed = true;
      const name = ctx.topicName(m.topic);
      out.push({
        problem: next,
        topic: m.topic,
        why:
          m.attempted === 0
            ? `New topic: ${name}.`
            : m.mastery < WEAK_BELOW
              ? `Weak spot: ${name} (${Math.round(m.mastery * 100)}% so far).`
              : `Keep ${name} sharp (${Math.round(m.mastery * 100)}% so far).`,
      });
    }
  }
  return out;
}

const taskKeyMock = (type: string, day: string) => `mock:${type}:${weekStart(day)}`;

const MOCK_TITLE: Record<string, string> = {
  dsa: "Mock interview: coding round",
  cs: "Mock interview: CS fundamentals",
  behavioral: "Mock interview: behavioural round",
  project: "Mock interview: project deep-dive",
  resume: "Mock interview: resume walk-through",
  lld: "Mock interview: low-level design",
  hld: "Mock interview: system design",
};

export function diffPlans(before: readonly PlanTask[], after: readonly PlanTask[]): PlanDiff {
  const b = new Map(before.map((t) => [t.key, t]));
  const a = new Map(after.map((t) => [t.key, t]));
  const added = [...a.values()]
    .filter((t) => !b.has(t.key))
    .map((t) => ({ key: t.key, title: t.title, date: t.date }));
  const removed = [...b.values()]
    .filter((t) => !a.has(t.key))
    .map((t) => ({ key: t.key, title: t.title, date: t.date }));
  const moved = [...a.values()]
    .filter((t) => b.has(t.key) && b.get(t.key)!.date !== t.date)
    .map((t) => ({ key: t.key, title: t.title, from: b.get(t.key)!.date, to: t.date }));
  const unchanged = [...a.values()].filter(
    (t) => b.has(t.key) && b.get(t.key)!.date === t.date,
  ).length;
  const parts = [
    moved.length ? `${moved.length} moved` : null,
    added.length ? `${added.length} added` : null,
    removed.length ? `${removed.length} removed` : null,
  ].filter(Boolean);
  return {
    added,
    removed,
    moved,
    unchanged,
    summary: parts.length ? `${parts.join(", ")}, ${unchanged} unchanged` : "No changes",
  };
}

/**
 * Builds (or rebuilds) the plan from `today`. `existing` is the stored plan: finished and skipped tasks are
 * history and stay, locked tasks stay on their day, missed tasks roll forward, everything else still to do
 * is regenerated.
 */
export function generatePlan(
  ctx: PlanContext,
  inputs: PlanInputs,
  existing: readonly PlanTask[] = [],
  today: string = inputs.startDate,
): GeneratedPlan {
  const warnings: string[] = [];
  const placement =
    inputs.placementDate && inputs.placementDate > today ? inputs.placementDate : null;
  if (inputs.placementDate && !placement) {
    warnings.push(
      "Your placement date has passed or is today: the plan covers the next eight weeks.",
    );
  }
  const horizonEnd = placement ? addDays(placement, -1) : addDays(today, DEFAULT_HORIZON_DAYS - 1);
  const phases = planPhases(today, horizonEnd < today ? today : horizonEnd);
  const until =
    horizonEnd < today
      ? today
      : addDays(today, Math.min(MAX_DAYS, daysBetween(today, horizonEnd) + 1) - 1);

  // ---- split what exists into history, locked tasks, missed tasks and tasks to regenerate
  const history: PlanTask[] = [];
  const kept: PlanTask[] = [];
  const carriedKeys: string[] = [];
  const out: PlanTask[] = [];
  for (const t of existing) {
    if (t.status === "done" || t.status === "skipped") {
      history.push(t);
    } else if (t.locked && t.date >= today) {
      kept.push(t);
    } else if (t.date < today) {
      // missed: only problems roll forward; the rest is simply regenerated on a new day
      if (t.kind === "problem" && t.ref) carriedKeys.push(t.ref);
    }
  }
  // a locked task whose day has passed also moves to today
  for (const t of existing) {
    if (t.locked && t.status === "todo" && t.date < today) kept.push({ ...t, date: today });
  }
  const skippedSlugs = new Set(
    history.filter((t) => t.status === "skipped" && t.ref).map((t) => t.ref!),
  );
  const doneRefs = new Set(
    history.filter((t) => t.status === "done" && t.ref).map((t) => `${t.kind}:${t.ref}`),
  );
  const lockedRefs = new Set(kept.filter((t) => t.ref).map((t) => `${t.kind}:${t.ref}`));

  const usedMinutes: Record<string, number> = {};
  const addMinutes = (day: string, m: number) => (usedMinutes[day] = (usedMinutes[day] ?? 0) + m);
  for (const t of history) if (t.date >= today) addMinutes(t.date, t.estMinutes);
  for (const t of kept) addMinutes(t.date, t.estMinutes);
  out.push(...kept);

  const scheduled = new Set<string>(); // problem slugs placed this run or locked
  for (const t of kept) if (t.kind === "problem" && t.ref) scheduled.add(t.ref);
  const exclude = new Set<string>([...skippedSlugs, ...scheduled]);
  for (const t of history) if (t.kind === "problem" && t.ref) exclude.add(t.ref);

  const days: string[] = [];
  for (let d = today; d <= until; d = addDays(d, 1)) days.push(d);

  // ---- mock interview days, per week
  const mockDays = new Map<string, string>(); // day -> interview type
  const weeks = new Map<string, string[]>();
  for (const d of days) weeks.set(weekStart(d), [...(weeks.get(weekStart(d)) ?? []), d]);
  let mockIndex = 0;
  const topWeak = [...ctx.masteries]
    .filter((m) => m.attempted > 0 && m.mastery < WEAK_BELOW)
    .sort((a, b) => b.weakness - a.weakness || a.topic.localeCompare(b.topic))[0];
  for (const [wk, wkDays] of [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const phase = phaseOn(phases, wkDays[wkDays.length - 1]!);
    const rules = RULES[phase];
    const count = Math.round(inputs.mockPerWeek * rules.mockFactor);
    if (count <= 0) continue;
    const types = rules.mockTypes.filter((t) => inputs.mockTypes.includes(t));
    if (types.length === 0) continue;
    const roomy = wkDays
      .filter((d) => capacityMinutes(inputs, d) - (usedMinutes[d] ?? 0) >= MOCK_MINUTES)
      .filter((d) => !history.some((h) => h.kind === "mock" && h.date === d))
      .sort(
        (a, b) => capacityMinutes(inputs, b) - capacityMinutes(inputs, a) || b.localeCompare(a),
      );
    const already = [...kept, ...history].filter(
      (t) => t.kind === "mock" && weekStart(t.date) === wk,
    ).length;
    for (const d of roomy.slice(0, Math.max(0, count - already)).sort()) {
      mockDays.set(d, types[mockIndex % types.length]!);
      mockIndex += 1;
    }
  }

  // ---- fill the days
  const reviewPool = ctx.problems
    .filter(
      (p) =>
        p.solved &&
        p.shaky &&
        p.lastAt !== null &&
        !skippedSlugs.has(p.slug) &&
        !doneRefs.has(`review:${p.slug}`) &&
        !lockedRefs.has(`review:${p.slug}`),
    )
    .sort((a, b) => a.lastAt!.getTime() - b.lastAt!.getTime() || a.slug.localeCompare(b.slug));
  const reviewed = new Set<string>();
  let lastPhase: PhaseName | null = null;
  let ranked: ReturnType<typeof rankProblems> = [];
  let cursor = 0;

  const place = (t: PlanTask) => {
    out.push(t);
    addMinutes(t.date, t.estMinutes);
  };

  for (const day of days) {
    const cap = capacityMinutes(inputs, day);
    let free = cap - (usedMinutes[day] ?? 0);
    if (free < 15) continue;
    const phase = phaseOn(phases, day);
    if (phase !== lastPhase) {
      ranked = rankProblems(ctx, phase, exclude, carriedKeys);
      cursor = 0;
      lastPhase = phase;
    }

    const mock = mockDays.get(day);
    if (mock && free >= MOCK_MINUTES) {
      const focus = mock === "dsa" && topWeak ? topWeak : null;
      const base = taskKeyMock(mock, day);
      place({
        key: `${base}:${[...history, ...out].filter((t) => t.key.startsWith(base)).length}`,
        kind: "mock",
        refType: "interview",
        ref: mock,
        title: MOCK_TITLE[mock] ?? "Mock interview",
        estMinutes: MOCK_MINUTES,
        date: day,
        why: focus
          ? `Weekly mock. Your weakest topic is ${ctx.topicName(focus.topic)}: ask for it.`
          : "Weekly mock to practise under pressure and get a scorecard.",
        status: "todo",
        locked: false,
        phase,
        topic: focus?.topic ?? null,
      });
      free -= MOCK_MINUTES;
    }

    // reviews first, capped by the phase's share of the day
    let reviewBudget = Math.floor(cap * RULES[phase].reviewShare);
    while (reviewBudget >= REVIEW_MINUTES && free >= REVIEW_MINUTES) {
      const r = reviewPool.find(
        (p) =>
          !reviewed.has(p.slug) &&
          p.lastAt !== null &&
          daysBetween(p.lastAt.toISOString().slice(0, 10), day) >= 3,
      );
      if (!r) break;
      reviewed.add(r.slug);
      place({
        key: `review:${r.slug}`,
        kind: "review",
        refType: "problem",
        ref: r.slug,
        title: `Review: ${r.title}`,
        estMinutes: REVIEW_MINUTES,
        date: day,
        why: "You needed help or several tries last time: solve it again from scratch.",
        status: "todo",
        locked: false,
        phase,
        topic: r.topics[0] ?? null,
      });
      free -= REVIEW_MINUTES;
      reviewBudget -= REVIEW_MINUTES;
    }

    // problems fill the rest; never the same topic three times in a row
    const dayTopics: string[] = [];
    let guard = 0;
    while (free >= 20 && guard++ < 40) {
      let pick = -1;
      for (let i = cursor; i < ranked.length && i < cursor + 8; i++) {
        const c = ranked[i]!;
        if (scheduled.has(c.problem.slug)) continue;
        if (EST_MINUTES[c.problem.difficulty] > free) continue;
        const n = dayTopics.length;
        if (n >= 2 && dayTopics[n - 1] === c.topic && dayTopics[n - 2] === c.topic) continue;
        pick = i;
        break;
      }
      if (pick === -1) break;
      const c = ranked[pick]!;
      ranked.splice(pick, 1);
      scheduled.add(c.problem.slug);
      dayTopics.push(c.topic);
      place({
        key: `problem:${c.problem.slug}`,
        kind: "problem",
        refType: "problem",
        ref: c.problem.slug,
        title: c.problem.title,
        estMinutes: EST_MINUTES[c.problem.difficulty],
        date: day,
        why: c.why,
        status: "todo",
        locked: false,
        phase,
        topic: c.topic || null,
      });
      free -= EST_MINUTES[c.problem.difficulty];
    }
  }

  // ---- feasibility: did the weak-topic work fit before the placement date?
  const demanded = rankProblems(ctx, "pattern_mastery", exclude, []).filter((c) => {
    const m = ctx.masteries.find((x) => x.topic === c.topic);
    return !!m && (m.attempted === 0 || m.mastery < WEAK_BELOW);
  });
  const missing = demanded.filter((c) => !scheduled.has(c.problem.slug));
  const totalCapacity = days.reduce((a, d) => a + capacityMinutes(inputs, d), 0);
  if (totalCapacity === 0) {
    warnings.push("No study time is available in this period: add hours or remove rest days.");
  } else if (placement && missing.length > 0) {
    const names = missing
      .slice(0, 5)
      .map((c) => c.problem.title)
      .join(", ");
    warnings.push(
      `Not everything fits before ${placement}: ${missing.length} lower-priority problem${missing.length === 1 ? " was" : "s were"} left out (${names}${missing.length > 5 ? ", ..." : ""}). More time per day would bring them back.`,
    );
  }
  if (carriedKeys.length > 0) {
    warnings.push(
      `${carriedKeys.length} missed task${carriedKeys.length === 1 ? "" : "s"} rolled forward.`,
    );
  }

  // within a day: mocks, then reviews, then problems in the order they were ranked (the sort is stable)
  const kindOrder = (k: TaskKind) => ({ mock: 0, review: 1, problem: 2 })[k as "mock"] ?? 3;
  const tasks = [...history, ...out].sort(
    (a, b) => a.date.localeCompare(b.date) || kindOrder(a.kind) - kindOrder(b.kind),
  );
  const before = existing.filter((t) => t.status !== "done" && t.status !== "skipped");
  const after = out.filter((t) => t.date >= today);
  const minutesPerDay: Record<string, number> = {};
  for (const t of tasks)
    if (t.status !== "skipped") minutesPerDay[t.date] = (minutesPerDay[t.date] ?? 0) + t.estMinutes;

  return {
    tasks,
    phases,
    warnings,
    carried: carriedKeys,
    diff: diffPlans(before, after),
    minutesPerDay,
    from: today,
    until,
  };
}
