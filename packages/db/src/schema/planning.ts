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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";

// Study plans, daily goals, readiness snapshots and the diagnostic (A4, P1, P2). Doc 10 §2.9.

/** One row per generated plan version; only one plan per user is active. */
export const studyPlans = pgTable(
  "study_plans",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Pack slug the plan aims at, or "general". */
    targetKey: text("target_key").notNull().default("general"),
    placementDate: date("placement_date"),
    inputs: jsonb("inputs").notNull(),
    phases: jsonb("phases").notNull().default([]),
    warnings: jsonb("warnings").notNull().default([]),
    version: integer("version").notNull().default(1),
    active: boolean("active").notNull().default(true),
    narrativeMd: text("narrative_md"),
    /** The user's local day of the last (re)plan: the nightly job runs once per local day. */
    replannedOn: date("replanned_on"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("study_plans_one_active_idx")
      .on(t.userId)
      .where(sql`${t.active}`),
    index("study_plans_user_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const planTasks = pgTable(
  "plan_tasks",
  {
    id: uuid("id").primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => studyPlans.id, { onDelete: "cascade" }),
    /** Stable identity across re-plans, e.g. `problem:two-sum`. */
    key: text("key").notNull(),
    plannedDate: date("planned_date").notNull(),
    /** problem | mock | review | quiz | aptitude | reading | flashcards */
    kind: text("kind").notNull(),
    refType: text("ref_type"),
    ref: text("ref"),
    title: text("title").notNull(),
    estMinutes: smallint("est_minutes").notNull(),
    /** todo | done | skipped | moved */
    status: text("status").notNull().default("todo"),
    locked: boolean("locked").notNull().default(false),
    /** Added by the user rather than generated. */
    custom: boolean("custom").notNull().default(false),
    why: text("why").notNull().default(""),
    phase: text("phase").notNull().default("pattern_mastery"),
    topic: text("topic"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("plan_tasks_plan_date_idx").on(t.planId, t.plannedDate),
    unique("plan_tasks_plan_key_unique").on(t.planId, t.key),
    check("plan_tasks_status_check", sql`${t.status} IN ('todo','done','skipped','moved')`),
  ],
);

export const planDiffs = pgTable(
  "plan_diffs",
  {
    id: uuid("id").primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => studyPlans.id, { onDelete: "cascade" }),
    fromVersion: integer("from_version").notNull(),
    toVersion: integer("to_version").notNull(),
    /** manual | nightly | generate | edit */
    reason: text("reason").notNull(),
    diff: jsonb("diff").notNull(),
    ...timestamps,
  },
  (t) => [index("plan_diffs_plan_idx").on(t.planId, t.toVersion.desc())],
);

export const goalTemplates = pgTable("goal_templates", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  preset: text("preset").notNull().default("standard"),
  items: jsonb("items").notNull(),
  ...timestamps,
});

export const dailyGoals = pgTable(
  "daily_goals",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalDate: date("goal_date").notNull(),
    items: jsonb("items").notNull(),
    completed: boolean("completed").notNull().default(false),
    /** The completion bonus was paid. */
    rewarded: boolean("rewarded").notNull().default(false),
    ...timestamps,
  },
  (t) => [unique("daily_goals_user_date_unique").on(t.userId, t.goalDate)],
);

export const readinessSnapshots = pgTable(
  "readiness_snapshots",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetKey: text("target_key").notNull(),
    snapDate: date("snap_date").notNull(),
    /** Null when there was too little data to score. */
    score: numeric("score", { precision: 5, scale: 2 }),
    band: numeric("band", { precision: 4, scale: 2 }),
    components: jsonb("components").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.targetKey, t.snapDate] })],
);

/** The calibration test: a short set of problems across topics; its results are ordinary submissions. */
export const diagnostics = pgTable(
  "diagnostics",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemSlugs: jsonb("problem_slugs").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("diagnostics_user_idx").on(t.userId, t.startedAt.desc())],
);
