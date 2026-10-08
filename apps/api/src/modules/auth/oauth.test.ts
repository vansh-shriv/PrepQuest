import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { base32Decode, hotp, stepAt } from "../../lib/totp.js";
import {
  bearer,
  makeTestApp,
  refreshCookie,
  SAMPLE,
  signup,
  type TestApp,
} from "../../test/helpers.js";

/** A fake Google + GitHub: records token requests and serves whatever profile the test sets. */
function fakeProviders() {
  const state = {
    google: { sub: "g-1", email: "ada@example.com", email_verified: true, name: "Ada Lovelace" },
    github: { id: 4242, login: "adal", name: "Ada L" as string | null },
    githubEmails: [{ email: "ada@example.com", primary: true, verified: true }],
    tokenRequests: [] as URLSearchParams[],
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    if (
      url === "https://oauth2.googleapis.com/token" ||
      url === "https://github.com/login/oauth/access_token"
    ) {
      const body = new URLSearchParams(String(init?.body));
      state.tokenRequests.push(body);
      if (body.get("code") !== "good-code") return json({ error: "bad_code" }, 400);
      return json({ access_token: url.includes("google") ? "g-token" : "gh-token" });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo" && auth === "Bearer g-token") {
      return json(state.google);
    }
    if (url === "https://api.github.com/user" && auth === "Bearer gh-token")
      return json(state.github);
    if (url === "https://api.github.com/user/emails" && auth === "Bearer gh-token") {
      return json(state.githubEmails);
    }
    return json({ error: "unexpected request", url }, 500);
  }) as typeof fetch;
  return { state, fetchFn };
}

let t: TestApp;
let fake: ReturnType<typeof fakeProviders>;

beforeEach(async () => {
  fake = fakeProviders();
  t = await makeTestApp({ fetchFn: fake.fetchFn });
});
afterEach(() => t.close());

/** Begins a flow and returns what the browser would carry to the callback. */
async function begin(provider = "google") {
  const res = await t.app.inject({ method: "GET", url: `/v1/auth/oauth/${provider}/start` });
  const location = new URL(res.headers.location as string);
  return {
    res,
    location,
    state: location.searchParams.get("state")!,
    challenge: location.searchParams.get("code_challenge")!,
    cookie: res.cookies.find((c) => c.name === "pq_oauth")?.value,
  };
}

const callback = (
  flow: { state: string; cookie?: string | undefined },
  provider = "google",
  query: Record<string, string> = {},
) =>
  t.app.inject({
    method: "GET",
    url: `/v1/auth/oauth/${provider}/callback`,
    query: { code: "good-code", state: flow.state, ...query },
    ...(flow.cookie ? { cookies: { pq_oauth: flow.cookie } } : {}),
  });

const where = (res: { headers: Record<string, unknown> }) => String(res.headers.location);

describe("providers and start", () => {
  it("lists only configured providers", async () => {
    const both = await t.app.inject({ method: "GET", url: "/v1/auth/oauth/providers" });
    expect(both.json().providers).toEqual(["google", "github"]);

    const googleOnly = await makeTestApp({
      env: { GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" },
    });
    const res = await googleOnly.app.inject({ method: "GET", url: "/v1/auth/oauth/providers" });
    expect(res.json().providers).toEqual(["google"]);
    const missing = await googleOnly.app.inject({
      method: "GET",
      url: "/v1/auth/oauth/github/start",
    });
    expect(missing.statusCode).toBe(404);
    await googleOnly.close();
  });

  it("redirects to the provider with PKCE (S256), state and the callback URL, and binds state to the browser", async () => {
    const flow = await begin("google");
    expect(flow.res.statusCode).toBe(302);
    expect(flow.location.origin + flow.location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(flow.location.searchParams.get("client_id")).toBe("google-id");
    expect(flow.location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(flow.location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4000/v1/auth/oauth/google/callback",
    );
    expect(flow.location.searchParams.get("scope")).toContain("email");
    expect(flow.cookie).toBe(flow.state);
    const cookie = flow.res.cookies.find((c) => c.name === "pq_oauth");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/v1/auth/oauth" });
  });
});

describe("callback: new account", () => {
  it("creates a verified, passwordless account, signs in and redirects to the app", async () => {
    const flow = await begin();
    const res = await callback(flow);
    expect(res.statusCode).toBe(302);
    expect(where(res)).toBe("http://localhost:3000/oauth/callback");
    const rt = refreshCookie(res);
    expect(rt).toBeTruthy();

    // the web app then exchanges the cookie for an access token
    const refreshed = await t.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      cookies: { pq_rt: rt! },
    });
    const me = refreshed.json().user;
    expect(me).toMatchObject({
      email: "ada@example.com",
      emailVerified: true,
      hasPassword: false,
      profile: { displayName: "Ada Lovelace" },
    });
    expect(me.profile.handle).toMatch(/^ada_lovelace/);
  });

  it("proves possession of the PKCE verifier to the token endpoint", async () => {
    const flow = await begin();
    await callback(flow);
    const sent = fake.state.tokenRequests[0]!;
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("client_secret")).toBe("google-secret");
    const verifier = sent.get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(flow.challenge);
  });

  it("gives colliding handles a numeric suffix", async () => {
    await signup(t, { email: "x@example.com", handle: "ada_lovelace" });
    const res = await callback(await begin());
    expect(res.statusCode).toBe(302);
    const handles = await t.pool.query("SELECT handle FROM profiles ORDER BY handle");
    expect(handles.rows).toHaveLength(2);
    expect(handles.rows.some((r) => /^ada_lovelace_\d{4}$/.test(r.handle))).toBe(true);
  });

  it("uses GitHub's primary verified email, not the profile email", async () => {
    fake.state.githubEmails = [
      { email: "noise@example.com", primary: false, verified: true },
      { email: "Gh.User@Example.com", primary: true, verified: true },
    ];
    const flow = await begin("github");
    const res = await callback(flow, "github");
    expect(where(res)).toBe("http://localhost:3000/oauth/callback");
    const users = await t.pool.query("SELECT email FROM users");
    expect(users.rows).toEqual([{ email: "gh.user@example.com" }]);
  });
});

