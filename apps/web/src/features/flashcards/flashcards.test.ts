import { describe, expect, it } from "vitest";
import type { CardDto, StudyResponse, SyncResponse } from "@prepquest/shared";
import { dueText, newClientId, ratingForKey, summaryText, syncText } from "./flashcard-view";
import {
  BATCH,
  cacheStudy,
  flushQueue,
  loadCachedStudy,
  ReviewQueue,
  withoutAnswered,
  type KeyValueStore,
  type QueuedReview,
} from "./offline";

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  read<T>(key: string): T | null {
    const raw = this.data.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }
  write(key: string, value: unknown) {
    this.data.set(key, JSON.stringify(value));
  }
}

const review = (n: number): QueuedReview => ({
  clientId: `client-${String(n).padStart(4, "0")}`,
  cardId: "00000000-0000-4000-8000-000000000001",
  quality: 4,
  reviewedAt: "2026-03-10T10:00:00.000Z",
});
const ok = (
  reviews: QueuedReview[],
  status: "applied" | "unknown_card" = "applied",
): SyncResponse => ({
  results: reviews.map((r) => ({
    clientId: r.clientId,
    cardId: r.cardId,
    status,
    dueOn: "2026-03-11",
    intervalDays: 1,
  })),
  serverTime: "2026-03-10T12:00:00Z",
});
const rejected = (err: unknown) => (err as { status?: number }).status === 422;

describe("review queue", () => {
  it("keeps answers across a reload, oldest first, and ignores a repeated id", () => {
    const store = new MemoryStore();
    const q = new ReviewQueue(store, "u1");
    q.add(review(1));
    q.add(review(2));
    q.add(review(1));
    expect(new ReviewQueue(store, "u1").list().map((r) => r.clientId)).toEqual([
      "client-0001",
      "client-0002",
    ]);
    q.remove(["client-0001"]);
    expect(q.size()).toBe(1);
  });
  it("keeps one learner's answers apart from another's", () => {
    const store = new MemoryStore();
    new ReviewQueue(store, "u1").add(review(1));
    expect(new ReviewQueue(store, "u2").size()).toBe(0);
  });
});

describe("flushing the queue", () => {
  it("sends everything and empties the queue", async () => {
    const q = new ReviewQueue(new MemoryStore(), "u1");
    for (let i = 0; i < 3; i++) q.add(review(i));
    const r = await flushQueue(q, async (b) => ok(b), rejected);
    expect(r).toEqual({ sent: 3, dropped: 0, offline: false });
    expect(q.size()).toBe(0);
  });
  it("sends in batches", async () => {
    const q = new ReviewQueue(new MemoryStore(), "u1");
    for (let i = 0; i < BATCH + 5; i++) q.add(review(i));
    const sizes: number[] = [];
    await flushQueue(
      q,
      async (b) => {
        sizes.push(b.length);
        return ok(b);
      },
      rejected,
    );
    expect(sizes).toEqual([BATCH, 5]);
  });
  it("keeps the queue when the network is down, and sends it later", async () => {
    const q = new ReviewQueue(new MemoryStore(), "u1");
    q.add(review(1));
    const down = await flushQueue(
      q,
      async () => {
        throw new TypeError("Failed to fetch");
      },
      rejected,
    );
    expect(down).toEqual({ sent: 0, dropped: 0, offline: true });
    expect(q.size()).toBe(1);
    expect((await flushQueue(q, async (b) => ok(b), rejected)).sent).toBe(1);
  });
  it("keeps the queue on a server error or an expired session", async () => {
    const q = new ReviewQueue(new MemoryStore(), "u1");
    q.add(review(1));
    for (const status of [401, 429, 500]) {
      const r = await flushQueue(q, async () => Promise.reject({ status }), rejected);
      expect(r.offline).toBe(true);
    }
    expect(q.size()).toBe(1);
  });
  it("drops a batch the server rejects as invalid instead of retrying it forever", async () => {
    const q = new ReviewQueue(new MemoryStore(), "u1");
    q.add(review(1));
    const r = await flushQueue(q, async () => Promise.reject({ status: 422 }), rejected);
    expect(r).toEqual({ sent: 0, dropped: 1, offline: false });
    expect(q.size()).toBe(0);
  });
  it("removes answers for a deleted card and counts them as dropped", async () => {
    const q = new ReviewQueue(new MemoryStore(), "u1");
    q.add(review(1));
    const r = await flushQueue(q, async (b) => ok(b, "unknown_card"), rejected);
    expect(r.dropped).toBe(1);
    expect(q.size()).toBe(0);
  });
  it("does not spin when the server acknowledges nothing", async () => {
    const q = new ReviewQueue(new MemoryStore(), "u1");
    q.add(review(1));
    const r = await flushQueue(q, async () => ({ results: [], serverTime: "" }), rejected);
    expect(r.offline).toBe(true);
    expect(q.size()).toBe(1);
  });
  it("loses nothing when the network drops halfway through a long queue", async () => {
    const q = new ReviewQueue(new MemoryStore(), "u1");
    for (let i = 0; i < BATCH + 20; i++) q.add(review(i));
    let calls = 0;
    const r = await flushQueue(
      q,
      async (b) => {
        if (++calls === 2) throw new TypeError("Failed to fetch");
        return ok(b);
      },
      rejected,
    );
    expect(r).toMatchObject({ sent: BATCH, offline: true });
    expect(q.size()).toBe(20);
  });
});

