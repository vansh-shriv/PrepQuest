import type { Redis } from "ioredis";

/** Small expiring key-value store used for rate limits, lockouts and OAuth state. */
export interface Kv {
  /** Atomically increments a counter; the TTL starts at the first increment. Returns the new value. */
  incr(key: string, ttlSec: number): Promise<number>;
  /** Seconds until the key expires, or 0 if it doesn't exist. */
  ttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  /** Reads and deletes in one step (single-use values such as OAuth state). */
  take(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<void>;
}

const INCR_WITH_TTL = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

export class RedisKv implements Kv {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "pq:",
  ) {}

  private k(key: string) {
    return this.prefix + key;
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    return Number(await this.redis.eval(INCR_WITH_TTL, 1, this.k(key), ttlSec));
  }

  async ttl(key: string): Promise<number> {
    return Math.max(0, await this.redis.ttl(this.k(key)));
  }

  get(key: string): Promise<string | null> {
    return this.redis.get(this.k(key));
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    await this.redis.set(this.k(key), value, "EX", ttlSec);
  }

  take(key: string): Promise<string | null> {
    return this.redis.getdel(this.k(key));
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys.map((x) => this.k(x)));
  }
}

/** Per-process fallback for tests and for running without Redis. Not shared across instances. */
export class MemoryKv implements Kv {
  private readonly data = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string) {
    const entry = this.data.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const entry = this.live(key);
    const next = (entry ? Number(entry.value) : 0) + 1;
    this.data.set(key, {
      value: String(next),
      expiresAt: entry ? entry.expiresAt : this.now() + ttlSec * 1000,
    });
    return next;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    return entry ? Math.ceil((entry.expiresAt - this.now()) / 1000) : 0;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    this.data.set(key, { value, expiresAt: this.now() + ttlSec * 1000 });
  }

  async take(key: string): Promise<string | null> {
    const value = this.live(key)?.value ?? null;
    this.data.delete(key);
    return value;
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key);
  }
}
