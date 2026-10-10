// XP, levels and streak milestones (doc 04 A1 "XP rules"). Pure functions: no I/O, no clock.

export type DifficultyName = "easy" | "medium" | "hard";

export const BASE_XP: Record<DifficultyName, number> = { easy: 10, medium: 25, hard: 50 };

/** Extra XP when a streak reaches these lengths (doc 04 says "milestone bonuses at 7, 30, 100"; amounts are ours). */
export const STREAK_MILESTONE_XP: Record<number, number> = { 7: 50, 30: 200, 100: 500 };

export interface SolveFacts {
  difficulty: DifficultyName;
  /** The very first submission for this problem was accepted. */
  firstTry: boolean;
  /** Highest hint tier viewed before solving (0 = none). */
  hintTiers: number;
}

/**
 * XP for a problem's first accepted solution: base by difficulty, +20% first try, +20% without hints,
 * -10% per hint tier used. Repeat solves earn nothing (the caller checks).
 */
export function problemXp({ difficulty, firstTry, hintTiers }: SolveFacts): number {
  const tiers = Math.min(3, Math.max(0, Math.floor(hintTiers)));
  // whole percentages, so amounts like 22.5 round predictably instead of drifting on float error
  const percent = 100 + (firstTry ? 20 : 0) + (tiers === 0 ? 20 : 0) - 10 * tiers;
  return Math.max(1, Math.round((BASE_XP[difficulty] * percent) / 100));
}

/** XP needed to climb from `level` to `level + 1`: `100 * level^1.4`. */
export const xpToNext = (level: number): number => Math.round(100 * Math.pow(level, 1.4));

/** Total XP at which `level` is reached (level 1 starts at 0). */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let k = 1; k < level; k++) total += xpToNext(k);
  return total;
}

export interface LevelProgress {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level takes in total. */
  needed: number;
  /** 0 to 1. */
  fraction: number;
}

export function levelFor(xp: number): LevelProgress {
  const safe = Math.max(0, Math.floor(xp));
  let level = 1;
  let floor = 0;
  for (;;) {
    const needed = xpToNext(level);
    if (safe < floor + needed) {
      const into = safe - floor;
      return { level, into, needed, fraction: into / needed };
    }
    floor += needed;
    level++;
  }
}
