// Timezone-aware streaks with one "freeze" (grace day), doc 04 A1 acceptance criteria.

export interface StreakState {
  current: number;
  best: number;
  /** The last local day with activity, `YYYY-MM-DD`. */
  lastActive: string | null;
  /** Grace days available: one missed day is forgiven per freeze. */
  freezes: number;
}

export const MAX_FREEZES = 1;

/** The calendar day (`YYYY-MM-DD`) of an instant in a time zone; unknown zones fall back to UTC. */
export function localDay(at: Date, timeZone: string): string {
  const format = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

/** Whole days from `a` to `b` (both `YYYY-MM-DD`); negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface StreakAdvance {
  state: StreakState;
  usedFreeze: boolean;
  /** Set when this activity brought the streak to a milestone length (7, 30, 100). */
  milestone: number | null;
}

const MILESTONES = [7, 30, 100];

/**
 * Records activity on `today`. Same day: nothing changes. The next day: +1. After exactly one missed day,
 * a freeze bridges the gap; otherwise the streak restarts at 1. A freeze is earned back each time the
 * streak reaches a multiple of 7 days (a deterministic reading of "one freeze per week").
 */
export function advanceStreak(state: StreakState, today: string): StreakAdvance {
  if (state.lastActive === today) return { state, usedFreeze: false, milestone: null };
  let current: number;
  let freezes = state.freezes;
  let usedFreeze = false;
  const gap = state.lastActive === null ? Infinity : daysBetween(state.lastActive, today);
  if (gap === 1) {
    current = state.current + 1;
  } else if (gap === 2 && freezes > 0) {
    current = state.current + 1;
    freezes -= 1;
    usedFreeze = true;
  } else if (gap < 1 && state.lastActive !== null) {
    // clock moved backwards (time zone change): don't punish or double count
    return { state, usedFreeze: false, milestone: null };
  } else {
    current = 1;
  }
  if (current % 7 === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
  return {
    state: { current, best: Math.max(state.best, current), lastActive: today, freezes },
    usedFreeze,
    milestone: MILESTONES.includes(current) ? current : null,
  };
}

/** The streak to display today: it lapses once the missed days can no longer be forgiven. */
export function currentStreak(state: StreakState, today: string): number {
  if (state.lastActive === null) return 0;
  const gap = daysBetween(state.lastActive, today);
  if (gap <= 1) return state.current;
  if (gap === 2 && state.freezes > 0) return state.current;
  return 0;
}
