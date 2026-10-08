import { Redis } from "ioredis";
import { createPool } from "@prepquest/db";
import { parseServerEnv } from "@prepquest/shared";
import { buildApp } from "./app.js";
import { SmtpMailer } from "./lib/mailer.js";
import { loadJwtKeys } from "./modules/auth/keys.js";

const env = parseServerEnv();
const pool = createPool(env.DATABASE_URL, 10);
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
await redis.connect().catch(() => undefined); // health check reports it; rate limits fall back to errors-open

const app = await buildApp({
  env,
  pool,
  redis: redis.status === "ready" ? redis : undefined,
  keys: await loadJwtKeys(env),
  mailer: new SmtpMailer(env.SMTP_URL, env.EMAIL_FROM),
  checks: {
    postgres: async () => void (await pool.query("select 1")),
    redis: async () => {
      if (redis.status === "wait" || redis.status === "end") await redis.connect();
      await redis.ping();
    },
  },
});

const shutdown = async () => {
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
