import { AppError } from "@prepquest/shared";
import type { Kv } from "./kv.js";

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets (meaningful when blocked). */
  retryAfterSec: number;
}

/**
 * Fixed-window counters for limits that must be keyed by something other than IP
 * (email, user id, ...). IP-level limiting is handled by @fastify/rate-limit.
 * If the store is unavailable the limiter fails open and reports it through `onError`,
 * so a Redis outage degrades protection instead of taking logins down.
 */
export class RateLimiter {
  constructor(
    private readonly kv: Kv,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {}

  async hit(key: string, max: number, windowSec: number): Promise<LimitResult> {
    try {
      const count = await this.kv.incr(`rl:${key}`, windowSec);
      if (count <= max) return { allowed: true, remaining: max - count, retryAfterSec: 0 };
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, await this.kv.ttl(`rl:${key}`)),
      };
    } catch (err) {
      this.onError(err);
      return { allowed: true, remaining: max, retryAfterSec: 0 };
    }
  }

  /** Counts one attempt and throws 429 RATE_LIMITED when over the limit. */
  async enforce(key: string, max: number, windowSec: number, what = "requests"): Promise<void> {
    const res = await this.hit(key, max, windowSec);
    if (!res.allowed) throw rateLimited(res.retryAfterSec, `Too many ${what}`);
  }
}

export function rateLimited(retryAfterSec: number, prefix = "Too many requests"): AppError {
  return new AppError(
    "RATE_LIMITED",
    429,
    `${prefix}. Try again in ${formatWait(retryAfterSec)}.`,
    {
      retryAfterSeconds: retryAfterSec,
    },
  );
}

export function formatWait(sec: number): string {
  if (sec < 90) return `${sec}s`;
  const min = Math.ceil(sec / 60);
  return min < 90 ? `${min} min` : `${Math.ceil(min / 60)} h`;
}

// ---- login lockout (exponential delay) ----

const FAIL_WINDOW_SEC = 15 * 60;
const FREE_ATTEMPTS = 5;
const BASE_LOCK_SEC = 30;
const MAX_LOCK_SEC = 15 * 60;

/** Lock duration after the n-th consecutive failure: 0 for the first 5, then 30s, 60s, 120s ... capped at 15 min. */
export function lockSeconds(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  return Math.min(BASE_LOCK_SEC * 2 ** (failures - FREE_ATTEMPTS - 1), MAX_LOCK_SEC);
}

/**
 * Per-account brute-force protection. Keyed by the submitted email whether or not the account
 * exists, so lockouts reveal nothing about which emails are registered. Trade-off: someone can
 * deliberately lock a victim out for up to 15 minutes; IP limits and the cap keep that bounded.
 */
export class LoginLockout {
  constructor(
    private readonly kv: Kv,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {}

  /** Throws 429 ACCOUNT_LOCKED while the account is in a lockout period. */
  async assertNotLocked(email: string): Promise<void> {
    try {
      const wait = await this.kv.ttl(`lock:${email}`);
      if (wait > 0) {
        throw new AppError(
          "ACCOUNT_LOCKED",
          429,
          `Too many failed attempts. Try again in ${formatWait(wait)}.`,
          { retryAfterSeconds: wait },
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.onError(err);
    }
  }

  async recordFailure(email: string): Promise<void> {
    try {
      const failures = await this.kv.incr(`fail:${email}`, FAIL_WINDOW_SEC);
      const lock = lockSeconds(failures);
      if (lock > 0) await this.kv.set(`lock:${email}`, "1", lock);
    } catch (err) {
      this.onError(err);
    }
  }

  async recordSuccess(email: string): Promise<void> {
    try {
      await this.kv.del(`fail:${email}`, `lock:${email}`);
    } catch (err) {
      this.onError(err);
    }
  }
}

// ---- failure-only attempt budget ----

/**
 * Caps wrong guesses (second-factor codes) without punishing successes: `assert` checks the budget,
 * `fail` spends one attempt, `clear` resets it after a success. Fails open if the store is down.
 */
export class AttemptGuard {
  constructor(
    private readonly kv: Kv,
    private readonly max: number,
    private readonly windowSec: number,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {}

  async assert(key: string): Promise<void> {
    try {
      const used = Number((await this.kv.get(`att:${key}`)) ?? 0);
      if (used >= this.max) {
        throw rateLimited(Math.max(1, await this.kv.ttl(`att:${key}`)), "Too many wrong codes");
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.onError(err);
    }
  }

  async fail(key: string): Promise<void> {
    try {
      await this.kv.incr(`att:${key}`, this.windowSec);
    } catch (err) {
      this.onError(err);
    }
  }

  async clear(key: string): Promise<void> {
    try {
      await this.kv.del(`att:${key}`);
    } catch (err) {
      this.onError(err);
    }
  }
}
