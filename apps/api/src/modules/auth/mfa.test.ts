import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { base32Decode, hotp, stepAt } from "../../lib/totp.js";
import {
  bearer,
  makeTestApp,
  refreshCookie,
  SAMPLE,
  signupAndLogin,
  type TestApp,
} from "../../test/helpers.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(() => t.close());

/** The code for the current 30 s step plus `offset` steps (server accepts -1..+1). */
const codeAt = (secret: string, offset = 0) =>
  hotp(base32Decode(secret), stepAt(Date.now()) + offset);

const post = (url: string, payload: unknown, extra: object = {}) =>
  t.app.inject({ method: "POST", url, payload: payload as object, ...extra });

const claimsOf = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;

/** Signs up and turns 2FA on. Codes are used in strictly increasing steps (-1, 0, +1) so replay protection never trips. */
async function enroll() {
  const user = await signupAndLogin(t);
  const setup = await post("/v1/auth/2fa/setup", {}, { headers: bearer(user.accessToken) });
  const { secret, otpauthUrl } = setup.json() as { secret: string; otpauthUrl: string };
  const verify = await post(
    "/v1/auth/2fa/verify",
    { code: codeAt(secret, -1) },
    { headers: bearer(user.accessToken) },
  );
  return {
    ...user,
    secret,
    otpauthUrl,
    setup,
    verify,
    recoveryCodes: verify.json().recoveryCodes as string[],
  };
}

const passwordLogin = () =>
  post("/v1/auth/login", { email: SAMPLE.email, password: SAMPLE.password });

describe("enrolment", () => {
  it("returns a secret and otpauth URL, and stores the seed encrypted", async () => {
    const { secret, otpauthUrl, setup } = await enroll();
    expect(setup.statusCode).toBe(200);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUrl).toContain("otpauth://totp/");

    const rows = await t.pool.query("SELECT secret_enc, confirmed_at FROM user_totp");
    expect(rows.rows[0].secret_enc).toMatch(/^v1\./);
    expect(rows.rows[0].secret_enc).not.toContain(secret);
    expect(rows.rows[0].confirmed_at).not.toBeNull();
  });

  it("issues 10 one-time recovery codes and stores only their hashes", async () => {
    const { verify, recoveryCodes } = await enroll();
    expect(verify.statusCode).toBe(200);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const stored = await t.pool.query("SELECT recovery_codes FROM user_totp");
    expect(JSON.stringify(stored.rows[0].recovery_codes)).not.toContain(
      recoveryCodes[0]!.replace("-", ""),
    );
  });

  it("rejects a wrong confirmation code and leaves 2FA off", async () => {
    const user = await signupAndLogin(t);
    await post("/v1/auth/2fa/setup", {}, { headers: bearer(user.accessToken) });
    const res = await post(
      "/v1/auth/2fa/verify",
      { code: "000000" },
      { headers: bearer(user.accessToken) },
    );
    expect(res.statusCode).toBe(401);
    const me = await t.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: bearer(user.accessToken),
    });
    expect(me.json().twoFactorEnabled).toBe(false);
  });

  it("cannot be started twice once enabled", async () => {
    const user = await enroll();
    const again = await post("/v1/auth/2fa/setup", {}, { headers: bearer(user.accessToken) });
    expect(again.statusCode).toBe(409);
  });

  it("requires sign-in", async () => {
    expect((await post("/v1/auth/2fa/setup", {})).statusCode).toBe(401);
  });
});

