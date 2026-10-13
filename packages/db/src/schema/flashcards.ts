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
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";

// Flashcards (X6) and shared reports (U5). Doc 10 sections 2.10 and 2.11.

/** A learner's deck. Starter decks (from content/flashcards) have no owner and are copied on adoption. */
export const flashcardDecks = pgTable(
  "flashcard_decks",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** patterns | formulas | cs | behavioral | mistakes | custom */
    kind: text("kind").notNull().default("custom"),
    /** Stable id of a starter deck from content; null for a learner's own deck. */
    starterSlug: text("starter_slug").unique(),
    /** Where the deck came from: `starter:<slug>`, `import`, `mistakes` or null. */
    source: text("source"),
    ...timestamps,
  },
  (t) => [
    index("flashcard_decks_owner_idx").on(t.ownerId, t.createdAt),
    check(
      "flashcard_decks_kind_check",
      sql`${t.kind} IN ('patterns','formulas','cs','behavioral','mistakes','custom')`,
    ),
    check(
      "flashcard_decks_owner_check",
      sql`${t.ownerId} IS NOT NULL OR ${t.starterSlug} IS NOT NULL`,
    ),
  ],
);

/** One card. Its schedule lives on the row; due dates are the learner's local calendar days. */
export const flashcards = pgTable(
  "flashcards",
  {
    id: uuid("id").primaryKey(),
    deckId: uuid("deck_id")
      .notNull()
      .references(() => flashcardDecks.id, { onDelete: "cascade" }),
    /** basic | cloze | code */
    type: text("type").notNull().default("basic"),
    frontMd: text("front_md").notNull(),
    backMd: text("back_md").notNull().default(""),
    /** What the card was made from: quiz_question, note, interview_session, or null for manual cards. */
    originType: text("origin_type"),
    originId: uuid("origin_id"),
    ease: numeric("ease", { precision: 4, scale: 2 }).notNull().default("2.50"),
    intervalDays: integer("interval_days").notNull().default(0),
    repetitions: integer("repetitions").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    dueOn: date("due_on").notNull(),
    suspended: boolean("suspended").notNull().default(false),
    /** Exact time of the newest review: the merge rule for reviews made offline. */
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("flashcards_deck_due_idx").on(t.deckId, t.dueOn),
    index("flashcards_origin_idx").on(t.originType, t.originId),
    check("flashcards_type_check", sql`${t.type} IN ('basic','cloze','code')`),
  ],
);

export const flashcardReviews = pgTable(
  "flashcard_reviews",
  {
    id: uuid("id").primaryKey(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    quality: smallint("quality").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
    /** The learner's local day, which the daily limits count. */
    reviewedOn: date("reviewed_on").notNull(),
    prevInterval: integer("prev_interval").notNull().default(0),
    newInterval: integer("new_interval").notNull().default(0),
    /** True when the card had no earlier review (counts against the daily new limit). */
    wasNew: boolean("was_new").notNull().default(false),
    /** An offline review older than the card's newest one: kept as history, no schedule change. */
    stale: boolean("stale").notNull().default(false),
    /** Idempotency key: the device makes it once per answer, so a retried sync adds nothing. */
    clientId: text("client_id").notNull().unique(),
    ...timestamps,
  },
  (t) => [
    index("flashcard_reviews_user_day_idx").on(t.userId, t.reviewedOn),
    index("flashcard_reviews_card_idx").on(t.cardId, t.reviewedAt.desc()),
    check("flashcard_reviews_quality_check", sql`${t.quality} BETWEEN 0 AND 5`),
  ],
);

/**
 * A shared report link (U5). The token is random and only its hash is stored. The payload is a snapshot taken
 * when the link is made, already filtered by the privacy options, so nothing else can leak through the link.
 */
export const sharedReports = pgTable(
  "shared_reports",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** scorecard | contest | readiness */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    tokenHash: text("token_hash").notNull().unique(),
    /** unlisted (anyone with the link, not indexed) | public (anyone with the link, may be indexed) */
    visibility: text("visibility").notNull().default("unlisted"),
    options: jsonb("options").notNull(),
    payload: jsonb("payload").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    views: integer("views").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("shared_reports_owner_idx").on(t.ownerId, t.createdAt.desc()),
    check("shared_reports_type_check", sql`${t.entityType} IN ('scorecard','contest','readiness')`),
    check("shared_reports_visibility_check", sql`${t.visibility} IN ('unlisted','public')`),
  ],
);
