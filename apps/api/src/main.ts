import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createDatabase } from "@prepquest/db";
import { parseServerEnv } from "@prepquest/shared";
import { createObjectStore } from "@prepquest/storage";
import { buildApp } from "./app.js";
import { SmtpMailer } from "./lib/mailer.js";
import { loadJwtKeys } from "./modules/auth/keys.js";
import { ResultIngester } from "./modules/submissions/ingest.js";
import { BullJudgeQueue, UnavailableJudgeQueue } from "./modules/submissions/queue.js";

const env = parseServerEnv();
const db = createDatabase(env.DATABASE_URL, 10);
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
// If Redis is unreachable at boot, limits fall back to per-process memory; /health/ready reports it.
await redis.connect().catch(() => undefined);

const redisUp = redis.status === "ready";
const judge = redisUp ? new BullJudgeQueue(env.REDIS_URL) : new UnavailableJudgeQueue();

const app = await buildApp({
  env,
  db,
  redis: redis.status === "ready" ? redis : undefined,
  keys: await loadJwtKeys(env),
  mailer: new SmtpMailer(env.SMTP_URL, env.EMAIL_FROM),
  store: createObjectStore(env),
  judge,
  checks: {
    postgres: async () => void (await db.execute(sql`select 1`)),
    redis: async () => {
      if (redis.status === "wait" || redis.status === "end") await redis.connect();
      await redis.ping();
    },
  },
});

// The trusted half of the judge protocol: results from the workers are written to the database here.
const ingester = redisUp
  ? new ResultIngester({
      redis,
      db,
      log: (msg, extra) => app.log.info({ ...extra }, `ingester: ${msg}`),
    })
  : null;
await ingester?.start();

const shutdown = async () => {
  await ingester?.stop();
  await judge.close();
  await app.close();
  await db.$client.end();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
