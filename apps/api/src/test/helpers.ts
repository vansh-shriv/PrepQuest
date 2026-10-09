import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { sql } from "drizzle-orm";
import { createDatabase, type Database } from "@prepquest/db";
import { parseServerEnv, type LoginResponse, type ServerEnv } from "@prepquest/shared";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsObjectStore, type ObjectStore } from "@prepquest/storage";
import { buildApp } from "../app.js";
import { NoopBreachChecker, type BreachChecker } from "../lib/breach.js";
import { MemoryKv, type Kv } from "../lib/kv.js";
import { MemoryMailer } from "../lib/mailer.js";
import { loadJwtKeys } from "../modules/auth/keys.js";
import { REFRESH_COOKIE } from "../modules/auth/routes.js";
import { TEST_DATABASE_URL } from "./db-url.js";

export interface TestApp {
  app: FastifyInstance;
  mailer: MemoryMailer;
  db: Database;
  /** The underlying pg pool, for raw SQL in assertions and fixtures. */
  pool: Database["$client"];
  kv: Kv;
  store: ObjectStore;
  env: ServerEnv;
  close: () => Promise<void>;
}

export interface TestOptions {
  env?: Record<string, string>;
  breach?: BreachChecker;
  fetchFn?: typeof fetch;
  kv?: Kv;
  store?: ObjectStore;
}

export async function makeTestApp(options: TestOptions = {}): Promise<TestApp> {
  const env: ServerEnv = parseServerEnv({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: "redis://localhost:6379",
    // generous limits so unrelated tests never trip them; limit tests lower these explicitly
    RL_AUTH_PER_MIN: "1000",
    RL_LOGIN_PER_10MIN: "1000",
    RL_FORGOT_PER_HOUR: "1000",
    RL_ANON_PER_MIN: "10000",
    RL_USER_PER_MIN: "10000",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    GITHUB_CLIENT_ID: "github-id",
    GITHUB_CLIENT_SECRET: "github-secret",
    ...options.env,
  });
  const db = createDatabase(TEST_DATABASE_URL, 5);
  await db.execute(sql`TRUNCATE users CASCADE`);
  const mailer = new MemoryMailer();
  const kv = options.kv ?? new MemoryKv();
  const store = options.store ?? new FsObjectStore(await mkdtemp(join(tmpdir(), "pq-objects-")));
  const app = await buildApp({
    env,
    db,
    mailer,
    kv,
    store,
    keys: await loadJwtKeys(env),
    checks: {},
    breach: options.breach ?? new NoopBreachChecker(),
    ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
  });
  return {
    app,
    mailer,
    db,
    pool: db.$client,
    kv,
    store,
    env,
    close: async () => {
      await app.close();
      await db.$client.end();
    },
  };
}

export const SAMPLE = {
  email: "ada@example.com",
  password: "correct-horse-battery",
  handle: "ada_l",
  displayName: "Ada",
};

export function signup(t: TestApp, overrides: Partial<typeof SAMPLE> = {}) {
  return t.app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { ...SAMPLE, ...overrides },
  });
}

export function refreshCookie(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value;
}

/** Signs up, logs in, and returns tokens for further requests. */
export async function signupAndLogin(t: TestApp, overrides: Partial<typeof SAMPLE> = {}) {
  const creds = { ...SAMPLE, ...overrides };
  const created = await signup(t, overrides);
  if (created.statusCode !== 201) throw new Error(`signup failed: ${created.body}`);
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: creds.email, password: creds.password },
  });
  const body = res.json<LoginResponse>();
  return { res, body, accessToken: body.accessToken, refresh: refreshCookie(res)!, creds };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Extracts the token query param from the most recent email containing `needle` in its link. */
export function tokenFromMail(mailer: MemoryMailer, needle: string): string {
  const msg = [...mailer.outbox].reverse().find((m) => m.text.includes(needle));
  const match = msg?.text.match(/token=([\w-]+)/);
  if (!match?.[1]) throw new Error(`no email with a ${needle} link`);
  return match[1];
}

/** Marks every account verified (most tests don't care about verification). */
export async function verifyAllEmails(t: TestApp): Promise<void> {
  await t.db.execute(
    sql`UPDATE users SET email_verified_at = now() WHERE email_verified_at IS NULL`,
  );
}
