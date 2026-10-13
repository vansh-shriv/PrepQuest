import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  flashcardDecks,
  flashcardReviews,
  flashcards,
  newId,
  profiles,
  quizAttemptAnswers,
  quizAttempts,
  quizQuestions,
  userSettings,
  type Database,
  type Db,
} from "@prepquest/db";
import {
  cardIssues,
  DEFAULT_NEW_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
  localDay,
  mergeOfflineReviews,
  renderCard,
  studyQueue,
  type CardType,
  type StudyCard,
} from "@prepquest/analytics-core";
import { AppError } from "@prepquest/shared";
import type {
  CardDto,
  DeckDetailDto,
  DeckDto,
  DeckExport,
  DeckKindValue,
  FlashcardsResponse,
  MistakesResponse,
  StarterDeckDto,
  StudyResponse,
  SyncResponse,
} from "@prepquest/shared";

// Flashcards (X6). Scheduling and queue rules are in `analytics-core/flashcards.ts`; this module loads and
// stores decks and cards. Due dates are the learner's local days. Reviews arrive through `sync`, whether the
// device was online or not, so there is one path and one idempotency key (`client_id`).

const MAX_DECKS = 50;
const MAX_CARDS_PER_DECK = 1000;

type CardRow = typeof flashcards.$inferSelect;
type DeckRow = typeof flashcardDecks.$inferSelect;

const notFound = (what: string) => new AppError("NOT_FOUND", 404, `That ${what} does not exist.`);

