import type { StudyResponse, SyncResponse } from "@prepquest/shared";

// Offline flashcard reviews (X6). Answers are written to this device first, then sent in batches. The
// server stores each `clientId` once, so a batch that is sent twice (a lost reply, two tabs) adds nothing.
// Storage is injected so the logic is unit tested without a browser.

export interface KeyValueStore {
  read<T>(key: string): T | null;
  write(key: string, value: unknown): void;
}

export interface QueuedReview {
  clientId: string;
  cardId: string;
  quality: number;
  reviewedAt: string;
}

const queueKey = (userId: string) => `pq:flashcards:queue:${userId}`;
const studyKey = (userId: string, scope: string) => `pq:flashcards:study:${userId}:${scope}`;

/** The reviews waiting to be sent, oldest first. */
export class ReviewQueue {
  constructor(
    private readonly store: KeyValueStore,
    private readonly userId: string,
  ) {}

  list(): QueuedReview[] {
    return this.store.read<QueuedReview[]>(queueKey(this.userId)) ?? [];
  }

  size(): number {
    return this.list().length;
  }

  /** Adds an answer (a repeated client id is ignored). */
  add(review: QueuedReview): void {
    const all = this.list();
    if (all.some((r) => r.clientId === review.clientId)) return;
    this.store.write(queueKey(this.userId), [...all, review]);
  }

  remove(clientIds: Iterable<string>): void {
    const gone = new Set(clientIds);
    this.store.write(
      queueKey(this.userId),
      this.list().filter((r) => !gone.has(r.clientId)),
    );
  }
}

export interface FlushResult {
  sent: number;
  /** Answers the server could not accept at all (for example for a deleted card); they are dropped. */
  dropped: number;
  /** True when something is still queued because the server could not be reached. */
  offline: boolean;
}

export const BATCH = 100;

/**
 * Sends the queue in batches. A network failure or a 5xx/401/429 stops the run and keeps everything for the
 * next try. A batch the server rejects as invalid (422) can never succeed, so it is dropped rather than
 * retried forever. Acknowledged answers (including "stale" and "unknown_card") are removed.
 */
export async function flushQueue(
  queue: ReviewQueue,
  post: (reviews: QueuedReview[]) => Promise<SyncResponse>,
  isRejected: (err: unknown) => boolean,
): Promise<FlushResult> {
  let sent = 0;
  let dropped = 0;
  for (;;) {
    const batch = queue.list().slice(0, BATCH);
    if (batch.length === 0) return { sent, dropped, offline: false };
    try {
      const res = await post(batch);
      queue.remove(res.results.map((r) => r.clientId));
      // anything the server did not mention is retried next time
      sent += res.results.length;
      dropped += res.results.filter((r) => r.status === "unknown_card").length;
      if (res.results.length === 0) return { sent, dropped, offline: true };
    } catch (err) {
      if (isRejected(err)) {
        queue.remove(batch.map((r) => r.clientId));
        dropped += batch.length;
        continue;
      }
      return { sent, dropped, offline: true };
    }
  }
}

/** Keeps today's study set on the device for an offline session. */
export function cacheStudy(
  store: KeyValueStore,
  userId: string,
  scope: string,
  study: StudyResponse,
): void {
  store.write(studyKey(userId, scope), study);
}

export function loadCachedStudy(
  store: KeyValueStore,
  userId: string,
  scope: string,
): StudyResponse | null {
  return store.read<StudyResponse>(studyKey(userId, scope));
}

/** The cached set without the cards that were answered since it was saved. */
export function withoutAnswered(study: StudyResponse, answered: Iterable<string>): StudyResponse {
  const gone = new Set(answered);
  const cards = study.cards.filter((c) => !gone.has(c.id));
  return {
    ...study,
    cards,
    reviews: cards.filter((c) => !c.isNew).length,
    fresh: cards.filter((c) => c.isNew).length,
  };
}
