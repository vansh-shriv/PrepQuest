import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";
import { companyPacks } from "./interviews.js";
import { problems, publishStatus } from "./problems.js";

// Spaced repetition, quizzes, roadmaps and company tracks (D6, C1, P3, P4). Doc 10 sections 2.4, 2.8, 2.9.

/** One review card per user and solved problem. Due dates are the learner's local calendar days. */
export const srsCards = pgTable(
  "srs_cards",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id),
    ease: numeric("ease", { precision: 4, scale: 2 }).notNull().default("2.50"),
    intervalDays: integer("interval_days").notNull().default(0),
    repetitions: integer("repetitions").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    /** Local day (in the user's time zone) the card is next due. */
    dueOn: date("due_on").notNull(),
    /** Paused or "never show again". */
    suspended: boolean("suspended").notNull().default(false),
    lastReviewedOn: date("last_reviewed_on"),
    ...timestamps,
  },
  (t) => [
    unique("srs_cards_user_problem_key").on(t.userId, t.problemId),
    index("srs_cards_due_idx")
      .on(t.userId, t.dueOn)
      .where(sql`${t.suspended} = false`),
  ],
);

export const srsReviews = pgTable(
  "srs_reviews",
  {
    id: uuid("id").primaryKey(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => srsCards.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    quality: smallint("quality").notNull(),
    /** auto: derived from an accepted solve. manual: the learner graded it. */
    source: text("source").notNull().default("manual"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    /** The learner's local day, which the daily cap counts. */
    reviewedOn: date("reviewed_on").notNull(),
    prevInterval: integer("prev_interval").notNull().default(0),
    newInterval: integer("new_interval").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("srs_reviews_user_day_idx").on(t.userId, t.reviewedOn),
    index("srs_reviews_card_idx").on(t.cardId, t.reviewedAt.desc()),
    check("srs_reviews_quality_check", sql`${t.quality} BETWEEN 0 AND 5`),
    check("srs_reviews_source_check", sql`${t.source} IN ('auto','manual')`),
  ],
);

/** Quiz questions (C1). `slug` is the stable id from content/quizzes. Answers never leave the server in timed mode. */
export const quizQuestions = pgTable(
  "quiz_questions",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    subject: text("subject").notNull(),
    topic: text("topic").notNull(),
    difficulty: smallint("difficulty").notNull().default(2),
    /** single | multi | tf | blank | output */
    type: text("type").notNull(),
    bodyMd: text("body_md").notNull(),
    options: jsonb("options").$type<Array<{ id: string; text: string }>>(),
    answer: jsonb("answer").notNull(),
    explanationMd: text("explanation_md").notNull(),
    interviewLine: text("interview_line"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: publishStatus("status").notNull().default("published"),
    ...timestamps,
  },
  (t) => [
    index("quiz_questions_subject_idx").on(t.subject, t.topic, t.status),
    check("quiz_questions_type_check", sql`${t.type} IN ('single','multi','tf','blank','output')`),
    check("quiz_questions_difficulty_check", sql`${t.difficulty} BETWEEN 1 AND 5`),
  ],
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** practice | timed | drill | weak */
    mode: text("mode").notNull(),
    subject: text("subject"),
    topic: text("topic"),
    /** The questions asked, in order. */
    questionIds: jsonb("question_ids").$type<string[]>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** Timed tests end here whether or not the browser is open. */
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    correct: integer("correct"),
    total: integer("total").notNull(),
    xpAwarded: integer("xp_awarded").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("quiz_attempts_user_idx").on(t.userId, t.startedAt.desc()),
    check("quiz_attempts_mode_check", sql`${t.mode} IN ('practice','timed','drill','weak')`),
  ],
);

export const quizAttemptAnswers = pgTable(
  "quiz_attempt_answers",
  {
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => quizQuestions.id),
    response: jsonb("response"),
    correct: boolean("correct").notNull(),
    timeMs: integer("time_ms"),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.attemptId, t.questionId] }),
    index("quiz_answers_question_idx").on(t.questionId),
  ],
);

/** Roadmap graphs (P3). The graph lives in `data` (nodes with prerequisites), validated as a DAG on import. */
export const roadmaps = pgTable(
  "roadmaps",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    track: text("track").notNull().default("sde"),
    description: text("description"),
    version: integer("version").notNull().default(1),
    data: jsonb("data").notNull(),
    status: publishStatus("status").notNull().default("published"),
    ...timestamps,
  },
  (t) => [index("roadmaps_status_idx").on(t.status, t.track)],
);

/** Company tracks a learner started (P4). */
export const userTracks = pgTable(
  "user_tracks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packId: uuid("pack_id")
      .notNull()
      .references(() => companyPacks.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.packId] })],
);
