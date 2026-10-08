import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createPool } from "@prepquest/db";
import { parseServerEnv, type LoginResponse, type ServerEnv } from "@prepquest/shared";
import { buildApp } from "../app.js";
import { MemoryMailer } from "../lib/mailer.js";
import { loadJwtKeys } from "../modules/auth/keys.js";
import { REFRESH_COOKIE } from "../modules/auth/routes.js";
import { TEST_DATABASE_URL } from "./db-url.js";

export interface TestApp {
  app: FastifyInstance;
  mailer: MemoryMailer;
  pool: ReturnType<typeof createPool>;
  close: () => Promise<void>;
}

export async function makeTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const env: ServerEnv = parseServerEnv({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: "redis://localhost:6379",
    RL_AUTH_PER_MIN: "1000",
    ...overrides,
  });
  const pool = createPool(TEST_DATABASE_URL, 5);
  await pool.query("TRUNCATE users CASCADE");
  const mailer = new MemoryMailer();
  const app = await buildApp({ env, pool, mailer, keys: await loadJwtKeys(env), checks: {} });
  return {
    app,
    mailer,
    pool,
    close: async () => {
      await app.close();
      await pool.end();
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
