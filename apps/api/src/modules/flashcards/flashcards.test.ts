import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  CardDto,
  DeckDetailDto,
  DeckDto,
  FlashcardsResponse,
  MistakesResponse,
  StudyResponse,
  SyncResponse,
} from "@prepquest/shared";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";
import { resetLearning } from "../../test/solve.js";

let t: TestApp;
let ada: string;
let bob: string;

const NOW = "2026-03-10T12:00:00Z";

beforeAll(async () => {
  t = await makeTestApp();
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetLearning(t);
  t.app.ai.now = () => new Date(NOW);
});

const call = <T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  token: string | null,
  payload?: object,
) =>
  t.app
    .inject({
      method,
      url: `/v1${url}`,
      ...(token ? { headers: bearer(token) } : {}),
      ...(payload ? { payload } : {}),
    })
    .then((r) => ({ status: r.statusCode, body: r.body ? r.json<T>() : (undefined as T) }));

const deckWith = async (token = ada, cards = 3) => {
  const d = await call<DeckDetailDto>("POST", "/flashcards/decks", token, {
    title: "Patterns",
    kind: "patterns",
  });
  expect(d.status).toBe(201);
  const ids: string[] = [];
  for (let i = 0; i < cards; i++) {
    const c = await call<CardDto>("POST", `/flashcards/decks/${d.body.id}/cards`, token, {
      front: `Question ${i}`,
      back: `Answer ${i}`,
    });
    expect(c.status).toBe(201);
    ids.push(c.body.id);
  }
  return { deckId: d.body.id, ids };
};

let n = 0;
const review = (cardId: string, quality: number, reviewedAt: string, clientId?: string) => ({
  clientId: clientId ?? `client-${++n}-${Math.random().toString(36).slice(2)}`,
  cardId,
  quality,
  reviewedAt,
});
const sync = (reviews: object[], token = ada) =>
  call<SyncResponse>("POST", "/flashcards/sync", token, { reviews });
const cardOf = async (deckId: string, id: string, token = ada) =>
  (await call<DeckDetailDto>("GET", `/flashcards/decks/${deckId}`, token)).body.items.find(
    (c) => c.id === id,
  )!;

describe("decks and cards", () => {
  it("creates a deck, adds basic and cloze cards and counts the new ones", async () => {
    const { deckId } = await deckWith(ada, 2);
    const cloze = await call<CardDto>("POST", `/flashcards/decks/${deckId}/cards`, ada, {
      type: "cloze",
      front: "BFS uses a {{c1::queue::data structure}}.",
    });
    expect(cloze.status).toBe(201);
    expect(cloze.body.prompt).toBe("BFS uses a [data structure].");
    expect(cloze.body.answer).toBe("BFS uses a queue.");
    const all = await call<FlashcardsResponse>("GET", "/flashcards", ada);
    expect(all.body.decks).toHaveLength(1);
    expect(all.body.decks[0]).toMatchObject({ cards: 3, fresh: 3, due: 0 });
    expect(all.body.today).toBe("2026-03-10");
  });

  it("rejects a cloze card without a gap and a basic card without a back", async () => {
    const { deckId } = await deckWith(ada, 0);
    const a = await call<{ error: { code: string } }>(
      "POST",
      `/flashcards/decks/${deckId}/cards`,
      ada,
      { type: "cloze", front: "no gap here" },
    );
    expect(a.status).toBe(422);
    const b = await call("POST", `/flashcards/decks/${deckId}/cards`, ada, { front: "Q" });
    expect(b.status).toBe(422);
  });

  it("edits, suspends and deletes cards and decks", async () => {
    const { deckId, ids } = await deckWith(ada, 2);
    const edited = await call<CardDto>("PATCH", `/flashcards/cards/${ids[0]}`, ada, {
      back: "New answer",
      suspended: true,
    });
    expect(edited.body).toMatchObject({ back: "New answer", suspended: true });
    expect((await call("DELETE", `/flashcards/cards/${ids[1]}`, ada)).status).toBe(204);
    expect(
      (await call<DeckDetailDto>("GET", `/flashcards/decks/${deckId}`, ada)).body.items,
    ).toHaveLength(1);
    const renamed = await call<DeckDto>("PATCH", `/flashcards/decks/${deckId}`, ada, {
      title: "Renamed",
    });
    expect(renamed.body.title).toBe("Renamed");
    expect((await call("DELETE", `/flashcards/decks/${deckId}`, ada)).status).toBe(204);
    const rows = await t.pool.query(`SELECT count(*)::int AS n FROM flashcards`);
    expect(rows.rows[0].n).toBe(0);
  });

  it("keeps decks private to their owner", async () => {
    const { deckId, ids } = await deckWith(ada, 1);
    expect((await call("GET", `/flashcards/decks/${deckId}`, bob)).status).toBe(404);
    expect((await call("PATCH", `/flashcards/cards/${ids[0]}`, bob, { front: "x" })).status).toBe(
      404,
    );
    expect((await call("DELETE", `/flashcards/decks/${deckId}`, bob)).status).toBe(404);
    expect((await call("GET", "/flashcards/study", null)).status).toBe(401);
    const r = await sync([review(ids[0]!, 4, "2026-03-10T11:00:00Z")], bob);
    expect(r.body.results[0]!.status).toBe("unknown_card");
    expect((await cardOf(deckId, ids[0]!)).isNew).toBe(true);
  });
});