async function timezoneOf(db: Db, userId: string): Promise<string> {
  const [p] = await db
    .select({ tz: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  return p?.tz ?? "UTC";
}

export async function settingsOf(db: Db, userId: string) {
  const [s] = await db
    .select({
      newPerDay: userSettings.flashcardNewPerDay,
      reviewsPerDay: userSettings.flashcardReviewsPerDay,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return s ?? { newPerDay: DEFAULT_NEW_PER_DAY, reviewsPerDay: DEFAULT_REVIEWS_PER_DAY };
}

export async function saveSettings(
  db: Database,
  userId: string,
  s: { newPerDay: number; reviewsPerDay: number },
) {
  await db
    .insert(userSettings)
    .values({
      userId,
      flashcardNewPerDay: s.newPerDay,
      flashcardReviewsPerDay: s.reviewsPerDay,
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { flashcardNewPerDay: s.newPerDay, flashcardReviewsPerDay: s.reviewsPerDay },
    });
  return s;
}

function toCard(c: CardRow): CardDto {
  const faces = renderCard({ type: c.type as CardType, front: c.frontMd, back: c.backMd });
  return {
    id: c.id,
    deckId: c.deckId,
    type: c.type as CardType,
    front: c.frontMd,
    back: c.backMd,
    prompt: faces.prompt,
    answer: faces.answer,
    originType: c.originType,
    dueOn: c.dueOn,
    intervalDays: c.intervalDays,
    lapses: c.lapses,
    suspended: c.suspended,
    isNew: c.lastReviewedAt === null,
  };
}

async function ownedDeck(db: Db, userId: string, id: string): Promise<DeckRow> {
  const [d] = await db
    .select()
    .from(flashcardDecks)
    .where(and(eq(flashcardDecks.id, id), eq(flashcardDecks.ownerId, userId)));
  if (!d) throw notFound("deck");
  return d;
}

async function ownedCard(db: Db, userId: string, id: string): Promise<CardRow> {
  const [row] = await db
    .select({ card: flashcards })
    .from(flashcards)
    .innerJoin(flashcardDecks, eq(flashcardDecks.id, flashcards.deckId))
    .where(and(eq(flashcards.id, id), eq(flashcardDecks.ownerId, userId)));
  if (!row) throw notFound("card");
  return row.card;
}

async function deckCounts(db: Db, userId: string, today: string) {
  const r = await db.execute(sql`
    SELECT c.deck_id AS id, count(*)::int AS cards,
      count(*) FILTER (WHERE NOT c.suspended AND c.last_reviewed_at IS NULL)::int AS fresh,
      count(*) FILTER (WHERE NOT c.suspended AND c.last_reviewed_at IS NOT NULL AND c.due_on <= ${today})::int AS due
    FROM flashcards c JOIN flashcard_decks d ON d.id = c.deck_id
    WHERE d.owner_id = ${userId} GROUP BY c.deck_id`);
  return new Map(
    (r.rows as Array<{ id: string; cards: number; fresh: number; due: number }>).map((x) => [
      x.id,
      x,
    ]),
  );
}

const toDeck = (d: DeckRow, n?: { cards: number; fresh: number; due: number }): DeckDto => ({
  id: d.id,
  title: d.title,
  description: d.description,
  kind: d.kind as DeckKindValue,
  source: d.source,
  cards: n?.cards ?? 0,
  due: n?.due ?? 0,
  fresh: n?.fresh ?? 0,
  createdAt: d.createdAt.toISOString(),
});

async function doneToday(db: Db, userId: string, today: string) {
  const r = await db.execute(sql`
    SELECT count(*) FILTER (WHERE was_new)::int AS fresh,
      count(*) FILTER (WHERE NOT was_new)::int AS reviews
    FROM flashcard_reviews WHERE user_id = ${userId} AND reviewed_on = ${today} AND NOT stale`);
  const row = r.rows[0] as { fresh: number; reviews: number };
  return { fresh: Number(row.fresh), reviews: Number(row.reviews) };
}

export async function overview(
  db: Database,
  userId: string,
  now: Date,
): Promise<FlashcardsResponse> {
  const today = localDay(now, await timezoneOf(db, userId));
  const decks = await db
    .select()
    .from(flashcardDecks)
    .where(eq(flashcardDecks.ownerId, userId))
    .orderBy(desc(flashcardDecks.createdAt), asc(flashcardDecks.id));
  const counts = await deckCounts(db, userId, today);
  const starters = await db
    .select()
    .from(flashcardDecks)
    .where(sql`${flashcardDecks.starterSlug} IS NOT NULL`)
    .orderBy(asc(flashcardDecks.starterSlug));
  const starterCounts = new Map(
    (
      (
        await db.execute(sql`
          SELECT deck_id AS id, count(*)::int AS n FROM flashcards
          WHERE deck_id IN (SELECT id FROM flashcard_decks WHERE starter_slug IS NOT NULL) GROUP BY deck_id`)
      ).rows as Array<{ id: string; n: number }>
    ).map((x) => [x.id, x.n]),
  );
  const adopted = new Map(
    decks.filter((d) => d.source?.startsWith("starter:")).map((d) => [d.source!.slice(8), d.id]),
  );
  return {
    decks: decks.map((d) => toDeck(d, counts.get(d.id))),
    starters: starters.map((s): StarterDeckDto => ({
      slug: s.starterSlug!,
      title: s.title,
      description: s.description,
      kind: s.kind as DeckKindValue,
      cards: starterCounts.get(s.id) ?? 0,
      adoptedAs: adopted.get(s.starterSlug!) ?? null,
    })),
    today,
    settings: await settingsOf(db, userId),
    doneToday: await doneToday(db, userId, today),
  };
}

export async function createDeck(
  db: Db,
  userId: string,
  input: { title: string; description?: string | undefined; kind: DeckKindValue },
  source: string | null = null,
): Promise<DeckRow> {
  const [{ n }] = (await db
    .select({ n: count() })
    .from(flashcardDecks)
    .where(eq(flashcardDecks.ownerId, userId))) as [{ n: number }];
  if (n >= MAX_DECKS)
    throw new AppError("LIMIT_REACHED", 409, `You can keep up to ${MAX_DECKS} decks.`);
  const [row] = await db
    .insert(flashcardDecks)
    .values({
      id: newId(),
      ownerId: userId,
      title: input.title,
      description: input.description ?? null,
      kind: input.kind,
      source,
    })
    .returning();
  return row!;
}

export async function getDeck(
  db: Database,
  userId: string,
  id: string,
  now: Date,
): Promise<DeckDetailDto> {
  const d = await ownedDeck(db, userId, id);
  const today = localDay(now, await timezoneOf(db, userId));
  const cards = await db
    .select()
    .from(flashcards)
    .where(eq(flashcards.deckId, id))
    .orderBy(asc(flashcards.createdAt), asc(flashcards.id));
  const counts = (await deckCounts(db, userId, today)).get(id);
  return { ...toDeck(d, counts), items: cards.map(toCard) };
}

export async function updateDeck(
  db: Database,
  userId: string,
  id: string,
  patch: { title?: string; description?: string | null; kind?: DeckKindValue },
) {
  await ownedDeck(db, userId, id);
  const set = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
  };
  const [row] = await db
    .update(flashcardDecks)
    .set(set)
    .where(eq(flashcardDecks.id, id))
    .returning();
  return toDeck(row!);
}

export async function deleteDeck(db: Database, userId: string, id: string) {
  await ownedDeck(db, userId, id);
  await db.delete(flashcardDecks).where(eq(flashcardDecks.id, id));
}

function assertCard(card: { type: CardType; front: string; back: string }) {
  const issues = cardIssues(card);
  if (issues.length > 0)
    throw new AppError("VALIDATION_FAILED", 422, issues[0]!, { field: "front", issues });
}

export async function addCard(
  db: Database,
  userId: string,
  deckId: string,
  input: {
    type: CardType;
    front: string;
    back: string;
    originType?: string | undefined;
    originId?: string | undefined;
  },
  now: Date,
): Promise<CardDto> {
  await ownedDeck(db, userId, deckId);
  assertCard(input);
  const [{ n }] = (await db
    .select({ n: count() })
    .from(flashcards)
    .where(eq(flashcards.deckId, deckId))) as [{ n: number }];
  if (n >= MAX_CARDS_PER_DECK)
    throw new AppError("LIMIT_REACHED", 409, `A deck holds up to ${MAX_CARDS_PER_DECK} cards.`);
  const today = localDay(now, await timezoneOf(db, userId));
  const [row] = await db
    .insert(flashcards)
    .values({
      id: newId(),
      deckId,
      type: input.type,
      frontMd: input.front,
      backMd: input.back,
      originType: input.originType ?? null,
      originId: input.originId ?? null,
      dueOn: today,
    })
    .returning();
  return toCard(row!);
}

export async function updateCard(
  db: Database,
  userId: string,
  id: string,
  patch: { type?: CardType; front?: string; back?: string; suspended?: boolean },
): Promise<CardDto> {
  const c = await ownedCard(db, userId, id);
  const next = {
    type: patch.type ?? (c.type as CardType),
    front: patch.front ?? c.frontMd,
    back: patch.back ?? c.backMd,
  };
  assertCard(next);
  const [row] = await db
    .update(flashcards)
    .set({
      type: next.type,
      frontMd: next.front,
      backMd: next.back,
      ...(patch.suspended !== undefined ? { suspended: patch.suspended } : {}),
    })
    .where(eq(flashcards.id, id))
    .returning();
  return toCard(row!);
}

export async function deleteCard(db: Database, userId: string, id: string) {
  await ownedCard(db, userId, id);
  await db.delete(flashcards).where(eq(flashcards.id, id));
}

/** Copy a starter deck into the learner's decks (once). */
export async function adoptStarter(
  db: Database,
  userId: string,
  slug: string,
  now: Date,
): Promise<DeckDto> {
  const [starter] = await db
    .select()
    .from(flashcardDecks)
    .where(eq(flashcardDecks.starterSlug, slug));
  if (!starter) throw notFound("starter deck");
  const source = `starter:${slug}`;
  const [existing] = await db
    .select()
    .from(flashcardDecks)
    .where(and(eq(flashcardDecks.ownerId, userId), eq(flashcardDecks.source, source)));
  if (existing) return toDeck(existing);
  const cards = await db
    .select()
    .from(flashcards)
    .where(eq(flashcards.deckId, starter.id))
    .orderBy(asc(flashcards.createdAt), asc(flashcards.id));
  const today = localDay(now, await timezoneOf(db, userId));
  const deck = await createDeck(
    db,
    userId,
    {
      title: starter.title,
      description: starter.description ?? undefined,
      kind: starter.kind as DeckKindValue,
    },
    source,
  );
  if (cards.length > 0) {
    await db.insert(flashcards).values(
      cards.map((c) => ({
        id: newId(),
        deckId: deck.id,
        type: c.type,
        frontMd: c.frontMd,
        backMd: c.backMd,
        dueOn: today,
      })),
    );
  }
  return toDeck(deck, { cards: cards.length, fresh: cards.length, due: 0 });
}

export async function exportDeck(db: Database, userId: string, id: string): Promise<DeckExport> {
  const d = await ownedDeck(db, userId, id);
  const cards = await db
    .select()
    .from(flashcards)
    .where(eq(flashcards.deckId, id))
    .orderBy(asc(flashcards.createdAt), asc(flashcards.id));
  return {
    format: "prepquest-deck",
    version: 1,
    title: d.title,
    ...(d.description ? { description: d.description } : {}),
    kind: d.kind as DeckKindValue,
    cards: cards.map((c) => ({ type: c.type as CardType, front: c.frontMd, back: c.backMd })),
  };
}

export async function importDeck(
  db: Database,
  userId: string,
  input: DeckExport,
  now: Date,
): Promise<DeckDto> {
  for (const [i, c] of input.cards.entries()) {
    const issues = cardIssues(c);
    if (issues.length > 0)
      throw new AppError("VALIDATION_FAILED", 422, `Card ${i + 1}: ${issues[0]}`, {
        field: "cards",
        issues,
      });
  }
  const today = localDay(now, await timezoneOf(db, userId));
  return db.transaction(async (tx) => {
    const deck = await createDeck(tx, userId, input, "import");
    await tx.insert(flashcards).values(
      input.cards.map((c) => ({
        id: newId(),
        deckId: deck.id,
        type: c.type,
        frontMd: c.front,
        backMd: c.back,
        dueOn: today,
      })),
    );
    return toDeck(deck, { cards: input.cards.length, fresh: input.cards.length, due: 0 });
  });
}

/** Today's cards for one deck or all decks, or the cram set. */
export async function study(
  db: Database,
  userId: string,
  opts: { deckId?: string | undefined; cram: boolean },
  now: Date,
): Promise<StudyResponse> {
  if (opts.deckId) await ownedDeck(db, userId, opts.deckId);
  const today = localDay(now, await timezoneOf(db, userId));
  const rows = await db
    .select({ card: flashcards })
    .from(flashcards)
    .innerJoin(flashcardDecks, eq(flashcardDecks.id, flashcards.deckId))
    .where(
      and(
        eq(flashcardDecks.ownerId, userId),
        opts.deckId ? eq(flashcards.deckId, opts.deckId) : undefined,
      ),
    )
    .orderBy(asc(flashcards.createdAt), asc(flashcards.id));
  const byId = new Map(rows.map((r) => [r.card.id, r.card]));
  const cards: Array<StudyCard & { row: CardRow }> = rows.map(({ card }) => ({
    id: card.id,
    dueOn: card.dueOn,
    suspended: card.suspended,
    ease: Number(card.ease),
    lapses: card.lapses,
    isNew: card.lastReviewedAt === null,
    row: card,
  }));
  const settings = await settingsOf(db, userId);
  const done = await doneToday(db, userId, today);
  const q = studyQueue(cards, {
    today,
    newPerDay: settings.newPerDay,
    reviewsPerDay: settings.reviewsPerDay,
    newDoneToday: done.fresh,
    reviewsDoneToday: done.reviews,
    cram: opts.cram,
  });
  return {
    cards: q.cards.map((c) => toCard(byId.get(c.id)!)),
    today,
    cram: q.cram,
    reviews: q.reviews,
    fresh: q.fresh,
    waitingReviews: q.waitingReviews,
    waitingNew: q.waitingNew,
    serverTime: now.toISOString(),
  };
}

export interface IncomingReview {
  clientId: string;
  cardId: string;
  quality: number;
  reviewedAt: string;
}

/**
 * Store reviews from a device. Safe to repeat: a `clientId` already stored is reported as a duplicate. A
 * review older than the card's newest stored one is kept as history without moving the schedule.
 */
export async function sync(
  db: Database,
  userId: string,
  incoming: readonly IncomingReview[],
  now: Date,
): Promise<SyncResponse> {
  const tz = await timezoneOf(db, userId);
  const dayOf = (iso: string) => localDay(new Date(iso), tz);
  const results = new Map<string, SyncResponse["results"][number]>();
  const unique = [...new Map(incoming.map((r) => [r.clientId, r])).values()];
  const byCard = new Map<string, IncomingReview[]>();
  for (const r of unique) byCard.set(r.cardId, [...(byCard.get(r.cardId) ?? []), r]);

  for (const [cardId, reviews] of byCard) {
    await db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ card: flashcards })
        .from(flashcards)
        .innerJoin(flashcardDecks, eq(flashcardDecks.id, flashcards.deckId))
        .where(and(eq(flashcards.id, cardId), eq(flashcardDecks.ownerId, userId)))
        .for("update", { of: flashcards });
      if (!owned) {
        for (const r of reviews)
          results.set(r.clientId, {
            clientId: r.clientId,
            cardId,
            status: "unknown_card",
            dueOn: null,
            intervalDays: null,
          });
        return;
      }
      const card = owned.card;
      const seen = new Set(
        (
          await tx
            .select({ id: flashcardReviews.clientId })
            .from(flashcardReviews)
            .where(
              inArray(
                flashcardReviews.clientId,
                reviews.map((r) => r.clientId),
              ),
            )
        ).map((x) => x.id),
      );
      const fresh = reviews.filter((r) => !seen.has(r.clientId));
      for (const r of reviews)
        if (seen.has(r.clientId))
          results.set(r.clientId, {
            clientId: r.clientId,
            cardId,
            status: "duplicate",
            dueOn: card.dueOn,
            intervalDays: card.intervalDays,
          });
      if (fresh.length === 0) return;
      const outcome = mergeOfflineReviews(
        {
          ease: Number(card.ease),
          intervalDays: card.intervalDays,
          repetitions: card.repetitions,
          lapses: card.lapses,
          dueOn: card.dueOn,
          lastReviewedAt: card.lastReviewedAt ? card.lastReviewedAt.toISOString() : null,
        },
        fresh,
        dayOf,
        now,
      );
      const next = outcome.card;
      if (outcome.applied.length > 0) {
        await tx
          .update(flashcards)
          .set({
            ease: next.ease.toFixed(2),
            intervalDays: next.intervalDays,
            repetitions: next.repetitions,
            lapses: next.lapses,
            dueOn: next.dueOn,
            lastReviewedAt: new Date(next.lastReviewedAt!),
          })
          .where(eq(flashcards.id, card.id));
      }
      const appliedIds = new Map(
        outcome.applied.map((a, i) => [a.clientId, { a, first: i === 0 }]),
      );
      const wasNewCard = card.lastReviewedAt === null;
      const rows = fresh.map((r) => {
        const hit = appliedIds.get(r.clientId);
        const t = Number.isNaN(Date.parse(r.reviewedAt))
          ? now
          : new Date(Math.min(Date.parse(r.reviewedAt), now.getTime() + 5 * 60_000));
        return {
          id: newId(),
          cardId: card.id,
          userId,
          quality: r.quality,
          reviewedAt: t,
          reviewedOn: hit ? hit.a.day : dayOf(t.toISOString()),
          prevInterval: hit ? hit.a.prevInterval : card.intervalDays,
          newInterval: hit ? hit.a.newInterval : card.intervalDays,
          wasNew: Boolean(hit?.first && wasNewCard),
          stale: !hit,
          clientId: r.clientId,
        };
      });
      await tx.insert(flashcardReviews).values(rows).onConflictDoNothing();
      for (const r of fresh) {
        const stale = outcome.stale.includes(r.clientId);
        results.set(r.clientId, {
          clientId: r.clientId,
          cardId,
          status: stale ? "stale" : "applied",
          dueOn: next.dueOn,
          intervalDays: next.intervalDays,
        });
      }
    });
  }
  return {
    results: incoming.map(
      (r) =>
        results.get(r.clientId) ?? {
          clientId: r.clientId,
          cardId: r.cardId,
          status: "duplicate" as const,
          dueOn: null,
          intervalDays: null,
        },
    ),
    serverTime: now.toISOString(),
  };
}

