import { createHash, randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { newId, oauthAccounts, withTransaction } from "@prepquest/db";
import { AppError, type ServerEnv } from "@prepquest/shared";
import { randomToken } from "../../lib/crypto.js";
import * as repo from "./repo.js";
import {
  canSignIn,
  createAccount,
  issueSession,
  type AuthContext,
  type ClientMeta,
  type LoginOutcome,
} from "./service.js";
import { signMfaToken } from "./access-token.js";

export type ProviderId = "google" | "github";

export interface ProviderProfile {
  providerUserId: string;
  email: string | null;
  /** The provider vouches that the user controls this address. Required to sign in. */
  emailVerified: boolean;
  name: string | null;
}

interface Provider {
  id: ProviderId;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  loadProfile(accessToken: string, fetchFn: typeof fetch): Promise<ProviderProfile>;
}

async function getJson<T>(fetchFn: typeof fetch, url: string, accessToken: string): Promise<T> {
  const res = await fetchFn(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": "PrepQuest",
    },
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return (await res.json()) as T;
}

export function configuredProviders(env: ServerEnv): Provider[] {
  const providers: Provider[] = [];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push({
      id: "google",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      async loadProfile(token, fetchFn) {
        // the userinfo endpoint is called server-to-server over TLS, so no id_token validation is needed
        const u = await getJson<{
          sub: string;
          email?: string;
          email_verified?: boolean;
          name?: string;
        }>(fetchFn, "https://openidconnect.googleapis.com/v1/userinfo", token);
        return {
          providerUserId: u.sub,
          email: u.email?.toLowerCase() ?? null,
          emailVerified: u.email_verified === true,
          name: u.name ?? null,
        };
      },
    });
  }

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.push({
      id: "github",
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scope: "read:user user:email",
      async loadProfile(token, fetchFn) {
        const u = await getJson<{ id: number; login: string; name?: string | null }>(
          fetchFn,
          "https://api.github.com/user",
          token,
        );
        // the public profile email is unverified; use the primary verified one from /user/emails
        const emails = await getJson<Array<{ email: string; primary: boolean; verified: boolean }>>(
          fetchFn,
          "https://api.github.com/user/emails",
          token,
        );
        const primary = emails.find((e) => e.primary && e.verified);
        return {
          providerUserId: String(u.id),
          email: primary?.email.toLowerCase() ?? null,
          emailVerified: Boolean(primary),
          name: u.name ?? u.login,
        };
      },
    });
  }
  return providers;
}

function providerOrThrow(ctx: AuthContext, id: string): Provider {
  const provider = configuredProviders(ctx.env).find((p) => p.id === id);
  if (!provider) throw new AppError("NOT_FOUND", 404, "That sign-in provider isn't available");
  return provider;
}

const callbackUrl = (env: ServerEnv, id: string) => `${env.API_URL}/v1/auth/oauth/${id}/callback`;
const STATE_TTL_SEC = 600;

// ---------------------------------------------------------------- start

export interface OAuthStart {
  url: string;
  /** Also set as an httpOnly cookie so the callback can prove it's the same browser (login CSRF). */
  state: string;
}

export async function start(ctx: AuthContext, providerId: string): Promise<OAuthStart> {
  const provider = providerOrThrow(ctx, providerId);
  const state = randomToken();
  const verifier = randomToken(); // PKCE code_verifier (43 chars of base64url)
  await ctx.kv.set(
    `oauth:${state}`,
    JSON.stringify({ provider: provider.id, verifier }),
    STATE_TTL_SEC,
  );

  const url = new URL(provider.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: callbackUrl(ctx.env, provider.id),
    response_type: "code",
    scope: provider.scope,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state };
}

// ---------------------------------------------------------------- callback

export class OAuthFailure extends Error {
  constructor(public readonly reason: "denied" | "state" | "provider" | "unverified_email") {
    super(reason);
  }
}

async function exchangeCode(
  ctx: AuthContext,
  provider: Provider,
  code: string,
  verifier: string,
): Promise<string> {
  const res = await ctx.fetchFn(provider.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl(ctx.env, provider.id),
    }),
  });
  if (!res.ok) throw new OAuthFailure("provider");
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new OAuthFailure("provider");
  return body.access_token;
}

function handleFrom(name: string | null, email: string): string {
  const base = (name ?? email.split("@")[0] ?? "player")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 14);
  return base.length >= 3 ? base : `player_${base}`.slice(0, 14);
}