describe("study queue", () => {
  it("serves new cards up to the daily limit and counts what was done", async () => {
    const { ids } = await deckWith(ada, 4);
    await call("PUT", "/flashcards/settings", ada, { newPerDay: 2, reviewsPerDay: 10 });
    const first = await call<StudyResponse>("GET", "/flashcards/study", ada);
    expect(first.body.fresh).toBe(2);
    expect(first.body.waitingNew).toBe(2);
    await sync(first.body.cards.map((c) => review(c.id, 4, "2026-03-10T11:00:00Z")));
    const again = await call<StudyResponse>("GET", "/flashcards/study", ada);
    expect(again.body.cards).toHaveLength(0);
    expect(again.body.waitingNew).toBe(2);
    const over = await call<FlashcardsResponse>("GET", "/flashcards", ada);
    expect(over.body.doneToday).toEqual({ fresh: 2, reviews: 0 });
    // the next day the reviewed cards are due again and two more new cards open up
    t.app.ai.now = () => new Date("2026-03-11T12:00:00Z");
    const next = await call<StudyResponse>("GET", "/flashcards/study", ada);
    expect(next.body.reviews).toBe(2);
    expect(next.body.fresh).toBe(2);
    expect(ids).toHaveLength(4);
  });

  it("leaves suspended cards out, and cram serves everything weakest first", async () => {
    const { deckId, ids } = await deckWith(ada, 3);
    await call("PATCH", `/flashcards/cards/${ids[0]}`, ada, { suspended: true });
    await sync([review(ids[1]!, 1, "2026-03-10T10:00:00Z")]); // a lapse: weakest
    const normal = await call<StudyResponse>("GET", `/flashcards/study?deckId=${deckId}`, ada);
    expect(normal.body.cards.map((c) => c.id)).toEqual([ids[2]]);
    const cram = await call<StudyResponse>(
      "GET",
      `/flashcards/study?deckId=${deckId}&cram=true`,
      ada,
    );
    expect(cram.body.cram).toBe(true);
    expect(cram.body.cards.map((c) => c.id)).toEqual([ids[1], ids[2]]);
  });
});

