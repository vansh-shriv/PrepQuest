import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";

// Peer mock interviews (X1). Doc 10 section 2.11.

export interface PeerOfferPrefs {
  topics: string[];
  difficulty: number;
  language: string | null;
}

/** A stretch of time a learner is free to be matched in. Matching trims or removes it. */
export const peerAvailability = pgTable(
  "peer_availability",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    prefs: jsonb("prefs").$type<PeerOfferPrefs>().notNull(),
    ...timestamps,
  },
  (t) => [
    index("peer_availability_user_idx").on(t.userId, t.startsAt),
    index("peer_availability_window_idx").on(t.startsAt, t.endsAt),
    check("peer_availability_order_check", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export interface PeerQuestionRef {
  /** problem | bank */
  kind: "problem" | "bank";
  slug: string;
}

export const peerSessions = pgTable(
  "peer_sessions",
  {
    id: uuid("id").primaryKey(),
    aUser: uuid("a_user")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bUser: uuid("b_user")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    minutes: smallint("minutes").notNull(),
    topic: text("topic").notNull(),
    difficulty: smallint("difficulty").notNull(),
    /** match | invite */
    source: text("source").notNull(),
    /** scheduled | live | completed | cancelled | no_show */
    state: text("state").notNull().default("scheduled"),
    /** a | b: who is the candidate in the first half. */
    firstCandidate: text("first_candidate").notNull(),
    /** One question per half. */
    questions: jsonb("questions").$type<PeerQuestionRef[]>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** When each person opened the room: a partner who never did is the no-show. */
    aJoinedAt: timestamp("a_joined_at", { withTimezone: true }),
    bJoinedAt: timestamp("b_joined_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    noShowUser: uuid("no_show_user").references(() => users.id, { onDelete: "set null" }),
    /** Each person's own consent to an AI summary; both are needed for any analysis. */
    aConsentAi: boolean("a_consent_ai").notNull().default(false),
    bConsentAi: boolean("b_consent_ai").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("peer_sessions_a_idx").on(t.aUser, t.scheduledAt),
    index("peer_sessions_b_idx").on(t.bUser, t.scheduledAt),
    check("peer_sessions_distinct_check", sql`${t.aUser} <> ${t.bUser}`),
    check("peer_sessions_source_check", sql`${t.source} IN ('match','invite')`),
    check(
      "peer_sessions_state_check",
      sql`${t.state} IN ('scheduled','live','completed','cancelled','no_show')`,
    ),
    check("peer_sessions_first_check", sql`${t.firstCandidate} IN ('a','b')`),
  ],
);

/** A link a learner gives to a friend: the first person to accept it becomes the partner. */
export const peerInvites = pgTable(
  "peer_invites",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the random token; the token is shown once. */
    tokenHash: text("token_hash").notNull().unique(),
    topic: text("topic").notNull(),
    difficulty: smallint("difficulty").notNull(),
    minutes: smallint("minutes").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    sessionId: uuid("session_id").references(() => peerSessions.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("peer_invites_owner_idx").on(t.ownerId)],
);

export const peerFeedback = pgTable(
  "peer_feedback",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => peerSessions.id, { onDelete: "cascade" }),
    fromUser: uuid("from_user")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUser: uuid("to_user")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** punctuality, helpfulness, preparedness: 1 to 5. */
    ratings: jsonb("ratings").$type<Record<string, number>>().notNull(),
    comments: text("comments").notNull(),
    /** Nudges that were shown (kept so the coaching can be measured, never shown to the partner). */
    nudges: integer("nudges").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("peer_feedback_session_from_key").on(t.sessionId, t.fromUser),
    index("peer_feedback_to_idx").on(t.toUser),
  ],
);

export const peerBlocks = pgTable(
  "peer_blocks",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    unique("peer_blocks_pair_key").on(t.userId, t.blockedUserId),
    check("peer_blocks_distinct_check", sql`${t.userId} <> ${t.blockedUserId}`),
  ],
);

export const peerReports = pgTable(
  "peer_reports",
  {
    id: uuid("id").primaryKey(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportedId: uuid("reported_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => peerSessions.id, { onDelete: "set null" }),
    /** abuse | harassment | cheating | no_show | other */
    reason: text("reason").notNull(),
    details: text("details").notNull().default(""),
    /** open | reviewed */
    status: text("status").notNull().default("open"),
    ...timestamps,
  },
  (t) => [
    index("peer_reports_reported_idx").on(t.reportedId),
    check(
      "peer_reports_reason_check",
      sql`${t.reason} IN ('abuse','harassment','cheating','no_show','other')`,
    ),
    check("peer_reports_status_check", sql`${t.status} IN ('open','reviewed')`),
  ],
);
