import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;

/** Top-level database handle. `db.$client` is the underlying pg Pool (used to close it). */
export type Database = ReturnType<typeof createDatabase>;

/** Anything queries can run on: the database itself or a transaction. Repositories take this. */
export type Db = PgDatabase<NodePgQueryResultHKT, Schema>;

export function createDatabase(connectionString: string, max = 10) {
  const pool = new pg.Pool({ connectionString, max });
  return drizzle({ client: pool, schema });
}

/** Plain pool for administrative work that must not go through the ORM (e.g. CREATE DATABASE). */
export function createPool(connectionString: string, max = 2): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

/** Runs `fn` in a transaction; commits on success and rolls back if it throws. */
export function withTransaction<T>(db: Database, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx));
}
