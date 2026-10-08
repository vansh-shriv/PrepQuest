import pg from "pg";
import { Redis } from "ioredis";
import { parseServerEnv } from "@prepquest/shared";
import { buildApp } from "./app.js";

const env = parseServerEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

const app = await buildApp({
  env,
  checks: {
    postgres: async () => void (await pool.query("select 1")),
    redis: async () => {
      if (redis.status === "wait") await redis.connect();
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
