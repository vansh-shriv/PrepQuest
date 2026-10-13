import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";
import { submissions } from "./submissions.js";

// Code review mode (X3) and the complexity analyzer (X4). Doc 10 section 2.12.

export interface ReviewComment {
  /** 1-based line of the submitted code. */
  line: number;
  severity: "nit" | "suggestion" | "important";
  category:
    "readability" | "idioms" | "complexity" | "edge-cases" | "maintainability" | "presentation";
  message: string;
}

/** The AI's critique of one submission at one strictness. The refactor is shown only after the judge accepts it. */
export const codeReviews = pgTable(
  "code_reviews",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    /** gentle | strict | pedantic */
    strictness: text("strictness").notNull(),
    /** pending | ready | failed */
    status: text("status").notNull().default("pending"),
    summary: text("summary"),
    comments: jsonb("comments").$type<ReviewComment[]>().notNull().default([]),
    /** 1 to 5 per category. */
    ratings: jsonb("ratings").$type<Record<string, number>>().notNull().default({}),
    refactorCode: text("refactor_code"),
    refactorNotes: text("refactor_notes"),
    /** The judge run that checks the refactor (mode `review`). */
    refactorSubmissionId: uuid("refactor_submission_id").references(() => submissions.id, {
      onDelete: "set null",
    }),
    /** none | checking | verified | rejected */
    refactorStatus: text("refactor_status").notNull().default("none"),
    model: text("model"),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    unique("code_reviews_submission_strictness_key").on(t.submissionId, t.strictness),
    check("code_reviews_strictness_check", sql`${t.strictness} IN ('gentle','strict','pedantic')`),
    check("code_reviews_status_check", sql`${t.status} IN ('pending','ready','failed')`),
    check(
      "code_reviews_refactor_check",
      sql`${t.refactorStatus} IN ('none','checking','verified','rejected')`,
    ),
  ],
);

/** The measured growth of one submission, compared with what the learner claimed. */
export const complexityAnalyses = pgTable(
  "complexity_analyses",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    /** The judge run that measured the sizes (mode `review`). */
    runSubmissionId: uuid("run_submission_id").references(() => submissions.id, {
      onDelete: "set null",
    }),
    claimed: text("claimed").notNull(),
    /** running | ready | failed */
    status: text("status").notNull().default("running"),
    /** Samples, fits, the verdict and the static hints, filled in once the run is over. */
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    unique("complexity_analyses_submission_key").on(t.submissionId),
    check("complexity_analyses_status_check", sql`${t.status} IN ('running','ready','failed')`),
  ],
);
