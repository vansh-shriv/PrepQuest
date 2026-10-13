import { review, type CardState, type Queue, type QueueCard, buildQueue } from "./srs.js";

// Flashcards (X6): card rendering, the study queue and the merge of reviews done offline. Pure: the caller
// supplies the local day. Scheduling is the same SM-2 as solved-problem reviews (`srs.ts`).

export const CARD_TYPES = ["basic", "cloze", "code"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const DECK_KINDS = [
  "patterns",
  "formulas",
  "cs",
  "behavioral",
  "mistakes",
  "custom",
] as const;
export type DeckKind = (typeof DECK_KINDS)[number];

export const DEFAULT_NEW_PER_DAY = 10;
export const DEFAULT_REVIEWS_PER_DAY = 60;
export const CRAM_LIMIT = 100;
export const MAX_FACE_CHARS = 2000;

const CLOZE = /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/gs;

export interface Deletion {
  n: number;
  answer: string;
  hint: string | null;
}

/** The cloze deletions of a card front: `{{c1::answer}}` or `{{c1::answer::hint}}`. */
export function clozeDeletions(front: string): Deletion[] {
  return [...front.matchAll(CLOZE)].map((m) => ({
    n: Number(m[1]),
    answer: m[2] ?? "",
    hint: m[3] ?? null,
  }));
}

export interface CardFaces {
  prompt: string;
  answer: string;
}

/**
 * What the learner sees before and after flipping. A cloze card hides every deletion in the prompt (a hint
 * is shown in brackets) and reveals them in the answer; the back text, if any, is extra detail.
 */
export function renderCard(card: { type: CardType; front: string; back: string }): CardFaces {
  if (card.type !== "cloze") return { prompt: card.front, answer: card.back };
  const prompt = card.front.replace(CLOZE, (_m, _n, _a, hint?: string) => `[${hint ?? "..."}]`);
  const revealed = card.front.replace(CLOZE, (_m, _n, a: string) => a);
  return { prompt, answer: card.back.trim() ? `${revealed}\n\n${card.back}` : revealed };
}

/** Problems with a card before it is saved (empty list when it is fine). */
export function cardIssues(card: { type: CardType; front: string; back: string }): string[] {
  const issues: string[] = [];
  if (!card.front.trim()) issues.push("The front is empty.");
  if (card.front.length > MAX_FACE_CHARS) issues.push("The front is too long.");
  if (card.back.length > MAX_FACE_CHARS) issues.push("The back is too long.");
  if (card.type === "cloze") {
    if (clozeDeletions(card.front).length === 0)
      issues.push("A cloze card needs at least one {{c1::hidden}} part.");
  } else if (!card.back.trim()) {
    issues.push("The back is empty.");
  }
  return issues;
}

export interface StudyCard extends QueueCard {
  /** Never reviewed: counts against the daily new-card limit. */
  isNew: boolean;
}

export interface StudyQueue<T extends StudyCard> {
  cards: T[];
  /** Cards in the queue that are reviews (not new). */
  reviews: number;
  /** Cards in the queue that are new. */
  fresh: number;
  /** Due reviews beyond today's limit and new cards beyond today's new limit. */
  waitingReviews: number;
  waitingNew: number;
  cram: boolean;
}

export interface StudyOptions {
  today: string;
  newPerDay: number;
  reviewsPerDay: number;
  newDoneToday: number;
  reviewsDoneToday: number;
  /** Cram: every card, weakest first, and the answers do not move the schedule. */
  cram?: boolean;
}

/**
 * Today's cards: due reviews first (longest overdue, weakest), then new cards up to the daily new limit.
 * Cram mode ignores due dates and limits (up to `CRAM_LIMIT`), weakest first.
 */
export function studyQueue<T extends StudyCard>(
  cards: readonly T[],
  o: StudyOptions,
): StudyQueue<T> {
  const live = cards.filter((c) => !c.suspended);
  if (o.cram) {
    const all = [...live].sort(
      (a, b) => b.lapses - a.lapses || a.ease - b.ease || a.id.localeCompare(b.id),
    );
    return {
      cards: all.slice(0, CRAM_LIMIT),
      reviews: Math.min(CRAM_LIMIT, all.filter((c) => !c.isNew).length),
      fresh: Math.min(CRAM_LIMIT, all.filter((c) => c.isNew).length),
      waitingReviews: 0,
      waitingNew: 0,
      cram: true,
    };
  }
  const reviewQueue: Queue<T> = buildQueue(
    live.filter((c) => !c.isNew),
    { today: o.today, cap: o.reviewsPerDay, doneToday: o.reviewsDoneToday },
  );
  const fresh = live.filter((c) => c.isNew);
  const room = Math.max(0, o.newPerDay - o.newDoneToday);
  const take = fresh.slice(0, room);
  return {
    cards: [...reviewQueue.due, ...take],
    reviews: reviewQueue.due.length,
    fresh: take.length,
    waitingReviews: reviewQueue.waiting,
    waitingNew: Math.max(0, fresh.length - take.length),
    cram: false,
  };
}

export interface SyncCard extends CardState {
  dueOn: string;
  /** ISO time of the newest review already stored for this card. */
  lastReviewedAt: string | null;
}

export interface OfflineReview {
  clientId: string;
  quality: number;
  /** ISO time the learner answered, as recorded on the device. */
  reviewedAt: string;
}

export interface AppliedReview {
  clientId: string;
  day: string;
  prevInterval: number;
  newInterval: number;
}

export interface SyncOutcome {
  card: SyncCard;
  applied: AppliedReview[];
  /** Reviews older than the card's newest review: stored, but they do not change the schedule. */
  stale: string[];
}

const SKEW_MS = 5 * 60_000;

/**
 * Merge reviews made offline into a card. Reviews are applied oldest first; one that is not newer than the
 * card's newest stored review loses (last review wins) and is only recorded. A device clock ahead of the
 * server is clamped to the server's `now`.
 */
export function mergeOfflineReviews(
  start: SyncCard,
  reviews: readonly OfflineReview[],
  dayOf: (iso: string) => string,
  now: Date,
): SyncOutcome {
  const cap = now.getTime() + SKEW_MS;
  const when = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? now.getTime() : Math.min(t, cap);
  };
  const ordered = [...reviews].sort(
    (a, b) => when(a.reviewedAt) - when(b.reviewedAt) || a.clientId.localeCompare(b.clientId),
  );
  let card = { ...start };
  const applied: AppliedReview[] = [];
  const stale: string[] = [];
  for (const r of ordered) {
    const t = when(r.reviewedAt);
    if (card.lastReviewedAt !== null && t <= Date.parse(card.lastReviewedAt)) {
      stale.push(r.clientId);
      continue;
    }
    const iso = new Date(t).toISOString();
    const day = dayOf(iso);
    const next = review(card, r.quality, day);
    applied.push({
      clientId: r.clientId,
      day,
      prevInterval: card.intervalDays,
      newInterval: next.intervalDays,
    });
    card = { ...next, lastReviewedAt: iso };
  }
  return { card, applied, stale };
}
