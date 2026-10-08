import { customType, timestamp } from "drizzle-orm/pg-core";

/** Case-insensitive text (extension `citext`): emails and handles. */
export const citext = customType<{ data: string }>({ dataType: () => "citext" });

/** Full-text search vector, maintained by a trigger. */
export const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const inet = customType<{ data: string }>({ dataType: () => "inet" });

/** created_at / updated_at on every table (updated_at is maintained by a DB trigger). */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};