describe("callback: safety checks", () => {
  it("rejects a callback without the matching browser cookie (login CSRF)", async () => {
    const flow = await begin();
    const res = await callback({ state: flow.state }); // attacker-supplied code in the victim's browser
    expect(where(res)).toBe("http://localhost:3000/login?error=oauth_state");
    expect(refreshCookie(res)).toBeUndefined();
    const wrong = await callback({ state: flow.state, cookie: "something-else" });
    expect(where(wrong)).toContain("oauth_state");
  });

  it("makes state single-use and rejects unknown state", async () => {
    const flow = await begin();
    expect(where(await callback(flow))).toContain("/oauth/callback");
    expect(where(await callback(flow))).toContain("oauth_state"); // replay
    expect(where(await callback({ state: "forged", cookie: "forged" }))).toContain("oauth_state");
  });

  it("reports provider-side denial and failures without creating accounts", async () => {
    const denied = await callback(await begin(), "google", { error: "access_denied", code: "" });
    expect(where(denied)).toContain("oauth_denied");
    const badCode = await callback(await begin(), "google", { code: "wrong" });
    expect(where(badCode)).toContain("oauth_provider");
    expect((await t.pool.query("SELECT 1 FROM users")).rowCount).toBe(0);
  });

  it("refuses providers that don't vouch for the email", async () => {
    fake.state.google.email_verified = false;
    const res = await callback(await begin());
    expect(where(res)).toContain("oauth_unverified_email");
    fake.state.githubEmails = [{ email: "a@example.com", primary: true, verified: false }];
    const gh = await callback(await begin("github"), "github");
    expect(where(gh)).toContain("oauth_unverified_email");
    expect((await t.pool.query("SELECT 1 FROM users")).rowCount).toBe(0);
  });
});

describe("callback: linking and pre-hijack protection", () => {
  it("links to an existing account whose email is already verified", async () => {
    await signup(t);
    await t.db.execute(sql`UPDATE users SET email_verified_at = now()`);

    const res = await callback(await begin());
    expect(where(res)).toBe("http://localhost:3000/oauth/callback");
    expect((await t.pool.query("SELECT 1 FROM users")).rowCount).toBe(1);
    expect((await t.pool.query("SELECT provider FROM oauth_accounts")).rows).toEqual([
      { provider: "google" },
    ]);

    // password login keeps working: linking must not disturb the existing credentials
    const login = await t.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: SAMPLE.email, password: SAMPLE.password },
    });
    expect(login.statusCode).toBe(200);
  });

  it("recognises a linked identity even if the provider email later changes", async () => {
    await callback(await begin());
    fake.state.google.email = "new-address@example.com";
    const res = await callback(await begin());
    expect(where(res)).toBe("http://localhost:3000/oauth/callback");
    expect((await t.pool.query("SELECT 1 FROM users")).rowCount).toBe(1);
  });

  it("neutralises a pre-registered UNVERIFIED account with the victim's email", async () => {
    // attacker signs up with the victim's address and a password they know, never verifying it
    const attacker = await signup(t);
    expect(attacker.statusCode).toBe(201);
    const attackerLogin = await t.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: SAMPLE.email, password: SAMPLE.password },
    });
    const attackerRefresh = refreshCookie(attackerLogin)!;

    // the real owner signs in with Google
    const res = await callback(await begin());
    expect(where(res)).toBe("http://localhost:3000/oauth/callback");

    const row = await t.pool.query("SELECT password_hash, email_verified_at FROM users");
    expect(row.rows[0].password_hash).toBeNull(); // attacker's password is gone
    expect(row.rows[0].email_verified_at).not.toBeNull();

    const again = await t.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: SAMPLE.email, password: SAMPLE.password },
    });
    expect(again.statusCode).toBe(401);
    const stolen = await t.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      cookies: { pq_rt: attackerRefresh },
    });
    expect(stolen.statusCode).toBe(401); // attacker's existing session was revoked
  });

  it("hands accounts with 2FA a second-factor challenge instead of a session", async () => {
    // enrol 2FA on an account that links to Google
    await signup(t);
    await t.db.execute(sql`UPDATE users SET email_verified_at = now()`);
    const login = await t.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: SAMPLE.email, password: SAMPLE.password },
    });
    const token = login.json().accessToken as string;
    const setup = await t.app.inject({
      method: "POST",
      url: "/v1/auth/2fa/setup",
      headers: bearer(token),
    });
    const secret = setup.json().secret as string;
    await t.app.inject({
      method: "POST",
      url: "/v1/auth/2fa/verify",
      headers: bearer(token),
      payload: { code: hotp(base32Decode(secret), stepAt(Date.now()) - 1) },
    });

    const res = await callback(await begin());
    const target = new URL(where(res));
    expect(target.pathname).toBe("/oauth/callback");
    const mfaToken = target.searchParams.get("mfa");
    expect(mfaToken).toBeTruthy();
    expect(refreshCookie(res)).toBeUndefined();

    const done = await t.app.inject({
      method: "POST",
      url: "/v1/auth/2fa/login",
      payload: { mfaToken, code: hotp(base32Decode(secret), stepAt(Date.now())) },
    });
    expect(done.statusCode).toBe(200);
  });
});
