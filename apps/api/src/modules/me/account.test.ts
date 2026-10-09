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
import { purgeDueAccounts } from "./service.js";

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(() => t.close());

const call = (
  method: "GET" | "PUT" | "PATCH" | "POST" | "DELETE",
  url: string,
  token: string,
  payload?: object,
) => t.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

describe("prep settings", () => {
  const prep = {
    placementDate: "2026-12-01",
    hoursPerDay: { mon: 2, tue: 1.5, sat: 4 },
    targetRoles: ["SDE"],
    targetCompanies: ["Google", "Zoho"],
    track: "sde",
  };

  it("starts empty, saves, and replaces on PUT", async () => {
    const { accessToken } = await signupAndLogin(t);
    expect((await call("GET", "/v1/me/prep", accessToken)).json()).toEqual({
      placementDate: null,
      hoursPerDay: null,
      targetRoles: [],
      targetCompanies: [],
      track: null,
    });
    const saved = await call("PUT", "/v1/me/prep", accessToken, prep);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      placementDate: "2026-12-01",
      targetCompanies: ["Google", "Zoho"],
      track: "sde",
    });
    expect(saved.json().hoursPerDay).toEqual(prep.hoursPerDay);

    const replaced = await call("PUT", "/v1/me/prep", accessToken, {
      ...prep,
      targetCompanies: [],
      hoursPerDay: null,
    });
    expect(replaced.json()).toMatchObject({ targetCompanies: [], hoursPerDay: null });
  });

  it("validates dates, hours, tracks and unknown fields", async () => {
    const { accessToken } = await signupAndLogin(t);
    for (const bad of [
      { ...prep, placementDate: "01/12/2026" },
      { ...prep, hoursPerDay: { mon: 99 } },
      { ...prep, hoursPerDay: { funday: 1 } },
      { ...prep, track: "astronaut" },
      { ...prep, role: "admin" },
    ]) {
      expect((await call("PUT", "/v1/me/prep", accessToken, bad)).statusCode).toBe(422);
    }
  });
});

describe("public profiles", () => {
  const publicGet = (handle: string) => t.app.inject({ method: "GET", url: `/v1/u/${handle}` });

  it("are private by default and indistinguishable from missing", async () => {
    await signupAndLogin(t);
    const hidden = await publicGet(SAMPLE.handle);
    const missing = await publicGet("nobody_here");
    expect(hidden.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(hidden.json().error.message).toBe(missing.json().error.message);
  });

  it("show only what the owner allows, case-insensitively and without private data", async () => {
    const { accessToken } = await signupAndLogin(t);
    await call("PATCH", "/v1/me/profile", accessToken, {
      publicProfile: true,
      bio: "Loves graphs",
      college: "NIT",
    });
    const open = await publicGet("ADA_L");
    expect(open.statusCode).toBe(200);
    expect(open.json()).toMatchObject({
      handle: "ada_l",
      displayName: "Ada",
      bio: "Loves graphs",
      college: "NIT",
      stats: { xp: 0, level: 1, streakCurrent: 0, streakBest: 0 },
    });
    expect(JSON.stringify(open.json())).not.toMatch(/email|ada@example|userId|role/i);

    await call("PATCH", "/v1/me/profile", accessToken, {
      privacy: { showBio: false, showStats: false },
    });
    const filtered = (await publicGet("ada_l")).json();
    expect(filtered).toMatchObject({ bio: null, stats: null, college: "NIT" });

    // privacy merges rather than replaces
    const me = await call("GET", "/v1/me", accessToken);
    expect(me.json().profile.privacy).toEqual({
      showBio: false,
      showCollege: true,
      showStats: false,
    });

    await call("PATCH", "/v1/me/profile", accessToken, { publicProfile: false });
    expect((await publicGet("ada_l")).statusCode).toBe(404);
  });

  it("hide accounts that are suspended or being deleted, and validate the handle", async () => {
    const { accessToken } = await signupAndLogin(t);
    await call("PATCH", "/v1/me/profile", accessToken, { publicProfile: true });
    await t.db.execute(sql`UPDATE users SET status = 'suspended'`);
    expect((await publicGet("ada_l")).statusCode).toBe(404);
    expect((await publicGet("bad%20handle!")).statusCode).toBe(422);
  });
});

describe("data export", () => {
  it("returns the user's data as a JSON attachment without secrets", async () => {
    const { accessToken } = await signupAndLogin(t);
    const res = await call("POST", "/v1/me/export", accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="prepquest-export-ada_l.json"',
    );
    expect(res.headers["cache-control"]).toBe("no-store");

    const data = JSON.parse(res.body);
    expect(data.format).toBe("prepquest-export-v1");
    expect(data.account).toMatchObject({ email: SAMPLE.email, role: "user" });
    expect(data.profile).toMatchObject({ handle: "ada_l" });
    expect(data.settings).toMatchObject({ theme: "system" });
    expect(data.sessions).toHaveLength(1);
    expect(data.submissions).toEqual([]);
    expect(res.body).not.toMatch(
      /passwordHash|password_hash|tokenHash|token_hash|argon2|secretEnc/i,
    );
  });

  it("contains only the caller's own data", async () => {
    const a = await signupAndLogin(t);
    await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h", displayName: "Bob" });
    const data = JSON.parse((await call("POST", "/v1/me/export", a.accessToken)).body);
    expect(data.profile.handle).toBe("ada_l");
    expect(JSON.stringify(data)).not.toContain("bob@example.com");
  });

  it("is limited to 3 exports per day", async () => {
    const { accessToken } = await signupAndLogin(t);
    for (let i = 0; i < 3; i++)
      expect((await call("POST", "/v1/me/export", accessToken)).statusCode).toBe(200);
    expect((await call("POST", "/v1/me/export", accessToken)).statusCode).toBe(429);
  });

  it("requires sign-in", async () => {
    expect((await t.app.inject({ method: "POST", url: "/v1/me/export" })).statusCode).toBe(401);
  });
});

describe("account deletion", () => {
  it("needs explicit confirmation and the password", async () => {
    const { accessToken } = await signupAndLogin(t);
    expect((await call("DELETE", "/v1/me", accessToken, { confirm: "yes" })).statusCode).toBe(422);
    expect((await call("DELETE", "/v1/me", accessToken, { confirm: "DELETE" })).statusCode).toBe(
      401,
    );
    const wrong = await call("DELETE", "/v1/me", accessToken, {
      confirm: "DELETE",
      password: "not-it-at-all",
    });
    expect(wrong.statusCode).toBe(401);
    const me = await call("GET", "/v1/me", accessToken);
    expect(me.json().deletionRequestedAt).toBeNull();
  });

  it("schedules deletion in 14 days, signs everything out, emails, and can be cancelled by signing in", async () => {
    const { accessToken, refresh } = await signupAndLogin(t);
    t.mailer.outbox.length = 0;
    const res = await call("DELETE", "/v1/me", accessToken, {
      confirm: "DELETE",
      password: SAMPLE.password,
    });
    expect(res.statusCode).toBe(202);
    const purgeOn = new Date(res.json().purgeOn).getTime();
    expect(purgeOn - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
    expect(purgeOn - Date.now()).toBeLessThan(14.1 * 86_400_000);

    expect(t.mailer.outbox[0]?.subject).toMatch(/scheduled for deletion/);
    expect(
      (await t.app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { pq_rt: refresh } }))
        .statusCode,
    ).toBe(401);

    // still able to sign in, and the account reports it is pending
    const login = await t.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: SAMPLE.email, password: SAMPLE.password },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().accessToken as string;
    expect(login.json().user.deletionRequestedAt).not.toBeNull();
    expect(refreshCookie(login)).toBeTruthy();

    expect((await call("POST", "/v1/me/cancel-deletion", token)).statusCode).toBe(204);
    const me = (await call("GET", "/v1/me", token)).json();
    expect(me.deletionRequestedAt).toBeNull();
    const row = await t.pool.query("SELECT status FROM users");
    expect(row.rows[0].status).toBe("active");
  });

  it("requires a current 2FA code when 2FA is on", async () => {
    const { accessToken } = await signupAndLogin(t);
    const { secret } = (await call("POST", "/v1/auth/2fa/setup", accessToken)).json();
    const at = (offset: number) => hotp(base32Decode(secret), stepAt(Date.now()) + offset);
    await call("POST", "/v1/auth/2fa/verify", accessToken, { code: at(-1) });

    const body = { confirm: "DELETE", password: SAMPLE.password };
    expect((await call("DELETE", "/v1/me", accessToken, body)).statusCode).toBe(401);
    expect((await call("DELETE", "/v1/me", accessToken, { ...body, code: at(0) })).statusCode).toBe(
      202,
    );
  });

  it("lets password-less (social) accounts delete with confirmation alone", async () => {
    const { accessToken } = await signupAndLogin(t);
    await t.db.execute(sql`UPDATE users SET password_hash = NULL`);
    const res = await call("DELETE", "/v1/me", accessToken, { confirm: "DELETE" });
    expect(res.statusCode).toBe(202);
  });
});

