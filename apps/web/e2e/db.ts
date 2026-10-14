import pg from "pg";

/**
 * Direct database access for the few things a browser cannot do, such as moving a session's start time
 * to now (the server clock cannot be changed from outside). Same default as `.env.example`.
 */
const url =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://prepquest:prepquest@localhost:5433/prepquest";

export async function sql(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}
