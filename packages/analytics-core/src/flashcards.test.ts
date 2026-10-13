import { describe, expect, it } from "vitest";
import {
  CRAM_LIMIT,
  cardIssues,
  clozeDeletions,
  mergeOfflineReviews,
  renderCard,
  studyQueue,
  type StudyCard,
  type SyncCard,
} from "./index.js";

const dayOf = (iso: string) => iso.slice(0, 10);
const NOW = new Date("2026-03-10T12:00:00Z");

describe("cloze cards", () => {
  it("finds the deletions with their hints", () => {
    expect(clozeDeletions("A {{c1::stack}} is {{c2::LIFO::order}}.")).toEqual([
      { n: 1, answer: "stack", hint: null },
      { n: 2, answer: "LIFO", hint: "order" },
    ]);
    expect(clozeDeletions("no gaps here")).toEqual([]);
  });
  it("hides every deletion in the prompt and reveals them in the answer", () => {
    const f = renderCard({
      type: "cloze",
      front: "Binary search takes {{c1::O(log n)::time}} on a {{c2::sorted}} array.",
      back: "",
    });
    expect(f.prompt).toBe("Binary search takes [time] on a [...] array.");
    expect(f.answer).toBe("Binary search takes O(log n) on a sorted array.");
  });
  it("adds the back text to a cloze answer", () => {
    const f = renderCard({
      type: "cloze",
      front: "{{c1::BFS}} uses a queue.",
      back: "DFS: stack.",
    });
    expect(f.answer).toBe("BFS uses a queue.\n\nDFS: stack.");
  });
  it("basic and code cards show front then back as written", () => {
    expect(renderCard({ type: "basic", front: "Q", back: "A" })).toEqual({
      prompt: "Q",
      answer: "A",
    });
    expect(
      renderCard({ type: "code", front: "Template?", back: "for l in range(n): ..." }).answer,
    ).toMatch(/^for l/);
  });
  it("keeps code braces that are not deletions", () => {
    const f = renderCard({ type: "cloze", front: "if (x) { return {{c1::y}}; }", back: "" });
    expect(f.prompt).toBe("if (x) { return [...]; }");
  });
});

describe("card checks", () => {
  it("accepts good cards and names the problems of bad ones", () => {
    expect(cardIssues({ type: "basic", front: "Q", back: "A" })).toEqual([]);
    expect(cardIssues({ type: "basic", front: " ", back: "A" })).toHaveLength(1);
    expect(cardIssues({ type: "basic", front: "Q", back: "" })).toHaveLength(1);
    expect(cardIssues({ type: "cloze", front: "no gap", back: "" })[0]).toMatch(/cloze/);
    expect(cardIssues({ type: "cloze", front: "{{c1::x}}", back: "" })).toEqual([]);
    expect(cardIssues({ type: "basic", front: "x".repeat(2001), back: "A" })).toHaveLength(1);
  });
});

const card = (id: string, over: Partial<StudyCard> = {}): StudyCard => ({
  id,
  dueOn: "2026-03-10",
  suspended: false,
  ease: 2.5,
  lapses: 0,
  isNew: false,
  ...over,
});
const base = {
  today: "2026-03-10",
  newPerDay: 2,
  reviewsPerDay: 3,
  newDoneToday: 0,
  reviewsDoneToday: 0,
};

describe("study queue", () => {
  it("puts reviews first (most overdue), then new cards up to the new limit", () => {
    const q = studyQueue(
      [
        card("n1", { isNew: true }),
        card("n2", { isNew: true }),
        card("n3", { isNew: true }),
        card("r1", { dueOn: "2026-03-10" }),
        card("r2", { dueOn: "2026-03-07" }),
        card("later", { dueOn: "2026-03-11" }),
      ],
      base,
    );
    expect(q.cards.map((c) => c.id)).toEqual(["r2", "r1", "n1", "n2"]);
    expect(q.reviews).toBe(2);
    expect(q.fresh).toBe(2);
    expect(q.waitingNew).toBe(1);
  });
  it("counts what was already done today against the limits", () => {
    const q = studyQueue([card("a"), card("b"), card("c"), card("n1", { isNew: true })], {
      ...base,
      reviewsDoneToday: 2,
      newDoneToday: 2,
    });
    expect(q.cards.map((c) => c.id)).toEqual(["a"]);
    expect(q.waitingReviews).toBe(2);
    expect(q.waitingNew).toBe(1);
  });
  it("leaves suspended cards out", () => {
    const q = studyQueue(
      [card("a", { suspended: true }), card("n", { isNew: true, suspended: true })],
      base,
    );
    expect(q.cards).toEqual([]);
  });
  it("cram takes every card, weakest first, ignoring dates and limits", () => {
    const q = studyQueue(
      [
        card("ok", { dueOn: "2027-01-01" }),
        card("weak", { lapses: 3, ease: 1.8, dueOn: "2027-01-01" }),
        card("fresh", { isNew: true }),
      ],
      { ...base, cram: true },
    );
    expect(q.cram).toBe(true);
    expect(q.cards.map((c) => c.id)).toEqual(["weak", "fresh", "ok"]);
  });
  it("cram is capped", () => {
    const many = Array.from({ length: CRAM_LIMIT + 20 }, (_, i) =>
      card(`c${String(i).padStart(3, "0")}`),
    );
    expect(studyQueue(many, { ...base, cram: true }).cards).toHaveLength(CRAM_LIMIT);
  });
});

