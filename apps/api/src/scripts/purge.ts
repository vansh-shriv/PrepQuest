import { createDatabase } from "@prepquest/db";
import { parseServerEnv } from "@prepquest/shared";
import { purgeDueAccounts } from "../modules/me/service.js";

/** Hard-deletes accounts past their 14-day deletion grace period. Run daily (cron/scheduler). */
const env = parseServerEnv();
const db = createDatabase(env.DATABASE_URL, 2);
try {
  const count = await purgeDueAccounts(db);
  console.log(`Purged ${count} account(s).`);
} finally {
  await db.$client.end();
}