describe("review sync", () => {
  it("schedules a card with the SM-2 rules and reports the next due date", async () => {
    const { deckId, ids } = await deckWith(ada, 1);
    const r = await sync([review(ids[0]!, 4, "2026-03-10T11:00:00Z")]);
    expect(r.body.results[0]).toMatchObject({
      status: "applied",
      dueOn: "2026-03-11",
      intervalDays: 1,
    });
    const card = await cardOf(deckId, ids[0]!);
    expect(card).toMatchObject({ isNew: false, dueOn: "2026-03-11", lapses: 0 });
  });

  it("a repeated upload adds nothing (idempotent by client id)", async () => {
    const { ids } = await deckWith(ada, 1);
    const one = review(ids[0]!, 4, "2026-03-10T11:00:00Z", "same-id-0001");
    await sync([one]);
    const again = await sync([one]);
    expect(again.body.results[0]!.status).toBe("duplicate");
    const rows = await t.pool.query(`SELECT count(*)::int AS n FROM flashcard_reviews`);
    expect(rows.rows[0].n).toBe(1);
  });

  it("an offline batch is applied in the order it was answered, whatever order it arrives in", async () => {
    const { deckId, ids } = await deckWith(ada, 1);
    t.app.ai.now = () => new Date("2026-03-12T12:00:00Z");
    const r = await sync([
      review(ids[0]!, 4, "2026-03-11T09:00:00Z", "offline-b-0002"),
      review(ids[0]!, 4, "2026-03-10T09:00:00Z", "offline-a-0001"),
    ]);
    expect(r.body.results.map((x) => x.status)).toEqual(["applied", "applied"]);
    const card = await cardOf(deckId, ids[0]!);
    // two passes: 1 day, then 3 days from the second review's day
    expect(card.intervalDays).toBe(3);
    expect(card.dueOn).toBe("2026-03-14");
  });

  it("a review older than the stored newest one is kept as history and changes nothing", async () => {
    const { deckId, ids } = await deckWith(ada, 1);
    await sync([review(ids[0]!, 4, "2026-03-10T11:00:00Z", "online-0001")]);
    const before = await cardOf(deckId, ids[0]!);
    const r = await sync([review(ids[0]!, 1, "2026-03-10T08:00:00Z", "phone-old-0001")]);
    expect(r.body.results[0]!.status).toBe("stale");
    expect(await cardOf(deckId, ids[0]!)).toEqual(before);
    const rows = await t.pool.query(
      `SELECT stale FROM flashcard_reviews WHERE client_id = 'phone-old-0001'`,
    );
    expect(rows.rows[0].stale).toBe(true);
  });

  it("a forgotten card goes back to a one-day interval and counts a lapse", async () => {
    const { deckId, ids } = await deckWith(ada, 1);
    await sync([review(ids[0]!, 4, "2026-03-10T09:00:00Z")]);
    t.app.ai.now = () => new Date("2026-03-11T12:00:00Z");
    await sync([review(ids[0]!, 1, "2026-03-11T10:00:00Z")]);
    expect(await cardOf(deckId, ids[0]!)).toMatchObject({
      lapses: 1,
      intervalDays: 1,
      dueOn: "2026-03-12",
    });
  });

  it("follows the learner's time zone for the local day", async () => {
    await t.pool.query(`UPDATE profiles SET timezone = 'Asia/Kolkata'`);
    const { deckId, ids } = await deckWith(ada, 1);
    // 22:00 UTC is 03:30 the next day in India
    t.app.ai.now = () => new Date("2026-03-10T22:00:00Z");
    await sync([review(ids[0]!, 4, "2026-03-10T21:59:00Z")]);
    expect((await cardOf(deckId, ids[0]!)).dueOn).toBe("2026-03-12");
  });

  it("rejects malformed uploads", async () => {
    const { ids } = await deckWith(ada, 1);
    expect((await sync([{ ...review(ids[0]!, 9, NOW) }])).status).toBe(422);
    expect((await sync([{ ...review(ids[0]!, 3, "yesterday") }])).status).toBe(422);
    expect((await call("POST", "/flashcards/sync", ada, { reviews: [] })).status).toBe(422);
  });
});

describe("import, export and starter decks", () => {
  it("exports a deck and imports it again as a new deck", async () => {
    const { deckId } = await deckWith(ada, 2);
    const out = await call<{ format: string; cards: unknown[]; title: string }>(
      "GET",
      `/flashcards/decks/${deckId}/export`,
      ada,
    );
    expect(out.body).toMatchObject({ format: "prepquest-deck", title: "Patterns" });
    expect(out.body.cards).toHaveLength(2);
    const back = await call<DeckDto>("POST", "/flashcards/import", ada, out.body);
    expect(back.status).toBe(201);
    expect(back.body).toMatchObject({ title: "Patterns", cards: 2, source: "import" });
    const bad = await call("POST", "/flashcards/import", ada, {
      ...out.body,
      cards: [{ type: "cloze", front: "no gap", back: "" }],
    });
    expect(bad.status).toBe(422);
    expect((await call("POST", "/flashcards/import", ada, { nope: 1 })).status).toBe(422);
  });

  it("adds a starter deck once and copies its cards", async () => {
    await t.pool.query(
      `INSERT INTO flashcard_decks (id, owner_id, title, kind, starter_slug) VALUES
       ('00000000-0000-4000-8000-000000000001', NULL, 'Complexities', 'formulas', 'complexities')`,
    );
    await t.pool.query(
      `INSERT INTO flashcards (id, deck_id, type, front_md, back_md, due_on) VALUES
       (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 'basic', 'Binary search?', 'O(log n)', current_date),
       (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 'basic', 'Heap push?', 'O(log n)', current_date)`,
    );
    const list = await call<FlashcardsResponse>("GET", "/flashcards", ada);
    expect(list.body.starters).toEqual([
      expect.objectContaining({ slug: "complexities", cards: 2, adoptedAs: null }),
    ]);
    const first = await call<DeckDto>("POST", "/flashcards/starters/complexities/adopt", ada);
    expect(first.status).toBe(201);
    expect(first.body.cards).toBe(2);
    const second = await call<DeckDto>("POST", "/flashcards/starters/complexities/adopt", ada);
    expect(second.body.id).toBe(first.body.id);
    expect((await call<FlashcardsResponse>("GET", "/flashcards", ada)).body.decks).toHaveLength(1);
    expect((await call<FlashcardsResponse>("GET", "/flashcards", bob)).body.decks).toHaveLength(0);
    expect((await call("POST", "/flashcards/starters/missing/adopt", ada)).status).toBe(404);
  });
});

