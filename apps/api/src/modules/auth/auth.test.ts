import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  bearer,
  makeTestApp,
  refreshCookie,
  SAMPLE,
  signup,
  signupAndLogin,
  tokenFromMail,
  type TestApp,
} from "../../test/helpers.js";

let t: TestApp;
beforeEach(async () => {
  await t?.close();
  t = await makeTestApp();
});
afterAll(() => t.close());

const post = (url: string, payload: unknown, extra: object = {}) =>
  t.app.inject({ method: "POST", url, payload: payload as object, ...extra });

describe("signup", () => {
  it("creates the account and sends a verification email", async () => {
    const res = await signup(t);
    expect(res.statusCode).toBe(201);
    expect(t.mailer.outbox).toHaveLength(1);
    expect(t.mailer.outbox[0]?.to).toBe(SAMPLE.email);
    expect(t.mailer.outbox[0]?.text).toContain("/verify-email?token=");

    const row = await t.pool.query(
      "SELECT u.password_hash, p.handle FROM users u JOIN profiles p ON p.user_id = u.id",
    );
    expect(row.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(row.rows[0].handle).toBe(SAMPLE.handle);
    const settings = await t.pool.query("SELECT 1 FROM user_settings");
    expect(settings.rowCount).toBe(1);
  });

  it("normalizes email case and rejects duplicate email or handle", async () => {
    await signup(t);
    const dupEmail = await signup(t, { email: "ADA@example.com", handle: "other_h" });
    expect(dupEmail.statusCode).toBe(409);
    expect(dupEmail.json().error.details.field).toBe("email");

    const dupHandle = await signup(t, { email: "b@example.com", handle: "ADA_L" });
    expect(dupHandle.statusCode).toBe(409);
    expect(dupHandle.json().error.details.field).toBe("handle");
  });

  it("validates input with field errors", async () => {
    const res = await signup(t, { password: "short", handle: "x!", email: "nope" });
    expect(res.statusCode).toBe(422);
    const { fields } = res.json().error.details;
    expect(Object.keys(fields).sort()).toEqual(["email", "handle", "password"]);
  });
});

describe("email verification", () => {
  it("verifies once, then the token is spent", async () => {
    const { accessToken } = await signupAndLogin(t);
    const token = tokenFromMail(t.mailer, "verify-email");

    expect((await post("/v1/auth/verify-email", { token })).statusCode).toBe(204);
    const me = await t.app.inject({ method: "GET", url: "/v1/me", headers: bearer(accessToken) });
    expect(me.json().emailVerified).toBe(true);

    const again = await post("/v1/auth/verify-email", { token });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe("INVALID_TOKEN");
  });

  it("rejects an expired token", async () => {
    await signup(t);
    const token = tokenFromMail(t.mailer, "verify-email");
    await t.pool.query("UPDATE email_tokens SET expires_at = now() - interval '1 minute'");
    expect((await post("/v1/auth/verify-email", { token })).statusCode).toBe(400);
  });

  it("resend invalidates the previous link", async () => {
    const { accessToken } = await signupAndLogin(t);
    const first = tokenFromMail(t.mailer, "verify-email");
    const res = await post("/v1/auth/resend-verification", {}, { headers: bearer(accessToken) });
    expect(res.statusCode).toBe(202);
    expect((await post("/v1/auth/verify-email", { token: first })).statusCode).toBe(400);
    const second = tokenFromMail(t.mailer, "verify-email");
    expect((await post("/v1/auth/verify-email", { token: second })).statusCode).toBe(204);
  });
});

describe("login", () => {
  it("returns an access token and sets an httpOnly refresh cookie scoped to /v1/auth", async () => {
    const { res, body } = await signupAndLogin(t);
    expect(res.statusCode).toBe(200);
    expect(body.accessToken.split(".")).toHaveLength(3);
    expect(body.user.email).toBe(SAMPLE.email);
    expect(body.user.emailVerified).toBe(false);

    const cookie = res.cookies.find((c) => c.name === "pq_rt");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/v1/auth");
    expect(cookie?.sameSite).toBe("Lax");
    // only the hash is stored
    const stored = await t.pool.query("SELECT token_hash FROM auth_sessions");
    expect(stored.rows[0].token_hash).not.toBe(cookie?.value);
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    await signup(t);
    const wrong = await post("/v1/auth/login", {
      email: SAMPLE.email,
      password: "wrong-password-1",
    });
    const unknown = await post("/v1/auth/login", {
      email: "who@example.com",
      password: "wrong-password-1",
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it("blocks suspended accounts", async () => {
    await signup(t);
    await t.pool.query("UPDATE users SET status = 'suspended'");
    const res = await post("/v1/auth/login", { email: SAMPLE.email, password: SAMPLE.password });
    expect(res.statusCode).toBe(403);
  });
});

describe("access control", () => {
  it("rejects missing, malformed and tampered tokens", async () => {
    const { accessToken } = await signupAndLogin(t);
    const get = (headers: Record<string, string>) =>
      t.app.inject({ method: "GET", url: "/v1/me", headers });

    expect((await get({})).statusCode).toBe(401);
    expect((await get({ authorization: "Bearer nonsense" })).statusCode).toBe(401);
    expect((await get({ authorization: `Bearer ${accessToken.slice(0, -3)}abc` })).statusCode).toBe(
      401,
    );
    expect((await get(bearer(accessToken))).statusCode).toBe(200);
  });

  it("a token signed by a different key is rejected", async () => {
    const other = await makeTestApp();
    const { accessToken } = await signupAndLogin(other);
    const res = await t.app.inject({ method: "GET", url: "/v1/me", headers: bearer(accessToken) });
    expect(res.statusCode).toBe(401);
    await other.close();
  });
});

describe("refresh token rotation", () => {
  it("rotates the token and issues a fresh access token", async () => {
    const { refresh } = await signupAndLogin(t);
    const res = await post("/v1/auth/refresh", {}, { cookies: { pq_rt: refresh } });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();
    expect(refreshCookie(res)).toBeTruthy();
    expect(refreshCookie(res)).not.toBe(refresh);
  });

  it("revokes the whole family when an old token is replayed", async () => {
    const { refresh: first } = await signupAndLogin(t);
    const rotated = await post("/v1/auth/refresh", {}, { cookies: { pq_rt: first } });
    const second = refreshCookie(rotated)!;

    const replay = await post("/v1/auth/refresh", {}, { cookies: { pq_rt: first } });
    expect(replay.statusCode).toBe(401);

    // the legitimately rotated token is now dead too
    const afterReplay = await post("/v1/auth/refresh", {}, { cookies: { pq_rt: second } });
    expect(afterReplay.statusCode).toBe(401);
  });

  it("rejects missing, unknown and expired tokens", async () => {
    expect((await post("/v1/auth/refresh", {})).statusCode).toBe(401);
    expect((await post("/v1/auth/refresh", {}, { cookies: { pq_rt: "bogus" } })).statusCode).toBe(
      401,
    );

    const { refresh } = await signupAndLogin(t);
    await t.pool.query("UPDATE auth_sessions SET expires_at = now() - interval '1 second'");
    expect((await post("/v1/auth/refresh", {}, { cookies: { pq_rt: refresh } })).statusCode).toBe(
      401,
    );
  });

  it("blocks cross-site origins on cookie endpoints", async () => {
    const { refresh } = await signupAndLogin(t);
    const res = await post(
      "/v1/auth/refresh",
      {},
      { cookies: { pq_rt: refresh }, headers: { origin: "https://evil.example" } },
    );
    expect(res.statusCode).toBe(403);
    const ok = await post(
      "/v1/auth/refresh",
      {},
      { cookies: { pq_rt: refresh }, headers: { origin: "http://localhost:3000" } },
    );
    expect(ok.statusCode).toBe(200);
  });
});

describe("logout", () => {
  it("revokes the session so refresh no longer works", async () => {
    const { refresh } = await signupAndLogin(t);
    const out = await post("/v1/auth/logout", {}, { cookies: { pq_rt: refresh } });
    expect(out.statusCode).toBe(204);
    expect((await post("/v1/auth/refresh", {}, { cookies: { pq_rt: refresh } })).statusCode).toBe(
      401,
    );
  });

  it("logout-all revokes every device", async () => {
    const a = await signupAndLogin(t);
    const b = await post("/v1/auth/login", { email: SAMPLE.email, password: SAMPLE.password });
    const out = await post("/v1/auth/logout-all", {}, { headers: bearer(a.accessToken) });
    expect(out.statusCode).toBe(204);
    expect((await post("/v1/auth/refresh", {}, { cookies: { pq_rt: a.refresh } })).statusCode).toBe(
      401,
    );
    expect(
      (await post("/v1/auth/refresh", {}, { cookies: { pq_rt: refreshCookie(b)! } })).statusCode,
    ).toBe(401);
  });
});

describe("password reset", () => {
  it("does not reveal whether an email exists", async () => {
    const res = await post("/v1/auth/forgot-password", { email: "ghost@example.com" });
    expect(res.statusCode).toBe(202);
    expect(t.mailer.outbox).toHaveLength(0);
  });

  it("resets the password, signs out all sessions and spends the token", async () => {
    const { refresh } = await signupAndLogin(t);
    await post("/v1/auth/forgot-password", { email: SAMPLE.email });
    const token = tokenFromMail(t.mailer, "reset-password");

    const weak = await post("/v1/auth/reset-password", { token, password: "short" });
    expect(weak.statusCode).toBe(422);

    const newPassword = "a-brand-new-passphrase";
    expect(
      (await post("/v1/auth/reset-password", { token, password: newPassword })).statusCode,
    ).toBe(204);
    expect(
      (await post("/v1/auth/reset-password", { token, password: newPassword })).statusCode,
    ).toBe(400);

    expect((await post("/v1/auth/refresh", {}, { cookies: { pq_rt: refresh } })).statusCode).toBe(
      401,
    );
    const oldLogin = await post("/v1/auth/login", {
      email: SAMPLE.email,
      password: SAMPLE.password,
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await post("/v1/auth/login", { email: SAMPLE.email, password: newPassword });
    expect(newLogin.statusCode).toBe(200);
    expect(newLogin.json().user.emailVerified).toBe(true);
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After after too many attempts", async () => {
    const limited = await makeTestApp({ env: { RL_AUTH_PER_MIN: "3" } });
    const attempt = () =>
      limited.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "x@example.com", password: "nope-nope-nope" },
      });
    for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    await limited.close();
  });
});
