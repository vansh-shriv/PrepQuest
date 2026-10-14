import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { contests } from "./contests.js";
import { users } from "./identity.js";

// Integrity flags (X2). A flag is evidence for a human reviewer; nothing here penalises anyone by itself.

export interface IntegrityMatch {
  problemSlug: string;
  submissionId: string;
  otherSubmissionId: string;
  otherUserId: string;
  /** 0 to 1: share of the smaller program found in the other. */
  similarity: number;
  /** Token ranges of this learner's code that matched. */
  ranges: Array<{ from: number; to: number }>;
}

export interface IntegrityEvidence {
  matches?: IntegrityMatch[];
  /** Paste and focus-loss counts over the contest. */
  counts?: { paste: number; blur: number };
  /** Weak markers shown next to stronger evidence only. */
  aiStyle?: { submissionId: string; comments: number }[];
  /** Other signals that raised the severity. */
  aggravating?: string[];
}

export const integrityFlags = pgTable(
  "integrity_flags",
  {
    id: uuid("id").primaryKey(),
    /** contest_participant */
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contestId: uuid("contest_id").references(() => contests.id, { onDelete: "cascade" }),
    /** similarity | paste | focus */
    kind: text("kind").notNull(),
    /** low | medium | high */
    severity: text("severity").notNull(),
    score: numeric("score", { precision: 5, scale: 4 }),
    evidence: jsonb("evidence").$type<IntegrityEvidence>().notNull(),
    /** open | confirmed | dismissed | escalated | appealed */
    status: text("status").notNull().default("open"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    appealText: text("appeal_text"),
    appealedAt: timestamp("appealed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("integrity_flags_subject_kind_key").on(t.subjectType, t.subjectId, t.kind),
    index("integrity_flags_status_idx").on(t.status, t.createdAt),
    index("integrity_flags_user_idx").on(t.userId),
    check("integrity_flags_kind_check", sql`${t.kind} IN ('similarity','paste','focus')`),
    check("integrity_flags_severity_check", sql`${t.severity} IN ('low','medium','high')`),
    check(
      "integrity_flags_status_check",
      sql`${t.status} IN ('open','confirmed','dismissed','escalated','appealed')`,
    ),
  ],
);
