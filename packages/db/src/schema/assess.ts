import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";
import { difficulty, publishStatus } from "./problems.js";

// SQL practice and the aptitude / online-assessment simulator (C1, C2). Doc 10 section 2.8.

/** A schema plus seed data every SQL problem on it runs against (SQLite dialect). */
export const sqlDatasets = pgTable("sql_datasets", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  schemaSql: text("schema_sql").notNull(),
  seedSql: text("seed_sql").notNull(),
  dialect: text("dialect").notNull().default("sqlite"),
  ...timestamps,
});

export const sqlProblems = pgTable(
  "sql_problems",
  {
    id: uuid("id").primaryKey(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => sqlDatasets.id),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    topic: text("topic").notNull(),
    difficulty: difficulty("difficulty").notNull(),
    statementMd: text("statement_md").notNull(),
    expectedQuery: text("expected_query").notNull(),
    orderSensitive: boolean("order_sensitive").notNull().default(false),
    hint: text("hint"),
    solutionNote: text("solution_note"),
    position: integer("position").notNull().default(0),
    status: publishStatus("status").notNull().default("published"),
    ...timestamps,
  },
  (t) => [index("sql_problems_list_idx").on(t.status, t.topic, t.difficulty)],
);

export const sqlAttempts = pgTable(
  "sql_attempts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => sqlProblems.id),
    query: text("query").notNull(),
    /** AC | WA | ERROR | TLE */
    verdict: text("verdict").notNull(),
    message: text("message"),
    rowCount: integer("row_count"),
    runMs: integer("run_ms"),
    xpAwarded: integer("xp_awarded").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("sql_attempts_user_problem_idx").on(t.userId, t.problemId, t.createdAt.desc()),
    check("sql_attempts_verdict_check", sql`${t.verdict} IN ('AC','WA','ERROR','TLE')`),
  ],
);

/** Aptitude questions for the OA simulator. Single choice or a typed number/word. */
export const aptitudeItems = pgTable(
  "aptitude_items",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    /** quant | logical | verbal | di | pseudocode */
    section: text("section").notNull(),
    topic: text("topic").notNull(),
    difficulty: smallint("difficulty").notNull().default(2),
    /** single | blank */
    type: text("type").notNull().default("single"),
    bodyMd: text("body_md").notNull(),
    options: jsonb("options").$type<Array<{ id: string; text: string }>>(),
    answer: jsonb("answer").notNull(),
    explanationMd: text("explanation_md").notNull(),
    shortcutMd: text("shortcut_md"),
    estSeconds: integer("est_seconds").notNull().default(60),
    status: publishStatus("status").notNull().default("published"),
    ...timestamps,
  },
  (t) => [
    index("aptitude_items_section_idx").on(t.section, t.topic, t.status),
    check("aptitude_items_type_check", sql`${t.type} IN ('single','blank')`),
    check("aptitude_items_difficulty_check", sql`${t.difficulty} BETWEEN 1 AND 5`),
  ],
);

/** Company-style test layouts: sections with their own clocks, negative marking, calculator. */
export const oaTemplates = pgTable("oa_templates", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  /** oa | drill */
  kind: text("kind").notNull().default("oa"),
  sections: jsonb("sections").notNull(),
  negativeMarking: numeric("negative_marking", { precision: 4, scale: 2 }).notNull().default("0"),
  calculator: boolean("calculator").notNull().default(false),
  status: publishStatus("status").notNull().default("published"),
  ...timestamps,
});

export const oaAttempts = pgTable(
  "oa_attempts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => oaTemplates.id),
    /** Sections, the items in each, answers and clocks (see analytics-core oa.ts). */
    state: jsonb("state").notNull(),
    report: jsonb("report"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    marks: numeric("marks", { precision: 6, scale: 2 }),
    maxMarks: integer("max_marks"),
    xpAwarded: integer("xp_awarded").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("oa_attempts_user_idx").on(t.userId, t.startedAt.desc()),
    index("oa_attempts_template_idx").on(t.templateId, t.finishedAt),
  ],
);
