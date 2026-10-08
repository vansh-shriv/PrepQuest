import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisKv } from "./kv.js";
import { LoginLockout, RateLimiter } from "./limiter.js";

// Runs against a real Redis when one is reachable (docker compose up -d redis); skipped otherwise.
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
let redis: Redis;
let up = false;

beforeAll(async () => {
  redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    up = (await redis.ping()) === "PONG";
  } catch {
    up = false;
  }
});

afterAll(async () => {
  if (up) {
    const keys = await redis.keys("pq-test:*");
    if (keys.length) await redis.del(...keys);
  }
  redis.disconnect();
});

describe("RedisKv", () => {
  const key = () => `${Math.random().toString(36).slice(2)}`;

  it("increments atomically and expires", async (ctx) => {
    if (!up) return ctx.skip();
    const kv = new RedisKv(redis, "pq-test:");
    const k = key();
    expect(await kv.incr(k, 1)).toBe(1);
    expect(await kv.incr(k, 1)).toBe(2);
    expect(await kv.ttl(k)).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await kv.get(k)).toBeNull();
    expect(await kv.incr(k, 60)).toBe(1); // window restarted
  });

  it("take() is single-use and del() clears", async (ctx) => {
    if (!up) return ctx.skip();
    const kv = new RedisKv(redis, "pq-test:");
    const k = key();
    await kv.set(k, "v", 30);
    expect(await kv.take(k)).toBe("v");
    expect(await kv.take(k)).toBeNull();
    await kv.set(k, "v", 30);
    await kv.del(k);
    expect(await kv.get(k)).toBeNull();
  });

  it("backs the limiter and lockout end to end", async (ctx) => {
    if (!up) return ctx.skip();
    const kv = new RedisKv(redis, "pq-test:");
    const id = key();
    const limiter = new RateLimiter(kv);
    const results = [];
    for (let i = 0; i < 3; i++) results.push((await limiter.hit(`${id}:b`, 2, 30)).allowed);
    expect(results).toEqual([true, true, false]);

    const lockout = new LoginLockout(kv);
    for (let i = 0; i < 6; i++) await lockout.recordFailure(`${id}@x.com`);
    await expect(lockout.assertNotLocked(`${id}@x.com`)).rejects.toMatchObject({
      code: "ACCOUNT_LOCKED",
    });
    await lockout.recordSuccess(`${id}@x.com`);
    await expect(lockout.assertNotLocked(`${id}@x.com`)).resolves.toBeUndefined();
  });
});