async function uniqueHandle(ctx: AuthContext, name: string | null, email: string): Promise<string> {
  const base = handleFrom(name, email);
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}_${randomInt(1000, 10000)}`;
    if (!(await repo.handleExists(ctx.db, candidate))) return candidate;
  }
  return `${base}_${randomToken()
    .slice(0, 5)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "x")}`;
}

/**
 * Resolves the local account for a verified provider identity.
 *  1. Known identity -> that user.
 *  2. Same email, local email already verified -> link.
 *  3. Same email, local email NOT verified -> the local account was never proven to belong to anyone
 *     (possibly pre-registered by an attacker): wipe its password and sessions, then link.
 *  4. Otherwise create a new, verified, password-less account.
 */
async function resolveAccount(
  ctx: AuthContext,
  providerId: ProviderId,
  profile: ProviderProfile & { email: string },
): Promise<repo.UserRow> {
  const [linked] = await ctx.db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, providerId),
        eq(oauthAccounts.providerUserId, profile.providerUserId),
      ),
    )
    .limit(1);
  if (linked) {
    const user = await repo.findUserById(ctx.db, linked.userId);
    if (user) return user;
  }

  const existing = await repo.findUserByEmail(ctx.db, profile.email);
  if (existing) {
    await withTransaction(ctx.db, async (tx) => {
      if (!existing.emailVerifiedAt) {
        await repo.setPasswordHash(tx, existing.id, null);
        await repo.revokeAllForUser(tx, existing.id);
        await repo.markEmailVerified(tx, existing.id);
      }
      await tx.insert(oauthAccounts).values({
        id: newId(),
        userId: existing.id,
        provider: providerId,
        providerUserId: profile.providerUserId,
        email: profile.email,
      });
    });
    return (await repo.findUserById(ctx.db, existing.id)) ?? existing;
  }

  const userId = await createAccount(ctx, {
    email: profile.email,
    passwordHash: null,
    handle: await uniqueHandle(ctx, profile.name, profile.email),
    displayName: (profile.name ?? profile.email.split("@")[0] ?? "Player").slice(0, 50),
    emailVerified: true,
  });
  await ctx.db.insert(oauthAccounts).values({
    id: newId(),
    userId,
    provider: providerId,
    providerUserId: profile.providerUserId,
    email: profile.email,
  });
  const created = await repo.findUserById(ctx.db, userId);
  if (!created) throw new Error("account vanished after creation");
  return created;
}

export async function handleCallback(
  ctx: AuthContext,
  providerId: string,
  query: { code?: string | undefined; state?: string | undefined; error?: string | undefined },
  cookieState: string | undefined,
  meta: ClientMeta,
): Promise<LoginOutcome> {
  const provider = providerOrThrow(ctx, providerId);
  if (query.error) throw new OAuthFailure("denied");
  // state must exist server-side (single use) AND match the cookie set on this browser
  const stored = query.state ? await ctx.kv.take(`oauth:${query.state}`) : null;
  if (!query.code || !query.state || !stored || cookieState !== query.state) {
    throw new OAuthFailure("state");
  }
  const { provider: storedProvider, verifier } = JSON.parse(stored) as {
    provider: string;
    verifier: string;
  };
  if (storedProvider !== provider.id) throw new OAuthFailure("state");

  let profile: ProviderProfile;
  try {
    const token = await exchangeCode(ctx, provider, query.code, verifier);
    profile = await provider.loadProfile(token, ctx.fetchFn);
  } catch (err) {
    if (err instanceof OAuthFailure) throw err;
    ctx.log.warn({ err, provider: provider.id }, "oauth provider call failed");
    throw new OAuthFailure("provider");
  }
  if (!profile.email || !profile.emailVerified) throw new OAuthFailure("unverified_email");

  const user = await resolveAccount(ctx, provider.id, { ...profile, email: profile.email });
  if (!canSignIn(user.status)) throw new OAuthFailure("denied");

  const me = await repo.getMe(ctx.db, user.id);
  if (me?.twoFactorEnabled) {
    return {
      kind: "mfa",
      body: { mfaRequired: true, mfaToken: await signMfaToken(ctx.keys, user.id) },
    };
  }
  await repo.touchLogin(ctx.db, user.id);
  return { kind: "session", session: await issueSession(ctx, user, meta) };
}
