import { createDatabase, createPool, resetDatabase } from "@prepquest/db";
import { adminDatabaseUrl, databaseName, TEST_DATABASE_URL } from "./db-url.js";

/** Creates the test database if needed and rebuilds its schema from the migrations. */
export default async function setup(): Promise<void> {
  const name = databaseName(TEST_DATABASE_URL);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unsafe test database name: ${name}`);

  const admin = createPool(adminDatabaseUrl(TEST_DATABASE_URL), 1);
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const db = createDatabase(TEST_DATABASE_URL, 1);
  try {
    await resetDatabase(db);
  } finally {
    await db.$client.end();
  }
}