const fresh: SyncCard = {
  ease: 2.5,
  intervalDays: 0,
  repetitions: 0,
  lapses: 0,
  dueOn: "2026-03-09",
  lastReviewedAt: null,
};

describe("offline review merge", () => {
  it("applies offline reviews oldest first, as if they had been done online", () => {
    const out = mergeOfflineReviews(
      fresh,
      [
        { clientId: "b", quality: 4, reviewedAt: "2026-03-10T09:00:00Z" },
        { clientId: "a", quality: 4, reviewedAt: "2026-03-09T09:00:00Z" },
      ],
      dayOf,
      NOW,
    );
    expect(out.applied.map((r) => r.clientId)).toEqual(["a", "b"]);
    expect(out.card.repetitions).toBe(2);
    expect(out.card.intervalDays).toBe(3);
    expect(out.card.dueOn).toBe("2026-03-13");
    expect(out.card.lastReviewedAt).toBe("2026-03-10T09:00:00.000Z");
  });
  it("a review older than the stored newest one only gets recorded (last review wins)", () => {
    const stored: SyncCard = {
      ease: 2.5,
      intervalDays: 3,
      repetitions: 2,
      lapses: 0,
      dueOn: "2026-03-13",
      lastReviewedAt: "2026-03-10T08:00:00.000Z",
    };
    const out = mergeOfflineReviews(
      stored,
      [{ clientId: "old", quality: 1, reviewedAt: "2026-03-10T07:00:00Z" }],
      dayOf,
      NOW,
    );
    expect(out.stale).toEqual(["old"]);
    expect(out.applied).toEqual([]);
    expect(out.card).toEqual(stored);
  });
  it("a forgotten answer resets the interval and counts a lapse", () => {
    const out = mergeOfflineReviews(
      { ...fresh, intervalDays: 6, repetitions: 3 },
      [{ clientId: "x", quality: 1, reviewedAt: "2026-03-10T09:00:00Z" }],
      dayOf,
      NOW,
    );
    expect(out.card.lapses).toBe(1);
    expect(out.card.intervalDays).toBe(1);
    expect(out.card.dueOn).toBe("2026-03-11");
  });
  it("clamps a device clock that runs ahead", () => {
    const out = mergeOfflineReviews(
      fresh,
      [{ clientId: "f", quality: 4, reviewedAt: "2030-01-01T00:00:00Z" }],
      dayOf,
      NOW,
    );
    expect(out.card.lastReviewedAt && Date.parse(out.card.lastReviewedAt)).toBeLessThanOrEqual(
      NOW.getTime() + 5 * 60_000,
    );
    expect(out.card.dueOn).toBe("2026-03-11");
  });
  it("a garbled timestamp counts as now", () => {
    const out = mergeOfflineReviews(
      fresh,
      [{ clientId: "g", quality: 4, reviewedAt: "not a date" }],
      dayOf,
      NOW,
    );
    expect(out.applied).toHaveLength(1);
    expect(out.card.lastReviewedAt).toBe(NOW.toISOString());
  });
  it("two reviews at the same instant: the first by id wins, the second is stale", () => {
    const out = mergeOfflineReviews(
      fresh,
      [
        { clientId: "z", quality: 5, reviewedAt: "2026-03-10T09:00:00Z" },
        { clientId: "m", quality: 3, reviewedAt: "2026-03-10T09:00:00Z" },
      ],
      dayOf,
      NOW,
    );
    expect(out.applied.map((r) => r.clientId)).toEqual(["m"]);
    expect(out.stale).toEqual(["z"]);
  });
});
