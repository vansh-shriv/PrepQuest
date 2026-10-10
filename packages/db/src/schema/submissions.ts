import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";
import { problems } from "./problems.js";

// Submissions, drafts and per-user problem state (D3, D2, U2, A5). Doc 10 §2.3-2.4 (core subset).
// Hint usage and SRS arrive with their features; bookmarks and notes are in library.ts.

export const verdict = pgEnum("verdict", [
  "QUEUED",
  "COMPILING",
  "RUNNING",
  "AC",
  "WA",
  "TLE",
  "MLE",
  "RE",
  "CE",
  "OLE",
  "IE",
]);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id),
    problemVersion: integer("problem_version").notNull(),
    language: text("language").notNull(),
    code: text("code").notNull(),
    codeHash: text("code_hash").notNull(),
    kind: text("kind").notNull(),
    mode: text("mode").notNull().default("practice"),
    contestId: uuid("contest_id"),
    interviewSessionId: uuid("interview_session_id"),
    verdict: verdict("verdict").notNull().default("QUEUED"),
    timeMs: integer("time_ms"),
    memoryKb: integer("memory_kb"),
    passed: integer("passed"),
    total: integer("total"),
    failingTestOrdinal: integer("failing_test_ordinal"),
    compileOutput: text("compile_output"),
    stderrTail: text("stderr_tail"),
    hintsUsed: smallint("hints_used").notNull().default(0),
    note: text("note"),
    activeSeconds: integer("active_seconds"), // A5 metrics
    firstRunSeconds: integer("first_run_seconds"),
    idempotencyKey: text("idempotency_key"),
    /** XP, level-up, streak and badges this submission earned (set when it finishes). */
    rewards: jsonb("rewards").$type<Record<string, unknown>>(),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("submissions_kind_check", sql`${t.kind} IN ('run','submit')`),
    check("submissions_mode_check", sql`${t.mode} IN ('practice','contest','interview','review')`),
    index("submissions_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("submissions_user_problem_idx").on(t.userId, t.problemId, t.createdAt.desc()),
    index("submissions_problem_verdict_idx").on(t.problemId, t.verdict, t.timeMs),
    index("submissions_contest_idx")
      .on(t.contestId, t.userId)
      .where(sql`${t.contestId} IS NOT NULL`),
    uniqueIndex("submissions_idempotency_idx")
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ],
);

export const submissionResults = pgTable(
  "submission_results",
  {
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    testOrdinal: integer("test_ordinal").notNull(),
    /** sample | hidden | edge | stress | custom */
    kind: text("kind"),
    /** Author's label ("edge: empty input"); shown for the first failing test only. */
    label: text("label"),
    verdict: verdict("verdict").notNull(),
    timeMs: integer("time_ms"),
    memoryKb: integer("memory_kb"),
    stdoutTail: text("stdout_tail"),
    stderrTail: text("stderr_tail"),
    checkerMsg: text("checker_msg"),
    /** Input/expected output, stored for visible tests (samples, custom runs) only. */
    inputPreview: text("input_preview"),
    expectedPreview: text("expected_preview"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.submissionId, t.testOrdinal] })],
);

export const codeDrafts = pgTable(
  "code_drafts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id),
    language: text("language").notNull(),
    code: text("code").notNull(),
    cursor: jsonb("cursor").$type<Record<string, unknown>>(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.problemId, t.language] })],
);

export const customTests = pgTable("custom_tests", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  problemId: uuid("problem_id").references(() => problems.id),
  label: text("label"),
  input: text("input").notNull(),
  ...timestamps,
});

export const problemEvents = pgTable(
  "problem_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id"),
    problemId: uuid("problem_id"),
    kind: text("kind"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [index("problem_events_user_idx").on(t.userId, t.problemId, t.at)],
);

export const userProblemState = pgTable(
  "user_problem_state",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id),
    status: text("status").notNull().default("unseen"),
    attempts: integer("attempts").notNull().default(0),
    firstAcAt: timestamp("first_ac_at", { withTimezone: true }),
    firstTryAc: boolean("first_try_ac"),
    bestTimeMs: integer("best_time_ms"),
    hintsUsed: smallint("hints_used").notNull().default(0),
    cleanSolve: boolean("clean_solve").notNull().default(false),
    totalActiveSeconds: integer("total_active_seconds").notNull().default(0),
    solveRating: text("solve_rating"), // easy | good | hard | again
    lastSubmissionAt: timestamp("last_submission_at", { withTimezone: true }),
    /** When the user first opened the problem: hint and give-up cooldowns count from here. */
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    /** When the user chose "I give up" to unlock the editorial. */
    gaveUpAt: timestamp("gave_up_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.problemId] }),
    check("user_problem_state_status_check", sql`${t.status} IN ('unseen','attempted','solved')`),
  ],
);
