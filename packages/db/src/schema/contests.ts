import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";
import { problems } from "./problems.js";

// Timed contests (D7). Doc 10 section 2.5. Standings are computed from `submissions` (mode contest), so the
// leaderboard is permanent without a separate table.

export const contests = pgTable(
  "contests",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    /** weekly | oa | private */
    kind: text("kind").notNull().default("weekly"),
    /** icpc | points */
    scoring: text("scoring").notNull().default("icpc"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** The last N minutes the public standings are frozen (0 = never). */
    freezeMinutes: integer("freeze_minutes").notNull().default(0),
    /** public | private (private contests need the invite code to be seen or joined) */
    visibility: text("visibility").notNull().default("public"),
    inviteCode: text("invite_code"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    cancelled: boolean("cancelled").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("contests_start_idx").on(t.startsAt),
    check("contests_kind_check", sql`${t.kind} IN ('weekly','oa','private')`),
    check("contests_scoring_check", sql`${t.scoring} IN ('icpc','points')`),
    check("contests_visibility_check", sql`${t.visibility} IN ('public','private')`),
    check("contests_window_check", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const contestProblems = pgTable(
  "contest_problems",
  {
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id),
    label: text("label").notNull(),
    points: integer("points").notNull().default(100),
    ordinal: integer("ordinal").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.contestId, t.problemId] })],
);

/**
 * One row per participation. A live participation runs inside the contest window; a virtual one replays a
 * finished contest on the participant's own clock (`startedAt` to `endsAt`).
 */
export const contestParticipants = pgTable(
  "contest_participants",
  {
    id: uuid("id").primaryKey(),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** live | virtual */
    kind: text("kind").notNull().default("live"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    /** Start of this participant's clock (the contest start for live participants). */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Focus-loss and paste counts, for the integrity review (X2). */
    integrity: jsonb("integrity")
      .$type<{ blur: number; paste: number }>()
      .notNull()
      .default({ blur: 0, paste: 0 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("contest_participants_live_key")
      .on(t.contestId, t.userId)
      .where(sql`${t.kind} = 'live'`),
    index("contest_participants_user_idx").on(t.userId, t.joinedAt.desc()),
    check("contest_participants_kind_check", sql`${t.kind} IN ('live','virtual')`),
  ],
);
