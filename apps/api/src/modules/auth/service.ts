import type { FastifyBaseLogger } from "fastify";
import { newId, withTransaction, type Database } from "@prepquest/db";
import {
  AppError,
  type LoginInput,
  type LoginResponse,
  type MfaRequiredResponse,
  type ServerEnv,
  type SignupInput,
} from "@prepquest/shared";
import type { BreachChecker } from "../../lib/breach.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import type { SecretBox } from "../../lib/encryption.js";
import type { Kv } from "../../lib/kv.js";
import type { AttemptGuard, LoginLockout, RateLimiter } from "../../lib/limiter.js";
import type { Mailer } from "../../lib/mailer.js";
import { signAccessToken, signMfaToken } from "./access-token.js";
import type { JwtKeys } from "./keys.js";
import { hashPassword, verifyDummy, verifyPassword } from "./password.js";
import * as repo from "./repo.js";

export interface AuthContext {
  db: Database;
  env: ServerEnv;
  keys: JwtKeys;
  mailer: Mailer;
  log: FastifyBaseLogger;
  kv: Kv;
  limiter: RateLimiter;
  lockout: LoginLockout;
  /** Wrong second-factor codes per user (5 per 10 minutes); successes don't count. */
  mfaGuard: AttemptGuard;
  breach: BreachChecker;
  box: SecretBox;
  /** Injectable for OAuth tests; defaults to global fetch. */
  fetchFn: typeof fetch;
}

export interface ClientMeta {
  userAgent: string | null;
  ip: string | null;
}