type QuizRow = typeof quizQuestions.$inferSelect;

/** The correct answer of a quiz question as text for the back of a card. */
export function answerText(q: Pick<QuizRow, "type" | "options" | "answer">): string {
  const options = q.options ?? [];
  const label = (id: string) => options.find((o) => o.id === id)?.text ?? id;
  if (q.type === "single") return label(String(q.answer));
  if (q.type === "multi") return (q.answer as string[]).map(label).join("; ");
  if (q.type === "tf") return q.answer === true ? "True" : "False";
  return (q.answer as string[]).join(" / ");
}

function mistakeFaces(q: QuizRow) {
  const options = (q.options ?? []).map((o) => `- ${o.id.toUpperCase()}. ${o.text}`).join("\n");
  const front = options ? `${q.bodyMd}\n\n${options}` : q.bodyMd;
  const back = [
    `**Answer:** ${answerText(q)}`,
    q.explanationMd,
    q.interviewLine ? `In an interview: ${q.interviewLine}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { front, back };
}

/** Wrong quiz answers become cards in the learner's "Quiz mistakes" deck (once per question). */
export async function addMistakes(
  db: Database,
  userId: string,
  input: { attemptId?: string | undefined; questionId?: string | undefined },
  now: Date,
): Promise<MistakesResponse> {
  let questionIds: string[];
  if (input.attemptId) {
    const [a] = await db
      .select()
      .from(quizAttempts)
      .where(and(eq(quizAttempts.id, input.attemptId), eq(quizAttempts.userId, userId)));
    if (!a) throw notFound("quiz attempt");
    if (!a.finishedAt)
      throw new AppError("ATTEMPT_OPEN", 409, "Finish the quiz before saving its mistakes.");
    questionIds = (
      await db
        .select({ id: quizAttemptAnswers.questionId })
        .from(quizAttemptAnswers)
        .where(and(eq(quizAttemptAnswers.attemptId, a.id), eq(quizAttemptAnswers.correct, false)))
    ).map((x) => x.id);
  } else {
    const q = input.questionId!;
    const answered = await db
      .select({ id: quizAttemptAnswers.questionId })
      .from(quizAttemptAnswers)
      .innerJoin(quizAttempts, eq(quizAttempts.id, quizAttemptAnswers.attemptId))
      .where(
        and(
          eq(quizAttempts.userId, userId),
          eq(quizAttemptAnswers.questionId, q),
          sql`${quizAttempts.finishedAt} IS NOT NULL`,
        ),
      )
      .limit(1);
    if (answered.length === 0)
      throw new AppError("NOT_ANSWERED", 409, "Answer the question in a finished quiz first.");
    questionIds = [q];
  }
  if (questionIds.length === 0) return { deckId: "", added: 0, skipped: 0 };

  let [deck] = await db
    .select()
    .from(flashcardDecks)
    .where(and(eq(flashcardDecks.ownerId, userId), eq(flashcardDecks.kind, "mistakes")))
    .orderBy(asc(flashcardDecks.createdAt))
    .limit(1);
  deck ??= await createDeck(
    db,
    userId,
    { title: "Quiz mistakes", description: "Questions you got wrong.", kind: "mistakes" },
    "mistakes",
  );
  const have = new Set(
    (
      await db
        .select({ id: flashcards.originId })
        .from(flashcards)
        .where(
          and(
            eq(flashcards.deckId, deck.id),
            eq(flashcards.originType, "quiz_question"),
            inArray(flashcards.originId, questionIds),
          ),
        )
    ).map((x) => x.id),
  );
  const todo = questionIds.filter((id) => !have.has(id));
  if (todo.length > 0) {
    const today = localDay(now, await timezoneOf(db, userId));
    const questions = await db.select().from(quizQuestions).where(inArray(quizQuestions.id, todo));
    await db.insert(flashcards).values(
      questions.map((q) => {
        const f = mistakeFaces(q);
        return {
          id: newId(),
          deckId: deck.id,
          type: "basic",
          frontMd: f.front,
          backMd: f.back,
          originType: "quiz_question",
          originId: q.id,
          dueOn: today,
        };
      }),
    );
  }
  return { deckId: deck.id, added: todo.length, skipped: questionIds.length - todo.length };
}