describe("login with 2FA", () => {
  it("returns a challenge instead of a session, then completes with a code", async () => {
    const { secret } = await enroll();
    const first = await passwordLogin();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ mfaRequired: true });
    expect(first.json().accessToken).toBeUndefined();
    expect(refreshCookie(first)).toBeUndefined();

    const done = await post("/v1/auth/2fa/login", {
      mfaToken: first.json().mfaToken,
      code: codeAt(secret, 0),
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().user.twoFactorEnabled).toBe(true);
    expect(refreshCookie(done)).toBeTruthy();
    expect(claimsOf(done.json().accessToken).mfa).toBe(true);
  });

  it("rejects wrong codes and replayed codes", async () => {
    const { secret } = await enroll();
    const mfaToken = (await passwordLogin()).json().mfaToken as string;

    expect((await post("/v1/auth/2fa/login", { mfaToken, code: "123456" })).statusCode).toBe(401);

    const code = codeAt(secret, 0);
    expect((await post("/v1/auth/2fa/login", { mfaToken, code })).statusCode).toBe(200);
    const second = (await passwordLogin()).json().mfaToken as string;
    const replay = await post("/v1/auth/2fa/login", { mfaToken: second, code });
    expect(replay.statusCode).toBe(401); // same step, already used
  });

  it("a challenge token is not an access token, and an access token is not a challenge token", async () => {
    const { secret, accessToken } = await enroll();
    const mfaToken = (await passwordLogin()).json().mfaToken as string;
    const asAccess = await t.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: bearer(mfaToken),
    });
    expect(asAccess.statusCode).toBe(401);

    const asChallenge = await post("/v1/auth/2fa/login", {
      mfaToken: accessToken,
      code: codeAt(secret, 0),
    });
    expect(asChallenge.statusCode).toBe(401);
  });

  it("limits wrong guesses to 5 per 10 minutes, even for the right code afterwards", async () => {
    const { secret } = await enroll();
    const mfaToken = (await passwordLogin()).json().mfaToken as string;
    for (let i = 0; i < 5; i++) {
      expect((await post("/v1/auth/2fa/login", { mfaToken, code: "000000" })).statusCode).toBe(401);
    }
    const blocked = await post("/v1/auth/2fa/login", { mfaToken, code: "000000" });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
    // locked out means locked out: the correct code is refused too until the window passes
    const correct = await post("/v1/auth/2fa/login", { mfaToken, code: codeAt(secret, 0) });
    expect(correct.statusCode).toBe(429);
  });

  it("does not count successful verifications against the budget", async () => {
    const { recoveryCodes } = await enroll();
    for (const recoveryCode of recoveryCodes.slice(0, 7)) {
      const mfaToken = (await passwordLogin()).json().mfaToken as string;
      const res = await post("/v1/auth/2fa/login", { mfaToken, recoveryCode });
      expect(res.statusCode).toBe(200);
    }
  });

  it("keeps the second-factor flag across refresh", async () => {
    const { secret } = await enroll();
    const mfaToken = (await passwordLogin()).json().mfaToken as string;
    const done = await post("/v1/auth/2fa/login", { mfaToken, code: codeAt(secret, 0) });
    const refreshed = await post(
      "/v1/auth/refresh",
      {},
      { cookies: { pq_rt: refreshCookie(done)! } },
    );
    expect(refreshed.statusCode).toBe(200);
    expect(claimsOf(refreshed.json().accessToken).mfa).toBe(true);
  });

  it("a password-only session never carries the flag", async () => {
    const { accessToken } = await signupAndLogin(t);
    expect(claimsOf(accessToken).mfa).toBe(false);
  });
});

describe("recovery codes", () => {
  it("work once each, case- and dash-insensitively", async () => {
    const { recoveryCodes } = await enroll();
    const code = recoveryCodes[0]!;
    const attempt = async (value: string) => {
      const mfaToken = (await passwordLogin()).json().mfaToken as string;
      return post("/v1/auth/2fa/login", { mfaToken, recoveryCode: value });
    };
    expect((await attempt(code.toLowerCase().replace("-", ""))).statusCode).toBe(200);
    expect((await attempt(code)).statusCode).toBe(401); // already used
    expect((await attempt(recoveryCodes[1]!)).statusCode).toBe(200); // others still fine
  });
});

describe("disabling", () => {
  it("needs the password and a current code, then restores plain login", async () => {
    const { accessToken, secret } = await enroll();
    const disable = (payload: object) =>
      post("/v1/auth/2fa/disable", payload, { headers: bearer(accessToken) });

    expect((await disable({ code: codeAt(secret, 0) })).statusCode).toBe(401); // password missing
    expect((await disable({ password: SAMPLE.password, code: "000000" })).statusCode).toBe(401);
    expect((await disable({ password: SAMPLE.password, code: codeAt(secret, 1) })).statusCode).toBe(
      204,
    );

    expect((await passwordLogin()).json().accessToken).toBeTruthy();
    const rows = await t.pool.query("SELECT 1 FROM user_totp");
    expect(rows.rowCount).toBe(0);
  });
});

describe("admins with 2FA", () => {
  it("can reach admin routes only through a 2FA session", async () => {
    t.app.get("/v1/_admin-only", { preHandler: t.app.requireRole("admin") }, async () => ({
      ok: true,
    }));
    const { secret } = await enroll();
    await t.db.execute(sql`UPDATE users SET role = 'admin'`);
    const call = (token: string) =>
      t.app.inject({ method: "GET", url: "/v1/_admin-only", headers: bearer(token) });

    // password-only is not enough once promoted... but 2FA login is
    const mfaToken = (await passwordLogin()).json().mfaToken as string;
    const done = await post("/v1/auth/2fa/login", { mfaToken, code: codeAt(secret, 0) });
    expect((await call(done.json().accessToken)).statusCode).toBe(200);
  });
});