/** Result of anything that mints a session: the body for the client plus the raw refresh cookie. */
export interface SessionIssued extends LoginResponse {
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type LoginOutcome =
  { kind: "session"; session: SessionIssued } | { kind: "mfa"; body: MfaRequiredResponse };

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const invalidCredentials = () =>
  new AppError("UNAUTHENTICATED", 401, "Incorrect email or password");

function constraintOf(err: unknown): string | undefined {
  // drizzle wraps driver errors; the Postgres error sits on `cause`
  const e = ((err as { cause?: unknown }).cause ?? err) as { code?: string; constraint?: string };
  return e.code === "23505" ? e.constraint : undefined;
}

/** Sign-in is allowed for active accounts and for accounts in their deletion grace period (to cancel). */
export function canSignIn(status: string): boolean {
  return status === "active" || status === "pending_deletion";
}

// ---------------------------------------------------------------- passwords

/** Throws 422 on a password found in public breach data (doc 14). Fails open if the service is down. */
export async function assertPasswordAllowed(ctx: AuthContext, password: string): Promise<void> {
  if (await ctx.breach.isBreached(password)) {
    throw new AppError("VALIDATION_FAILED", 422, "Invalid input", {
      fields: {
        password: "This password appears in known data breaches. Choose a different one.",
      },
    });
  }
}

// ---------------------------------------------------------------- accounts

export interface NewAccount {
  email: string;
  passwordHash: string | null;
  handle: string;
  displayName: string;
  emailVerified?: boolean;
}

/** Creates user + profile + settings atomically. Maps unique violations to 409 conflicts. */
export async function createAccount(ctx: AuthContext, input: NewAccount): Promise<string> {
  const userId = newId();
  try {
    await withTransaction(ctx.db, async (tx) => {
      await repo.insertUser(tx, {
        id: userId,
        email: input.email,
        passwordHash: input.passwordHash,
        emailVerified: input.emailVerified ?? false,
      });
      await repo.insertProfile(tx, {
        userId,
        handle: input.handle,
        displayName: input.displayName,
      });
    });
  } catch (err) {
    const constraint = constraintOf(err);
    if (constraint?.includes("email")) {
      throw new AppError("CONFLICT", 409, "That email is already registered", { field: "email" });
    }
    if (constraint?.includes("handle")) {
      throw new AppError("CONFLICT", 409, "That handle is taken", { field: "handle" });
    }
    throw err;
  }
  return userId;
}

export async function signup(ctx: AuthContext, input: SignupInput): Promise<void> {
  await assertPasswordAllowed(ctx, input.password);
  const passwordHash = await hashPassword(input.password);
  const userId = await createAccount(ctx, {
    email: input.email,
    passwordHash,
    handle: input.handle,
    displayName: input.displayName,
  });
  await sendVerificationEmail(ctx, userId, input.email, input.displayName);
}

async function sendVerificationEmail(
  ctx: AuthContext,
  userId: string,
  email: string,
  displayName: string,
): Promise<void> {
  const token = randomToken();
  await repo.createEmailToken(ctx.db, {
    id: newId(),
    userId,
    kind: "verify_email",
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });
  const link = `${ctx.env.APP_URL}/verify-email?token=${token}`;
  await safeSend(ctx, {
    to: email,
    subject: "Verify your PrepQuest email",
    text: `Hi ${displayName},\n\nQuest accepted! Confirm your email to unlock everything, including AI mock interviews:\n${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Hi ${escapeHtml(displayName)},</p><p>Quest accepted! Confirm your email to unlock everything, including AI mock interviews:</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

/** Email delivery must never break the request that triggered it. */
export async function safeSend(
  ctx: AuthContext,
  message: Parameters<Mailer["send"]>[0],
): Promise<void> {
  try {
    await ctx.mailer.send(message);
  } catch (err) {
    ctx.log.error({ err, to: "[redacted]" }, "failed to send email");
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export async function verifyEmail(ctx: AuthContext, token: string): Promise<void> {
  const userId = await repo.consumeEmailToken(ctx.db, "verify_email", sha256(token));
  if (!userId) {
    throw new AppError("INVALID_TOKEN", 400, "This verification link is invalid or has expired");
  }
  await repo.markEmailVerified(ctx.db, userId);
}

export async function resendVerification(ctx: AuthContext, userId: string): Promise<void> {
  const user = await repo.findUserById(ctx.db, userId);
  if (!user || user.emailVerifiedAt) return;
  // at most 3 verification emails per user per hour
  await ctx.limiter.enforce(`verify-mail:${userId}`, 3, 3600, "verification emails");
  const me = await repo.getMe(ctx.db, userId);
  await sendVerificationEmail(ctx, userId, user.email, me?.profile.displayName ?? "there");
}

// ---------------------------------------------------------------- password reset

/** Always resolves quietly so callers can't probe which emails exist. Limited per address per hour. */
export async function forgotPassword(ctx: AuthContext, email: string): Promise<void> {
  const allowed = await ctx.limiter.hit(`forgot:${email}`, ctx.env.RL_FORGOT_PER_HOUR, 3600);
  if (!allowed.allowed) return; // silently drop: same response whether or not the address exists
  const user = await repo.findUserByEmail(ctx.db, email);
  if (!user || !canSignIn(user.status)) return;
  const token = randomToken();
  await repo.createEmailToken(ctx.db, {
    id: newId(),
    userId: user.id,
    kind: "reset_password",
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  const link = `${ctx.env.APP_URL}/reset-password?token=${token}`;
  await safeSend(ctx, {
    to: user.email,
    subject: "Reset your PrepQuest password",
    text: `Use this link to choose a new password (valid for 1 hour):\n${link}\n\nIf you didn't ask for this, ignore this email.`,
    html: `<p>Use this link to choose a new password (valid for 1 hour):</p><p><a href="${link}">Reset password</a></p><p>If you didn't ask for this, ignore this email.</p>`,
  });
}

export async function resetPassword(
  ctx: AuthContext,
  token: string,
  newPassword: string,
): Promise<void> {
  await assertPasswordAllowed(ctx, newPassword);
  const userId = await repo.consumeEmailToken(ctx.db, "reset_password", sha256(token));
  if (!userId)
    throw new AppError("INVALID_TOKEN", 400, "This reset link is invalid or has expired");
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(ctx.db, async (tx) => {
    await repo.setPasswordHash(tx, userId, passwordHash);
    await repo.markEmailVerified(tx, userId); // they proved control of the inbox
    await repo.revokeAllForUser(tx, userId); // sign out everywhere
  });
}

// ---------------------------------------------------------------- sessions

export async function issueSession(
  ctx: AuthContext,
  user: repo.UserRow,
  meta: ClientMeta,
  opts: { mfaVerified?: boolean; familyId?: string; sessionId?: string } = {},
): Promise<SessionIssued> {
  const me = await repo.getMe(ctx.db, user.id);
  if (!me) throw new AppError("UNAUTHENTICATED", 401, "Account not found");

  const sessionId = opts.sessionId ?? newId();
  const mfa = opts.mfaVerified ?? false;
  const refreshToken = randomToken();
  const refreshExpiresAt = new Date(Date.now() + ctx.env.REFRESH_TTL_DAYS * DAY_MS);
  await repo.createSession(ctx.db, {
    id: sessionId,
    userId: user.id,
    familyId: opts.familyId ?? newId(),
    tokenHash: sha256(refreshToken),
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    ip: meta.ip,
    mfaVerified: mfa,
    expiresAt: refreshExpiresAt,
  });
  const accessToken = await signAccessToken(
    ctx.keys,
    { userId: user.id, role: user.role, sessionId, mfa },
    ctx.env.JWT_ACCESS_TTL_SECONDS,
  );
  return { accessToken, user: me, refreshToken, refreshExpiresAt };
}

/**
 * Password login. Per-IP+email rate limit and per-account lockout apply first. If the account has a
 * second factor the result is an MFA challenge instead of a session.
 */
export async function login(
  ctx: AuthContext,
  input: LoginInput,
  meta: ClientMeta,
): Promise<LoginOutcome> {
  await ctx.limiter.enforce(
    `login:${meta.ip ?? "?"}:${input.email}`,
    ctx.env.RL_LOGIN_PER_10MIN,
    600,
    "login attempts",
  );
  await ctx.lockout.assertNotLocked(input.email);

  const user = await repo.findUserByEmail(ctx.db, input.email);
  if (!user?.passwordHash) {
    await verifyDummy(input.password);
    await ctx.lockout.recordFailure(input.email);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await ctx.lockout.recordFailure(input.email);
    throw invalidCredentials();
  }
  if (!canSignIn(user.status)) throw new AppError("FORBIDDEN", 403, "This account is not active");

  const me = await repo.getMe(ctx.db, user.id);
  if (me?.twoFactorEnabled) {
    // password was right; the lockout counter is cleared only once the second factor passes
    return {
      kind: "mfa",
      body: { mfaRequired: true, mfaToken: await signMfaToken(ctx.keys, user.id) },
    };
  }
  await ctx.lockout.recordSuccess(input.email);
  await repo.touchLogin(ctx.db, user.id);
  return { kind: "session", session: await issueSession(ctx, user, meta) };
}

/**
 * Rotates the refresh token. Presenting an already-rotated (revoked) token means it was stolen or
 * replayed, so the whole family is revoked and the user must sign in again.
 */
export async function refresh(
  ctx: AuthContext,
  rawToken: string | undefined,
  meta: ClientMeta,
): Promise<SessionIssued> {
  if (!rawToken) throw new AppError("UNAUTHENTICATED", 401, "No session");
  const session = await repo.findSessionByHash(ctx.db, sha256(rawToken));
  if (!session) throw new AppError("UNAUTHENTICATED", 401, "Invalid session");

  if (session.revokedAt) {
    await repo.revokeFamily(ctx.db, session.familyId);
    ctx.log.warn({ userId: session.userId }, "refresh token reuse detected; family revoked");
    throw new AppError("UNAUTHENTICATED", 401, "Session expired, please sign in again");
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new AppError("UNAUTHENTICATED", 401, "Session expired, please sign in again");
  }

  const user = await repo.findUserById(ctx.db, session.userId);
  if (!user || !canSignIn(user.status))
    throw new AppError("UNAUTHENTICATED", 401, "Invalid session");

  const nextId = newId();
  const won = await repo.revokeSession(ctx.db, session.id, nextId);
  if (!won) {
    // lost a concurrent rotation: treat like reuse
    await repo.revokeFamily(ctx.db, session.familyId);
    throw new AppError("UNAUTHENTICATED", 401, "Session expired, please sign in again");
  }
  return issueSession(ctx, user, meta, {
    familyId: session.familyId,
    sessionId: nextId,
    mfaVerified: session.mfaVerified,
  });
}

export async function logout(ctx: AuthContext, rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const session = await repo.findSessionByHash(ctx.db, sha256(rawToken));
  if (session) await repo.revokeSession(ctx.db, session.id);
}

export async function logoutAll(ctx: AuthContext, userId: string): Promise<void> {
  await repo.revokeAllForUser(ctx.db, userId);
}
