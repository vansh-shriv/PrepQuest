import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";
import { problems } from "./problems.js";

// Hints used, XP, badges and daily activity (D4, A1, G2). Doc 10 §2.4 and §2.9.

/** One row per hint tier a user has viewed on a problem. */
export const hintUsage = pgTable(
  "hint_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id),
    tier: smallint("tier").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
    mode: text("mode").notNull().default("practice"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.problemId, t.tier] }),
    check("hint_usage_tier_check", sql`${t.tier} BETWEEN 1 AND 3`),
  ],
);

/** Append-only XP ledger; `profiles.xp` is the running total. */
export const xpEvents = pgTable(
  "xp_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(), // problem_ac | streak_milestone
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index("xp_events_user_idx").on(t.userId, t.at.desc())],
);

export const badges = pgTable("badges", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  sprite: text("sprite").notNull(),
  rule: jsonb("rule").$type<Record<string, unknown>>(),
  ...timestamps,
});

export const badgesEarned = pgTable(
  "badges_earned",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badgeId: text("badge_id")
      .notNull()
      .references(() => badges.id),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeId] })],
);

/** Per local day (in the user's time zone) activity counts: the heatmap and the streak source. */
export const activityDays = pgTable(
  "activity_days",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    problems: integer("problems").notNull().default(0),
    quizzes: integer("quizzes").notNull().default(0),
    interviews: integer("interviews").notNull().default(0),
    minutes: integer("minutes").notNull().default(0),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);
