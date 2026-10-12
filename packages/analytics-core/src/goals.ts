// Daily goals (doc 04 P2). Pure: presets, progress evaluation and the "lower or raise your goal" hint.
// Goals for quizzes, aptitude and spaced-repetition reviews join the list when those features exist.

export type GoalType = "problems" | "xp" | "interviews_week" | "plan_tasks";

export interface GoalItem {
  type: GoalType;
  /** For `plan_tasks` the target follows today's plan and the stored value is ignored. */
  target: number;
}

export interface GoalProgress extends GoalItem {
  progress: number;
  done: boolean;
}

export type GoalPreset = "light" | "standard" | "intense" | "weekend";

export const GOAL_PRESETS: Record<
  GoalPreset,
  { label: string; minutes: number; items: GoalItem[] }
> = {
  light: {
    label: "Light (about 30 min)",
    minutes: 30,
    items: [{ type: "problems", target: 1 }],
  },
  standard: {
    label: "Standard (about 90 min)",
    minutes: 90,
    items: [
      { type: "problems", target: 2 },
      { type: "interviews_week", target: 1 },
    ],
  },
  intense: {
    label: "Intense (about 3 hours)",
    minutes: 180,
    items: [
      { type: "problems", target: 4 },
      { type: "xp", target: 100 },
      { type: "interviews_week", target: 2 },
    ],
  },
  weekend: {
    label: "Weekend sprint",
    minutes: 240,
    items: [
      { type: "problems", target: 5 },
      { type: "interviews_week", target: 1 },
    ],
  },
};

export const GOAL_LABEL: Record<GoalType, string> = {
  problems: "Solve problems",
  xp: "Earn XP",
  interviews_week: "Mock interviews this week",
  plan_tasks: "Finish today's plan",
};

export const GOAL_COMPLETION_XP = 15;
export const MAX_GOAL_TARGET = 50;

export interface GoalFacts {
  problemsToday: number;
  xpToday: number;
  interviewsThisWeek: number;
  planTasksDone: number;
  planTasksTotal: number;
}

export const normalizeGoals = (items: readonly GoalItem[]): GoalItem[] => {
  const seen = new Set<GoalType>();
  const out: GoalItem[] = [];
  for (const it of items) {
    if (seen.has(it.type)) continue;
    seen.add(it.type);
    out.push({
      type: it.type,
      target: Math.max(1, Math.min(MAX_GOAL_TARGET, Math.round(it.target))),
    });
  }
  return out;
};

export function evaluateGoals(items: readonly GoalItem[], facts: GoalFacts): GoalProgress[] {
  const out: GoalProgress[] = [];
  for (const it of items) {
    if (it.type === "plan_tasks") {
      // no plan, or nothing planned today: nothing to ask of the user
      if (facts.planTasksTotal === 0) continue;
      out.push({
        ...it,
        target: facts.planTasksTotal,
        progress: facts.planTasksDone,
        done: facts.planTasksDone >= facts.planTasksTotal,
      });
      continue;
    }
    const progress =
      it.type === "problems"
        ? facts.problemsToday
        : it.type === "xp"
          ? facts.xpToday
          : facts.interviewsThisWeek;
    out.push({ ...it, progress, done: progress >= it.target });
  }
  return out;
}

/** All goals done (and at least one exists). */
export const goalsComplete = (items: readonly GoalProgress[]): boolean =>
  items.length > 0 && items.every((i) => i.done);

export interface GoalSuggestion {
  direction: "lower" | "raise";
  message: string;
}

/** After two weeks of data: suggest lowering a goal that is mostly missed, raising one that is always met. */
export function suggestGoalChange(
  days: readonly { date: string; completed: boolean }[],
): GoalSuggestion | null {
  const recent = [...days].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  if (recent.length < 7) return null;
  const rate = recent.filter((d) => d.completed).length / recent.length;
  if (rate <= 0.3) {
    return {
      direction: "lower",
      message: `You met your goal on ${Math.round(rate * recent.length)} of the last ${recent.length} days. A lighter goal you can keep builds more than a big one you miss.`,
    };
  }
  if (rate >= 0.9) {
    return {
      direction: "raise",
      message: `You met your goal on ${Math.round(rate * recent.length)} of the last ${recent.length} days. Ready for a bigger one?`,
    };
  }
  return null;
}
