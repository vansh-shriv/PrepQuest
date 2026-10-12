// Time-per-problem analysis (doc 04 A5). Pure: it works on the timestamps the platform already has (the
// moment a problem was opened, every run and submit), so the numbers are estimates, not keystroke
// measurements. A gap longer than the break threshold counts as a break, not as work.

import type { DifficultyName } from "./xp.js";

/** Expected time to a clean solve, in minutes (doc 04 A5 benchmarks; easy is ours). */
export const EXPECTED_MINUTES: Record<DifficultyName, number> = { easy: 15, medium: 25, hard: 40 };

/** A gap between two events longer than this is a break and counts for at most this long. */
export const BREAK_CAP_SECONDS = 20 * 60;

export interface TimedEvent {
  at: Date;
  /** `open` is when the problem was first opened; runs and submits come after it. */
  kind: "open" | "run" | "submit";
  accepted?: boolean;
}

export interface SolveTiming {
  /** Seconds from opening to the first run (reading and planning). */
  toFirstRun: number | null;
  /** Active seconds up to the first accepted submit. */
  toFirstAc: number | null;
  /** Active seconds in total over all events. */
  active: number;
  runs: number;
  submits: number;
  /** Share of the active time spent between the first run and the first accept (edit, run, fix cycles). */
  debugShare: number | null;
}

const secs = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 1000);

/** Active time of a problem from its events: gaps are capped at the break threshold. */
export function solveTiming(
  events: readonly TimedEvent[],
  breakCap = BREAK_CAP_SECONDS,
): SolveTiming {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  let active = 0;
  let toFirstAc: number | null = null;
  let toFirstRun: number | null = null;
  let runs = 0;
  let submits = 0;
  let firstRunActive: number | null = null;
  let prev: TimedEvent | null = null;
  for (const e of sorted) {
    if (prev) active += Math.min(secs(prev.at, e.at), breakCap);
    if (e.kind === "run") {
      runs += 1;
      if (toFirstRun === null) {
        const open = sorted.find((x) => x.kind === "open");
        toFirstRun = open ? Math.min(secs(open.at, e.at), breakCap) : null;
        firstRunActive = active;
      }
    }
    if (e.kind === "submit") {
      submits += 1;
      if (e.accepted && toFirstAc === null) toFirstAc = active;
    }
    prev = e;
  }
  const debugShare =
    toFirstAc !== null && firstRunActive !== null && toFirstAc > 0
      ? Math.max(0, Math.min(1, (toFirstAc - firstRunActive) / toFirstAc))
      : null;
  return { toFirstRun, toFirstAc, active: Math.round(active), runs, submits, debugShare };
}

/** 1 when solved within the expected time, falling towards 0 as it takes longer (twice as long is 0.5). */
export const speedScore = (difficulty: DifficultyName, seconds: number): number =>
  seconds <= 0 ? 1 : Math.min(1, (EXPECTED_MINUTES[difficulty] * 60) / seconds);

export interface TimeSample {
  difficulty: DifficultyName;
  seconds: number;
}

export interface TimeSummary {
  difficulty: DifficultyName;
  count: number;
  medianSeconds: number | null;
  expectedSeconds: number;
  /** Histogram over [0, 0.5x, 1x, 1.5x, 2x, more] of the expected time. */
  histogram: number[];
  outliers: number;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

export function summarizeTimes(samples: readonly TimeSample[]): TimeSummary[] {
  return (["easy", "medium", "hard"] as const).map((difficulty) => {
    const xs = samples.filter((s) => s.difficulty === difficulty).map((s) => s.seconds);
    const expected = EXPECTED_MINUTES[difficulty] * 60;
    const histogram = [0, 0, 0, 0, 0, 0];
    for (const x of xs) histogram[Math.min(5, Math.floor((x / expected) * 2))]! += 1;
    const med = median(xs);
    // an outlier is more than three times the expected time, or more than 3x the user's own median
    const outliers = xs.filter(
      (x) => x > expected * 3 || (med !== null && xs.length >= 5 && x > med * 3),
    ).length;
    return {
      difficulty,
      count: xs.length,
      medianSeconds: med,
      expectedSeconds: expected,
      histogram,
      outliers,
    };
  });
}

export interface PhaseShares {
  /** Reading and planning before the first run. */
  think: number;
  /** Writing code to the first run is folded into `think`; this is the edit-run-fix loop. */
  debug: number;
}

/** A coaching line from the phase shares and the speed summary; null when there is nothing worth saying. */
export function speedCoaching(shares: PhaseShares | null, slowCount: number): string | null {
  if (shares && shares.debug >= 0.4) {
    return `You spend about ${Math.round(shares.debug * 100)}% of the time in run-and-fix loops: try dry-running a sample input by hand before the first run.`;
  }
  if (shares && shares.think >= 0.6) {
    return `You spend about ${Math.round(shares.think * 100)}% of the time before the first run: try writing the brute force first, then improve it.`;
  }
  if (slowCount >= 3) {
    return `${slowCount} solves took more than twice the expected time: re-solve them after a few days.`;
  }
  return null;
}