describe("quiz mistakes", () => {
  const question = async (slug: string, type: string, answer: string, options?: string) => {
    const r = await t.pool.query(
      `INSERT INTO quiz_questions (id, slug, subject, topic, difficulty, type, body_md, options, answer, explanation_md)
       VALUES (gen_random_uuid(), $1, 'os', 'processes', 2, $2, $3, $4::jsonb, $5::jsonb, 'Because that is how it works.')
       RETURNING id`,
      [slug, type, `Question for ${slug}?`, options ?? null, answer],
    );
    return r.rows[0].id as string;
  };
  const attempt = async (
    userEmail: string,
    answers: Array<[string, boolean]>,
    finished: boolean,
  ) => {
    const u = await t.pool.query(`SELECT id FROM users WHERE email = $1`, [userEmail]);
    const a = await t.pool.query(
      `INSERT INTO quiz_attempts (id, user_id, mode, question_ids, total, finished_at)
       VALUES (gen_random_uuid(), $1, 'practice', $2::jsonb, $3, $4) RETURNING id`,
      [
        u.rows[0].id,
        JSON.stringify(answers.map((x) => x[0])),
        answers.length,
        finished ? new Date() : null,
      ],
    );
    for (const [q, ok] of answers)
      await t.pool.query(
        `INSERT INTO quiz_attempt_answers (attempt_id, question_id, response, correct) VALUES ($1, $2, '"a"', $3)`,
        [a.rows[0].id, q, ok],
      );
    return a.rows[0].id as string;
  };

  it("turns wrong answers into cards once, with the answer and the explanation on the back", async () => {
    const q1 = await question(
      "q-one",
      "single",
      '"b"',
      '[{"id":"a","text":"Stack"},{"id":"b","text":"Queue"}]',
    );
    const q2 = await question("q-two", "tf", "true");
    const q3 = await question("q-three", "tf", "false");
    const id = await attempt(
      "ada@example.com",
      [
        [q1, false],
        [q2, false],
        [q3, true],
      ],
      true,
    );
    const first = await call<MistakesResponse>("POST", "/flashcards/from-quiz", ada, {
      attemptId: id,
    });
    expect(first.body).toMatchObject({ added: 2, skipped: 0 });
    const deck = await call<DeckDetailDto>("GET", `/flashcards/decks/${first.body.deckId}`, ada);
    expect(deck.body).toMatchObject({ kind: "mistakes", title: "Quiz mistakes" });
    const one = deck.body.items.find((c) => c.front.includes("q-one"))!;
    expect(one.front).toContain("- B. Queue");
    expect(one.back).toContain("**Answer:** Queue");
    expect(one.back).toContain("Because that is how it works.");
    const again = await call<MistakesResponse>("POST", "/flashcards/from-quiz", ada, {
      attemptId: id,
    });
    expect(again.body).toMatchObject({ added: 0, skipped: 2, deckId: first.body.deckId });
  });

  it("adds one question the learner answered, and refuses open attempts and strangers' attempts", async () => {
    const q = await question("q-solo", "tf", "true");
    const open = await attempt("ada@example.com", [[q, false]], false);
    expect((await call("POST", "/flashcards/from-quiz", ada, { attemptId: open })).status).toBe(
      409,
    );
    expect((await call("POST", "/flashcards/from-quiz", ada, { questionId: q })).status).toBe(409);
    const done = await attempt("ada@example.com", [[q, false]], true);
    expect((await call("POST", "/flashcards/from-quiz", bob, { attemptId: done })).status).toBe(
      404,
    );
    const one = await call<MistakesResponse>("POST", "/flashcards/from-quiz", ada, {
      questionId: q,
    });
    expect(one.body.added).toBe(1);
    expect((await call("POST", "/flashcards/from-quiz", ada, {})).status).toBe(422);
  });
});
