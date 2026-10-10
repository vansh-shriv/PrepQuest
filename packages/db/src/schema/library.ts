import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";
import { problems } from "./problems.js";

// Personal library (U3): bookmarks and notes. Doc 10 §2.4.

export const bookmarks = pgTable(
  "bookmarks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id),
    folder: text("folder").notNull().default("default"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.problemId] })],
);

/** Markdown notes. `version` is bumped on every save; saves carry the version they were based on. */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(), // problem | interview_moment | quiz_question | general
    entityId: uuid("entity_id"),
    bodyMd: text("body_md").notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    check(
      "notes_entity_type_check",
      sql`${t.entityType} IN ('problem','interview_moment','quiz_question','general')`,
    ),
    uniqueIndex("notes_user_entity_idx")
      .on(t.userId, t.entityType, t.entityId)
      .where(sql`${t.entityId} IS NOT NULL`),
    index("notes_user_updated_idx").on(t.userId, t.updatedAt.desc()),
  ],
);
