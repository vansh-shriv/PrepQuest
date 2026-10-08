import { describe, expect, it } from "vitest";
import { MemoryKv } from "./kv.js";
import { formatWait, LoginLockout, lockSeconds, RateLimiter } from "./limiter.js";

describe("RateLimiter", () => {
  it("allows up to max, then blocks with a retry time, and resets after the window", async () => {
    let now = 0;
    const limiter = new RateLimiter(new MemoryKv(() => now));
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit("k", 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[0]?.remaining).toBe(2);
    expect(results[3]?.retryAfterSec).toBeGreaterThan(0);

    now += 61_000;
    expect((await limiter.hit("k", 3, 60)).allowed).toBe(true);
  });

  it("keeps separate counters per key", async () => {
    const limiter = new RateLimiter(new MemoryKv());
    await limiter.hit("a", 1, 60);
    expect((await limiter.hit("a", 1, 60)).allowed).toBe(false);
    expect((await limiter.hit("b", 1, 60)).allowed).toBe(true);
  });

  it("enforce throws a 429 AppError", async () => {
    const limiter = new RateLimiter(new MemoryKv());
    await limiter.enforce("x", 1, 60);
    await expect(limiter.enforce("x", 1, 60, "emails")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      httpStatus: 429,
    });
  });

  it("fails open and reports when the store is down", async () => {
    const broken = new MemoryKv();
    broken.incr = async () => {
      throw new Error("redis down");
    };
    const errors: unknown[] = [];
    const limiter = new RateLimiter(broken, (e) => errors.push(e));
    expect((await limiter.hit("k", 1, 60)).allowed).toBe(true);
    expect(errors).toHaveLength(1);
  });
});

describe("login lockout", () => {
  it("has no delay for the first 5 failures, then doubles up to a 15 minute cap", () => {
    expect([1, 5].map(lockSeconds)).toEqual([0, 0]);
    expect([6, 7, 8, 9].map(lockSeconds)).toEqual([30, 60, 120, 240]);
    expect(lockSeconds(20)).toBe(900);
  });

  it("locks after repeated failures and a success clears it", async () => {
    let now = 0;
    const lockout = new LoginLockout(new MemoryKv(() => now));
    for (let i = 0; i < 5; i++) await lockout.recordFailure("a@x.com");
    await expect(lockout.assertNotLocked("a@x.com")).resolves.toBeUndefined();

    await lockout.recordFailure("a@x.com"); // 6th
    await expect(lockout.assertNotLocked("a@x.com")).rejects.toMatchObject({
      code: "ACCOUNT_LOCKED",
      httpStatus: 429,
    });
    // other accounts are unaffected
    await expect(lockout.assertNotLocked("b@x.com")).resolves.toBeUndefined();

    now += 31_000; // the 30 s lock has passed
    await expect(lockout.assertNotLocked("a@x.com")).resolves.toBeUndefined();

    await lockout.recordFailure("a@x.com"); // 7th: 60 s
    await lockout.recordSuccess("a@x.com");
    await expect(lockout.assertNotLocked("a@x.com")).resolves.toBeUndefined();
  });
});

describe("formatWait", () => {
  it("is human friendly", () => {
    expect(formatWait(30)).toBe("30s");
    expect(formatWait(120)).toBe("2 min");
    expect(formatWait(7200)).toBe("2 h");
  });
});
