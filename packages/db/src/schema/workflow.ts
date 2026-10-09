import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { inet, timestamps } from "./columns.js";
import { users } from "./identity.js";
import { problems } from "./problems.js";

/** Last few autosaved snapshots per user/problem/language, for "restore a previous draft" (D2). */
export const draftHistory = pgTable(
  "draft_history",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id),
    language: text("language").notNull(),
    code: text("code").notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("draft_history_lookup_idx").on(t.userId, t.problemId, t.language, t.savedAt.desc()),
  ],
);

/** Every admin write: who, what, on which entity, before/after, from where (doc 17 §8). */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey(),
    /** Kept when the actor's account is later deleted (the log must outlive it). */
    actorId: uuid("actor_id"),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    reason: text("reason"),
    ip: inet("ip"),
    ...timestamps,
  },
  (t) => [
    index("admin_audit_entity_idx").on(t.entityType, t.entityId, t.createdAt.desc()),
    index("admin_audit_actor_idx").on(t.actorId, t.createdAt.desc()),
  ],
);