describe("hard delete after the grace period", () => {
  const ago = (days: number) => sql`now() - make_interval(days => ${days})`;

  it("removes expired accounts and everything they own, and nothing else", async () => {
    const expired = await signupAndLogin(t);
    await signupAndLogin(t, { email: "recent@example.com", handle: "recent_h" });
    await signupAndLogin(t, { email: "active@example.com", handle: "active_h" });
    // a content problem authored by the expiring user must survive, author cleared
    const [{ id: expiredId }] = (
      await t.pool.query("SELECT id FROM users WHERE email = $1", [SAMPLE.email])
    ).rows;
    await t.pool.query(
      `INSERT INTO problems (id, slug, title, statement_md, difficulty, examples, created_by)
       VALUES ('0192f3a0-0000-7000-8000-000000000001', 'purge-fixture', 'Purge Fixture', 'Find two numbers', 'easy', '[]', $1)`,
      [expiredId],
    );

    await t.db.execute(
      sql`UPDATE users SET status = 'pending_deletion', deletion_requested_at = ${ago(15)} WHERE email = ${SAMPLE.email}`,
    );
    await t.db.execute(
      sql`UPDATE users SET status = 'pending_deletion', deletion_requested_at = ${ago(5)} WHERE email = 'recent@example.com'`,
    );

    expect(await purgeDueAccounts(t.db)).toBe(1);

    const users = await t.pool.query("SELECT email FROM users ORDER BY email");
    expect(users.rows.map((r) => r.email)).toEqual(["active@example.com", "recent@example.com"]);
    for (const table of ["profiles", "user_settings", "auth_sessions", "email_tokens"]) {
      const left = await t.pool.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`,
        [expiredId],
      );
      expect(left.rows[0].n, table).toBe(0);
    }
    const problem = await t.pool.query(
      "SELECT created_by FROM problems WHERE slug = 'purge-fixture'",
    );
    expect(problem.rows[0].created_by).toBeNull();
    expect(expired.accessToken).toBeTruthy();
  });

  it("does nothing when nobody is due", async () => {
    await signupAndLogin(t);
    expect(await purgeDueAccounts(t.db)).toBe(0);
  });
});
