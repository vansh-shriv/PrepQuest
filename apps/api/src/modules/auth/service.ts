import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { newId, withTransaction } from "@prepquest/db";
import {
  AppError,
  type LoginInput,
  type LoginResponse,
  type ServerEnv,
  type SignupInput,
} from "@prepquest/shared";
import { randomToken, sha256 } from "../../lib/crypto.js";
import type { Mailer } from "../../lib/mailer.js";
import { signAccessToken } from "./access-token.js";
import type { JwtKeys } from "./keys.js";
import { hashPassword, verifyDummy, verifyPassword } from "./password.js";
import * as repo from "./repo.js";

export interface AuthContext {
  pool: pg.Pool;
  env: ServerEnv;
  keys: JwtKeys;
  mailer: Mailer;
  log: FastifyBaseLogger;
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

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const invalidCredentials = () =>
  new AppError("UNAUTHENTICATED", 401, "Incorrect email or password");

function constraintOf(err: unknown): string | undefined {
  const e = err as { code?: string; constraint?: string };
  return e.code === "23505" ? e.constraint : undefined;
}

// ---------------------------------------------------------------- signup / email

export async function signup(ctx: AuthContext, input: SignupInput): Promise<void> {
  const userId = newId();
  const passwordHash = await hashPassword(input.password);
  try {
    await withTransaction(ctx.pool, async (tx) => {
      await repo.insertUser(tx, { id: userId, email: input.email, passwordHash });
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
  await sendVerificationEmail(ctx, userId, input.email, input.displayName);
}

async function sendVerificationEmail(
  ctx: AuthContext,
  userId: string,
  email: string,
  displayName: string,
): Promise<void> {
  const token = randomToken();
  await repo.createEmailToken(ctx.pool, {
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
    text: `Hi ${displayName},\n\nQuest accepted! Confirm your email to unlock everything:\n${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Hi ${escapeHtml(displayName)},</p><p>Quest accepted! Confirm your email to unlock everything:</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

/** Email delivery must never break the request that triggered it. */
async function safeSend(ctx: AuthContext, message: Parameters<Mailer["send"]>[0]): Promise<void> {
  try {
    await ctx.mailer.send(message);
  } catch (err) {
    ctx.log.error({ err, to: "[redacted]" }, "failed to send email");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export async function verifyEmail(ctx: AuthContext, token: string): Promise<void> {
  const userId = await repo.consumeEmailToken(ctx.pool, "verify_email", sha256(token));
  if (!userId) {
    throw new AppError("INVALID_TOKEN", 400, "This verification link is invalid or has expired");
  }
  await repo.markEmailVerified(ctx.pool, userId);
}

export async function resendVerification(ctx: AuthContext, userId: string): Promise<void> {
  const user = await repo.findUserById(ctx.pool, userId);
  if (!user || user.email_verified_at) return;
  const me = await repo.getMe(ctx.pool, userId);
  await sendVerificationEmail(ctx, userId, user.email, me?.profile.displayName ?? "there");
}

// ---------------------------------------------------------------- password reset

/** Always resolves quietly so callers can't probe which emails exist. */
export async function forgotPassword(ctx: AuthContext, email: string): Promise<void> {
  const user = await repo.findUserByEmail(ctx.pool, email);
  if (!user || user.status !== "active") return;
  const token = randomToken();
  await repo.createEmailToken(ctx.pool, {
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
  const userId = await repo.consumeEmailToken(ctx.pool, "reset_password", sha256(token));
  if (!userId)
    throw new AppError("INVALID_TOKEN", 400, "This reset link is invalid or has expired");
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(ctx.pool, async (tx) => {
    await repo.setPasswordHash(tx, userId, passwordHash);
    await repo.markEmailVerified(tx, userId); // they proved control of the inbox
    await repo.revokeAllForUser(tx, userId); // sign out everywhere
  });
}

// ---------------------------------------------------------------- sessions

async function issueSession(
  ctx: AuthContext,
  user: repo.UserRow,
  meta: ClientMeta,
  familyId = newId(),
  sessionId = newId(),
): Promise<SessionIssued> {
  const me = await repo.getMe(ctx.pool, user.id);
  if (!me) throw new AppError("UNAUTHENTICATED", 401, "Account not found");

  const refreshToken = randomToken();
  const refreshExpiresAt = new Date(Date.now() + ctx.env.REFRESH_TTL_DAYS * DAY_MS);
  await repo.createSession(ctx.pool, {
    id: sessionId,
    userId: user.id,
    familyId,
    tokenHash: sha256(refreshToken),
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    ip: meta.ip,
    expiresAt: refreshExpiresAt,
  });
  const accessToken = await signAccessToken(
    ctx.keys,
    { userId: user.id, role: user.role, sessionId },
    ctx.env.JWT_ACCESS_TTL_SECONDS,
  );
  return { accessToken, user: me, refreshToken, refreshExpiresAt };
}

export async function login(
  ctx: AuthContext,
  input: LoginInput,
  meta: ClientMeta,
): Promise<SessionIssued> {
  const user = await repo.findUserByEmail(ctx.pool, input.email);
  if (!user?.password_hash) {
    await verifyDummy(input.password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.password_hash, input.password))) throw invalidCredentials();
  if (user.status !== "active") {
    throw new AppError("FORBIDDEN", 403, "This account is not active");
  }
  await repo.touchLogin(ctx.pool, user.id);
  return issueSession(ctx, user, meta);
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
  const session = await repo.findSessionByHash(ctx.pool, sha256(rawToken));
  if (!session) throw new AppError("UNAUTHENTICATED", 401, "Invalid session");

  if (session.revoked_at) {
    await repo.revokeFamily(ctx.pool, session.family_id);
    ctx.log.warn({ userId: session.user_id }, "refresh token reuse detected; family revoked");
    throw new AppError("UNAUTHENTICATED", 401, "Session expired, please sign in again");
  }
  if (session.expires_at.getTime() <= Date.now()) {
    throw new AppError("UNAUTHENTICATED", 401, "Session expired, please sign in again");
  }

  const user = await repo.findUserById(ctx.pool, session.user_id);
  if (!user || user.status !== "active")
    throw new AppError("UNAUTHENTICATED", 401, "Invalid session");

  const nextId = newId();
  const won = await repo.revokeSession(ctx.pool, session.id, nextId);
  if (!won) {
    // lost a concurrent rotation: treat like reuse
    await repo.revokeFamily(ctx.pool, session.family_id);
    throw new AppError("UNAUTHENTICATED", 401, "Session expired, please sign in again");
  }
  return issueSession(ctx, user, meta, session.family_id, nextId);
}

export async function logout(ctx: AuthContext, rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const session = await repo.findSessionByHash(ctx.pool, sha256(rawToken));
  if (session) await repo.revokeSession(ctx.pool, session.id);
}

export async function logoutAll(ctx: AuthContext, userId: string): Promise<void> {
  await repo.revokeAllForUser(ctx.pool, userId);
}