const card = (id: string, isNew: boolean): CardDto => ({
  id,
  deckId: "d",
  type: "basic",
  front: "Q",
  back: "A",
  prompt: "Q",
  answer: "A",
  originType: null,
  dueOn: "2026-03-10",
  intervalDays: 0,
  lapses: 0,
  suspended: false,
  isNew,
});
const study: StudyResponse = {
  cards: [card("a", false), card("b", true), card("c", true)],
  today: "2026-03-10",
  cram: false,
  reviews: 1,
  fresh: 2,
  waitingReviews: 0,
  waitingNew: 0,
  serverTime: "2026-03-10T12:00:00Z",
};

describe("the study set kept on the device", () => {
  it("round-trips and drops answered cards", () => {
    const store = new MemoryStore();
    cacheStudy(store, "u1", "all", study);
    expect(loadCachedStudy(store, "u1", "all")).toEqual(study);
    expect(loadCachedStudy(store, "u1", "other")).toBeNull();
    const left = withoutAnswered(study, ["a", "c"]);
    expect(left.cards.map((c) => c.id)).toEqual(["b"]);
    expect(left).toMatchObject({ reviews: 0, fresh: 1 });
  });
});

describe("screen text", () => {
  it("describes what is due", () => {
    expect(dueText({ cards: 0, due: 0, fresh: 0 })).toBe("No cards yet");
    expect(dueText({ cards: 5, due: 2, fresh: 1 })).toBe("2 due, 1 new");
    expect(dueText({ cards: 5, due: 0, fresh: 0 })).toBe("Nothing due");
  });
  it("maps keys to ratings and ids are unique", () => {
    expect(ratingForKey("1")?.quality).toBe(1);
    expect(ratingForKey("4")?.quality).toBe(5);
    expect(ratingForKey("9")).toBeNull();
    expect(newClientId()).not.toBe(newClientId());
    expect(newClientId().length).toBeGreaterThanOrEqual(8);
  });
  it("tells the learner where their answers are", () => {
    expect(syncText(0, true)).toBe("");
    expect(syncText(0, false)).toMatch(/Offline/);
    expect(syncText(1, true)).toBe("Syncing 1 answer...");
    expect(syncText(3, false)).toMatch(/3 answers will sync/);
    expect(summaryText(0, false)).toMatch(/done for today/);
    expect(summaryText(2, true)).toBe("2 cards crammed.");
  });
});
