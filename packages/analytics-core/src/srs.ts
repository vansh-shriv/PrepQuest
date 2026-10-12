import { addDays, daysBetween } from "./streak.js";

// Spaced repetition for solved problems (D6): a modified SM-2. Pure: the caller supplies the local day.
// Due dates are local calendar days (`YYYY-MM-DD`), so "due today" follows the learner's time zone.

export interface CardState {
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

export interface Scheduled extends CardState {
  /** The local day the card is next due. */
  dueOn: string;
}

export const EASE_START = 2.5;
export const EASE_FLOOR = 1.3;
/** A review at or above this quality counts as remembered. */
export const PASS_QUALITY = 3;
export const DEFAULT_REVIEW_CAP = 5;

const clampQuality = (q: number) => Math.max(0, Math.min(5, Math.round(q)));

/** SM-2's ease update, floored. */
export function easeAfter(ease: number, quality: number): number {
  const q = clampQuality(quality);
  return Math.max(EASE_FLOOR, +(ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)).toFixed(2));
}

/**
 * Self-rating to a quality score: the four buttons shown after a solve or a review.
 * Again 1 (forgot), Hard 3, Good 4, Easy 5.
 */
export const RATING_QUALITY = { again: 1, hard: 3, good: 4, easy: 5 } as const;
export type Rating = keyof typeof RATING_QUALITY;

export interface ReviewFacts {
  /** Rejected submissions before the accept in this attempt. */
  failedAttempts: number;
  /** Highest hint tier used (0 for none). */
  hintTiers: number;
  /** Estimated active minutes to the accept, when known. */
  minutes?: number | null;
  /** The problem's target time in minutes. */
  expectedMinutes?: number;
  /** The learner's own rating, which can only lower the score or confirm an easy solve. */
  rating?: Rating | null;
}

/**
 * Quality (0 to 5) of a solve or review, from what happened.
 * Clean, quick and rated easy: 5. Hints, several tries or well over the target time: 3 or less.
 * Gave up or rated "again": 1.
 */
export function solveQuality(f: ReviewFacts): number {
  if (f.rating === "again") return 1;
  let q = 4;
  if (f.failedAttempts >= 3) q = 2;
  else if (f.failedAttempts >= 1) q = 3;
  if (f.hintTiers > 0) q = Math.min(q, 3);
  if (f.minutes != null && f.expectedMinutes && f.minutes > f.expectedMinutes * 1.5)
    q = Math.min(q, 3);
  if (f.rating === "hard") q = Math.min(q, 3);
  const quick = f.minutes == null || !f.expectedMinutes || f.minutes <= f.expectedMinutes;
  if (q === 4 && f.rating === "easy" && quick) q = 5;
  return q;
}

/** The card created by a first accepted solve: due tomorrow, with the ease the first solve earned. */
export function newCard(quality: number, today: string): Scheduled {
  const q = clampQuality(quality);
  return {
    ease: easeAfter(EASE_START, q),
    intervalDays: 1,
    repetitions: q >= PASS_QUALITY ? 1 : 0,
    lapses: 0,
    dueOn: addDays(today, 1),
  };
}

/**
 * One review. A failure (quality under 3) returns the card to a one-day interval, lowers the ease by 0.2
 * (floor 1.3) and counts a lapse. A pass moves on to 1 day, 3 days, then interval x ease.
 */
export function review(card: CardState, quality: number, today: string): Scheduled {
  const q = clampQuality(quality);
  if (q < PASS_QUALITY) {
    return {
      ease: Math.max(EASE_FLOOR, +(card.ease - 0.2).toFixed(2)),
      intervalDays: 1,
      repetitions: 0,
      lapses: card.lapses + 1,
      dueOn: addDays(today, 1),
    };
  }
  const repetitions = card.repetitions + 1;
  const ease = easeAfter(card.ease, q);
  const intervalDays =
    repetitions === 1
      ? 1
      : repetitions === 2
        ? 3
        : Math.max(card.intervalDays + 1, Math.round(card.intervalDays * ease));
  return {
    ease,
    intervalDays,
    repetitions,
    lapses: card.lapses,
    dueOn: addDays(today, intervalDays),
  };
}

export interface QueueCard {
  id: string;
  dueOn: string;
  suspended: boolean;
  ease: number;
  lapses: number;
}

export interface Queue<T extends QueueCard> {
  /** Cards to review now, most urgent first, at most the room left under the daily cap. */
  due: T[];
  /** Due cards beyond today's cap: they carry over, most overdue first. */
  waiting: number;
  /** Reviews already done today. */
  doneToday: number;
  cap: number;
}

/**
 * Today's review queue. Overdue cards come first (longest overdue), then the weakest (most lapses, lowest
 * ease). The cap counts reviews already done today, so a day never asks for more than `cap`.
 */
export function buildQueue<T extends QueueCard>(
  cards: readonly T[],
  opts: { today: string; cap: number; doneToday: number },
): Queue<T> {
  const cap = Math.max(0, opts.cap);
  const dueAll = cards
    .filter((c) => !c.suspended && c.dueOn <= opts.today)
    .sort(
      (a, b) =>
        daysBetween(b.dueOn, opts.today) - daysBetween(a.dueOn, opts.today) ||
        b.lapses - a.lapses ||
        a.ease - b.ease ||
        a.id.localeCompare(b.id),
    );
  const room = Math.max(0, cap - opts.doneToday);
  return {
    due: dueAll.slice(0, room),
    waiting: Math.max(0, dueAll.length - room),
    doneToday: opts.doneToday,
    cap,
  };
}

/** How well a topic is remembered, from review qualities (0 to 5): the share that passed, weighted by quality. */
export function retention(qualities: readonly number[]): number | null {
  if (qualities.length === 0) return null;
  return qualities.reduce((a, q) => a + clampQuality(q) / 5, 0) / qualities.length;
}
