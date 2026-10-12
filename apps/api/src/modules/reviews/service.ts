import { and, eq, sql } from "drizzle-orm";
import {
  newId,
  profiles,
  srsCards,
  srsReviews,
  userSettings,
  type Database,
  type Db,
} from "@prepquest/db";
import {
  addDays,
  buildQueue,
  DEFAULT_REVIEW_CAP,
  localDay,
  newCard,
  RATING_QUALITY,
  retention,
  review,
  solveQuality,
  type Rating,
} from "@prepquest/analytics-core";
import type {
  ReviewCardDto,
  ReviewGradeResponse,
  ReviewsResponse,
  SolveRating,
} from "@prepquest/shared";
import { AppError } from "@prepquest/shared";

// Spaced repetition for solved problems (D6). The rules are in `analytics-core/srs.ts`; this module loads
// and stores cards. Due dates are the learner's local days, so "due today" follows their time zone.

type Row = typeof srsCards.$inferSelect;

async function timezoneOf(db: Db, userId: string): Promise<string> {
  const [p] = await db
    .select({ tz: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  return p?.tz ?? "UTC";
}

const toValues = (c: {
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}) => ({
  ease: c.ease.toFixed(2),
  intervalDays: c.intervalDays,
  repetitions: c.repetitions,
  lapses: c.lapses,
});

/** Rejected submissions of a problem since a moment (finished ones only; infrastructure errors do not count). */
async function failedSince(db: Db, userId: string, problemId: string, since: Date) {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM submissions
    WHERE user_id = ${userId} AND problem_id = ${problemId} AND kind = 'submit'
      AND verdict NOT IN ('AC','IE','QUEUED','COMPILING','RUNNING') AND created_at > ${since}`);
  return Number((r.rows[0] as { n: number }).n);
}

export interface AcceptedFacts {
  userId: string;
  problemId: string;
  solvedBefore: boolean;
  /** Submissions made before this accepted one. */
  attemptsBefore: number;
  hintTiers: number;
  now: Date;
}

/**
 * Called in the judge-result transaction for an accepted practice submission.
 * The first solve creates the card; a later solve of a card that is due is its review, graded from how the
 * attempt went. A card that is not due yet is left alone.
 */
export async function afterAccepted(tx: Db, a: AcceptedFacts): Promise<void> {
  const tz = await timezoneOf(tx, a.userId);
  const today = localDay(a.now, tz);
  if (!a.solvedBefore) {
    const quality = solveQuality({ failedAttempts: a.attemptsBefore, hintTiers: a.hintTiers });
    const card = newCard(quality, today);
    await tx
      .insert(srsCards)
      .values({
        id: newId(),
        userId: a.userId,
        problemId: a.problemId,
        ...toValues(card),
        dueOn: card.dueOn,
      })
      .onConflictDoNothing();
    return;
  }
  const [card] = await tx
    .select()
    .from(srsCards)
    .where(and(eq(srsCards.userId, a.userId), eq(srsCards.problemId, a.problemId)))
    .for("update");
  if (!card || card.suspended || card.dueOn > today) return;
  const [last] = (
    await tx.execute(sql`SELECT max(reviewed_at) AS at FROM srs_reviews WHERE card_id = ${card.id}`)
  ).rows as Array<{ at: Date | null }>;
  const since = last?.at ? new Date(last.at) : card.createdAt;
  const failed = await failedSince(tx, a.userId, a.problemId, since);
  await apply(
    tx,
    card,
    solveQuality({ failedAttempts: failed, hintTiers: 0 }),
    today,
    a.now,
    "auto",
  );
}

async function apply(
  tx: Db,
  card: Row,
  quality: number,
  today: string,
  now: Date,
  source: "auto" | "manual",
): Promise<ReviewGradeResponse> {
  const next = review(
    {
      ease: Number(card.ease),
      intervalDays: card.intervalDays,
      repetitions: card.repetitions,
      lapses: card.lapses,
    },
    quality,
    today,
  );
  await tx
    .update(srsCards)
    .set({ ...toValues(next), dueOn: next.dueOn, lastReviewedOn: today })
    .where(eq(srsCards.id, card.id));
  await tx.insert(srsReviews).values({
    id: newId(),
    cardId: card.id,
    userId: card.userId,
    quality,
    source,
    reviewedAt: now,
    reviewedOn: today,
    prevInterval: card.intervalDays,
    newInterval: next.intervalDays,
  });
  return {
    id: card.id,
    intervalDays: next.intervalDays,
    dueOn: next.dueOn,
    lapses: next.lapses,
    lapsed: quality < 3,
  };
}

/**
 * The self-rating after a solve refines the card made by that solve, as long as it has not been reviewed
 * yet (a rating of "easy" earns a longer ease, "again" is a shaky solve).
 */
export async function applySolveRating(
  db: Database,
  userId: string,
  problemId: string,
  rating: SolveRating,
  facts: {
    attempts: number;
    firstTryAc: boolean | null;
    hintsUsed: number;
    firstAcAt: Date | null;
  },
): Promise<void> {
  const tz = await timezoneOf(db, userId);
  await db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(srsCards)
      .where(and(eq(srsCards.userId, userId), eq(srsCards.problemId, problemId)))
      .for("update");
    if (!card) return;
    const reviewed = (
      await tx.execute(sql`SELECT count(*)::int AS n FROM srs_reviews WHERE card_id = ${card.id}`)
    ).rows[0] as { n: number };
    if (Number(reviewed.n) > 0) return;
    const failedAttempts = facts.firstTryAc ? 0 : Math.max(1, facts.attempts - 1);
    const quality = solveQuality({ failedAttempts, hintTiers: facts.hintsUsed, rating });
    const first = localDay(facts.firstAcAt ?? card.createdAt, tz);
    const fresh = newCard(quality, first);
    await tx
      .update(srsCards)
      .set({ ...toValues(fresh), dueOn: fresh.dueOn })
      .where(eq(srsCards.id, card.id));
  });
}

/** Solved problems from before spaced repetition existed get a card too (due a day after the first solve). */
async function ensureCards(db: Database, userId: string, tz: string): Promise<void> {
  const missing = (
    await db.execute(sql`
      SELECT ups.problem_id, ups.first_ac_at, ups.first_try_ac, ups.hints_used, ups.attempts,
             ups.solve_rating, ups.gave_up_at
      FROM user_problem_state ups
      WHERE ups.user_id = ${userId} AND ups.status = 'solved' AND ups.first_ac_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM srs_cards c WHERE c.user_id = ups.user_id AND c.problem_id = ups.problem_id)`)
  ).rows as unknown as Array<{
    problem_id: string;
    first_ac_at: Date;
    first_try_ac: boolean | null;
    hints_used: number;
    attempts: number;
    solve_rating: Rating | null;
    gave_up_at: Date | null;
  }>;
  for (const m of missing) {
    const quality = solveQuality({
      failedAttempts: m.first_try_ac ? 0 : Math.max(1, m.attempts - 1),
      hintTiers: m.gave_up_at ? 3 : m.hints_used,
      rating: m.solve_rating,
    });
    const card = newCard(quality, localDay(new Date(m.first_ac_at), tz));
    await db
      .insert(srsCards)
      .values({
        id: newId(),
        userId,
        problemId: m.problem_id,
        ...toValues(card),
        dueOn: card.dueOn,
      })
      .onConflictDoNothing();
  }
}

async function reviewCap(db: Db, userId: string): Promise<number> {
  const [s] = await db
    .select({ cap: userSettings.reviewCap })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return s?.cap ?? DEFAULT_REVIEW_CAP;
}

export async function setReviewCap(db: Database, userId: string, cap: number) {
  await db
    .insert(userSettings)
    .values({ userId, reviewCap: cap })
    .onConflictDoUpdate({ target: userSettings.userId, set: { reviewCap: cap } });
  return { cap };
}

async function dtoRows(db: Db, userId: string) {
  return (
    await db.execute(sql`
      SELECT c.id, c.due_on::text AS due_on, c.interval_days, c.ease::float AS ease, c.lapses,
        c.suspended, c.repetitions, p.slug, p.title, p.difficulty,
        COALESCE((SELECT array_agg(t.slug ORDER BY t.slug) FROM problem_tags pt
          JOIN tags t ON t.id = pt.tag_id AND t.kind = 'topic' WHERE pt.problem_id = p.id), '{}') AS topics
      FROM srs_cards c JOIN problems p ON p.id = c.problem_id
      WHERE c.user_id = ${userId} AND p.status = 'published'`)
  ).rows as unknown as Array<{
    id: string;
    due_on: string;
    interval_days: number;
    ease: number;
    lapses: number;
    suspended: boolean;
    repetitions: number;
    slug: string;
    title: string;
    difficulty: "easy" | "medium" | "hard";
    topics: string[];
  }>;
}

export async function getReviews(
  db: Database,
  userId: string,
  now: Date,
): Promise<ReviewsResponse> {
  const tz = await timezoneOf(db, userId);
  const today = localDay(now, tz);
  await ensureCards(db, userId, tz);
  const rows = await dtoRows(db, userId);
  const cap = await reviewCap(db, userId);
  const done = (
    await db.execute(
      sql`SELECT count(*)::int AS n FROM srs_reviews WHERE user_id = ${userId} AND reviewed_on = ${today}`,
    )
  ).rows[0] as { n: number };

  const overdue = (dueOn: string) =>
    Math.max(0, Math.round((Date.parse(today) - Date.parse(dueOn)) / 86_400_000));
  const toDto = (r: (typeof rows)[number]): ReviewCardDto => ({
    id: r.id,
    problem: { slug: r.slug, title: r.title, difficulty: r.difficulty, topics: r.topics },
    dueOn: r.due_on,
    overdueDays: overdue(r.due_on),
    intervalDays: r.interval_days,
    ease: r.ease,
    lapses: r.lapses,
    suspended: r.suspended,
  });
  const queue = buildQueue(
    rows.map((r) => ({
      id: r.id,
      dueOn: r.due_on,
      suspended: r.suspended,
      ease: r.ease,
      lapses: r.lapses,
    })),
    { today, cap, doneToday: Number(done.n) },
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i + 1);
    return {
      date,
      count: rows.filter((r) => !r.suspended && r.due_on === date).length,
    };
  });
  const qualities = (
    await db.execute(
      sql`SELECT quality FROM srs_reviews WHERE user_id = ${userId} ORDER BY reviewed_at DESC LIMIT 100`,
    )
  ).rows as Array<{ quality: number }>;

  return {
    today,
    cap,
    doneToday: Number(done.n),
    waiting: queue.waiting,
    due: queue.due.map((c) => toDto(byId.get(c.id)!)),
    upcoming,
    paused: rows.filter((r) => r.suspended).map(toDto),
    stats: {
      cards: rows.length,
      mature: rows.filter((r) => r.interval_days >= 21).length,
      lapses: rows.reduce((a, r) => a + r.lapses, 0),
      retention: retention(qualities.map((q) => Number(q.quality))),
    },
  };
}

async function ownCard(tx: Db, userId: string, id: string): Promise<Row> {
  const [card] = await tx
    .select()
    .from(srsCards)
    .where(and(eq(srsCards.id, id), eq(srsCards.userId, userId)))
    .for("update");
  if (!card) throw new AppError("NOT_FOUND", 404, "Review card not found.");
  return card;
}

export async function gradeReview(
  db: Database,
  userId: string,
  id: string,
  rating: Rating,
  now: Date,
): Promise<ReviewGradeResponse> {
  const tz = await timezoneOf(db, userId);
  const today = localDay(now, tz);
  return db.transaction(async (tx) => {
    const card = await ownCard(tx, userId, id);
    if (card.suspended) throw new AppError("SUSPENDED", 409, "This card is paused.");
    if (card.dueOn > today) throw new AppError("NOT_DUE", 409, "This review is not due yet.");
    return apply(tx, card, RATING_QUALITY[rating], today, now, "manual");
  });
}

export async function snoozeReview(
  db: Database,
  userId: string,
  id: string,
  days: number,
  now: Date,
): Promise<{ id: string; dueOn: string }> {
  const tz = await timezoneOf(db, userId);
  const today = localDay(now, tz);
  return db.transaction(async (tx) => {
    const card = await ownCard(tx, userId, id);
    const dueOn = addDays(today, days);
    const next = dueOn > card.dueOn ? dueOn : card.dueOn;
    await tx.update(srsCards).set({ dueOn: next }).where(eq(srsCards.id, id));
    return { id, dueOn: next };
  });
}

export async function suspendReview(
  db: Database,
  userId: string,
  id: string,
  suspended: boolean,
): Promise<{ id: string; suspended: boolean }> {
  return db.transaction(async (tx) => {
    await ownCard(tx, userId, id);
    await tx.update(srsCards).set({ suspended }).where(eq(srsCards.id, id));
    return { id, suspended };
  });
}
