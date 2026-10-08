import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { BreachChecker } from "../../lib/breach.js";
import {
  bearer,
  makeTestApp,
  SAMPLE,
  signup,
  signupAndLogin,
  tokenFromMail,
  type TestApp,
} from "../../test/helpers.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const post = (app: TestApp, url: string, payload: unknown, extra: object = {}) =>
  app.app.inject({ method: "POST", url, payload: payload as object, ...extra });

const login = (app: TestApp, email: string, password: string) =>
  post(app, "/v1/auth/login", { email, password });

/** Reports one specific password as breached. */
const breachedList = (...bad: string[]): BreachChecker => ({
  isBreached: async (password) => bad.includes(password),
});

describe("breached passwords", () => {
  it("rejects a breached password at signup and on reset, but allows others", async () => {
    t = await makeTestApp({ breach: breachedList("hunter2hunter2") });

    const bad = await signup(t, { password: "hunter2hunter2" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.details.fields.password).toMatch(/data breaches/);

    expect((await signup(t)).statusCode).toBe(201);
    await post(t, "/v1/auth/forgot-password", { email: SAMPLE.email });
    const token = tokenFromMail(t.mailer, "reset-password");
    const reset = await post(t, "/v1/auth/reset-password", { token, password: "hunter2hunter2" });
    expect(reset.statusCode).toBe(422);
    // a rejected reset must not burn the link
    const ok = await post(t, "/v1/auth/reset-password", { token, password: "a-fresh-passphrase" });
    expect(ok.statusCode).toBe(204);
  });
});

describe("login throttling", () => {
  it("limits attempts per IP+email, even when the password is right", async () => {
    t = await makeTestApp({ env: { RL_LOGIN_PER_10MIN: "3" } });
    await signup(t);
    for (let i = 0; i < 3; i++) {
      expect((await login(t, SAMPLE.email, SAMPLE.password)).statusCode).toBe(200);
    }
    const blocked = await login(t, SAMPLE.email, SAMPLE.password);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    // another email from the same IP has its own budget
    await signup(t, { email: "b@example.com", handle: "bee_h" });
    expect((await login(t, "b@example.com", SAMPLE.password)).statusCode).toBe(200);
  });

  it("locks an account after repeated failures, then recovers on success", async () => {
    t = await makeTestApp();
    await signup(t);
    for (let i = 0; i < 5; i++) {
      expect((await login(t, SAMPLE.email, "wrong-password-x")).statusCode).toBe(401);
    }
    // 6th failure triggers a 30 s lock
    expect((await login(t, SAMPLE.email, "wrong-password-x")).statusCode).toBe(401);
    const locked = await login(t, SAMPLE.email, SAMPLE.password); // correct password, still locked
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("ACCOUNT_LOCKED");
    expect(locked.json().error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.json().error.details.retryAfterSeconds).toBeLessThanOrEqual(30);

    await t.kv.del(`lock:${SAMPLE.email}`); // simulate the lock expiring
    expect((await login(t, SAMPLE.email, SAMPLE.password)).statusCode).toBe(200);
    // success cleared the failure counter
    expect(await t.kv.get(`fail:${SAMPLE.email}`)).toBeNull();
  });

  it("treats unknown emails identically (no account enumeration)", async () => {
    t = await makeTestApp();
    for (let i = 0; i < 6; i++) await login(t, "ghost@example.com", "wrong-password-x");
    const res = await login(t, "ghost@example.com", "wrong-password-x");
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("ACCOUNT_LOCKED");
  });
});

describe("email-keyed limits", () => {
  it("caps password-reset emails per address and stays silent about it", async () => {
    t = await makeTestApp({ env: { RL_FORGOT_PER_HOUR: "2" } });
    await signup(t);
    t.mailer.outbox.length = 0;
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (await post(t, "/v1/auth/forgot-password", { email: SAMPLE.email })).statusCode,
      );
    }
    expect(statuses).toEqual([202, 202, 202, 202]); // never reveals the limit
    expect(t.mailer.outbox).toHaveLength(2);
  });

  it("caps verification emails per user", async () => {
    t = await makeTestApp();
    const { accessToken } = await signupAndLogin(t);
    const resend = () =>
      post(t!, "/v1/auth/resend-verification", {}, { headers: bearer(accessToken) });
    expect([
      (await resend()).statusCode,
      (await resend()).statusCode,
      (await resend()).statusCode,
    ]).toEqual([202, 202, 202]);
    expect((await resend()).statusCode).toBe(429);
  });
});

describe("global rate limit", () => {
  it("limits anonymous traffic per IP with standard headers, but never health checks", async () => {
    t = await makeTestApp({ env: { RL_ANON_PER_MIN: "3" } });
    const get = () => t!.app.inject({ method: "GET", url: "/v1/u/nobody" });
    const first = await get();
    expect(first.headers["ratelimit-limit"]).toBe("3");
    expect(first.headers["ratelimit-remaining"]).toBe("2");
    await get();
    await get();
    const blocked = await get();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeTruthy();

    for (let i = 0; i < 10; i++) {
      expect((await t.app.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(200);
    }
  });

  it("gives signed-in users their own budget, independent of the shared IP", async () => {
    t = await makeTestApp({ env: { RL_ANON_PER_MIN: "2", RL_USER_PER_MIN: "5" } });
    const { accessToken } = await signupAndLogin(t);
    const anon = () => t!.app.inject({ method: "GET", url: "/v1/u/nobody" });
    const me = () => t!.app.inject({ method: "GET", url: "/v1/me", headers: bearer(accessToken) });

    // anonymous callers are cut off after 2...
    expect([(await anon()).statusCode, (await anon()).statusCode]).toEqual([404, 404]);
    expect((await anon()).statusCode).toBe(429);

    // ...while the signed-in user still has their larger budget (5), counted separately
    for (let i = 0; i < 5; i++) expect((await me()).statusCode).toBe(200);
    expect((await me()).statusCode).toBe(429);
  });
});

describe("verified-email gate (AI interviews)", () => {
  it("blocks unverified users, allows them after verifying, rejects anonymous callers", async () => {
    t = await makeTestApp();
    const { accessToken } = await signupAndLogin(t);
    const access = () =>
      t!.app.inject({ method: "GET", url: "/v1/interviews/access", headers: bearer(accessToken) });

    const blocked = await access();
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("EMAIL_NOT_VERIFIED");

    const token = tokenFromMail(t.mailer, "verify-email");
    expect((await post(t, "/v1/auth/verify-email", { token })).statusCode).toBe(204);
    // same access token: verification is read from the database, so it applies immediately
    const allowed = await access();
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ allowed: true });

    const anon = await t.app.inject({ method: "GET", url: "/v1/interviews/access" });
    expect(anon.statusCode).toBe(401);
  });

  it("login itself still works unverified", async () => {
    t = await makeTestApp();
    const { body } = await signupAndLogin(t);
    expect(body.user.emailVerified).toBe(false);
  });
});

describe("privileged roles require 2FA", () => {
  it("forbids non-admins, and admins without a second factor", async () => {
    t = await makeTestApp();
    t.app.get("/v1/_admin-only", { preHandler: t.app.requireRole("admin") }, async () => ({
      ok: true,
    }));
    const { accessToken } = await signupAndLogin(t);
    const call = (token: string) =>
      t!.app.inject({ method: "GET", url: "/v1/_admin-only", headers: bearer(token) });

    expect((await call(accessToken)).statusCode).toBe(403);
    expect((await call(accessToken)).json().error.code).toBe("FORBIDDEN");

    // promote, then sign in again so the token carries the new role
    await t.db.execute(sql`UPDATE users SET role = 'admin'`);
    const relog = await login(t, SAMPLE.email, SAMPLE.password);
    const adminToken = relog.json().accessToken as string;
    const res = await call(adminToken);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("MFA_REQUIRED");
  });
});
