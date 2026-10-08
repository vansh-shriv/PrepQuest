import { randomInt } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { userTotp, withTransaction } from "@prepquest/db";
import { AppError } from "@prepquest/shared";
import { sha256 } from "../../lib/crypto.js";
import { generateSecret, otpauthUrl, verifyTotp } from "../../lib/totp.js";
import { verifyMfaToken } from "./access-token.js";
import * as repo from "./repo.js";
import {
  issueSession,
  canSignIn,
  type AuthContext,
  type ClientMeta,
  type SessionIssued,
} from "./service.js";
import { verifyPassword } from "./password.js";

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no look-alikes (I, L, O, 0, 1)
const RECOVERY_COUNT = 10;
const ISSUER = "PrepQuest";

const badCode = () => new AppError("UNAUTHENTICATED", 401, "That code didn't work");

/** Recovery codes are shown as XXXXX-XXXXX; matching ignores case and the dash. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

function newRecoveryCode(): string {
  const chars = Array.from(
    { length: 10 },
    () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
  );
  return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

// ---------------------------------------------------------------- setup

export interface MfaSetup {
  secret: string;
  otpauthUrl: string;
}

/** Starts enrolment: stores an unconfirmed encrypted secret. Re-running replaces an unconfirmed one. */
export async function beginSetup(ctx: AuthContext, userId: string): Promise<MfaSetup> {
  const me = await repo.getMe(ctx.db, userId);
  if (!me) throw new AppError("UNAUTHENTICATED", 401, "Account not found");
  if (me.twoFactorEnabled)
    throw new AppError("CONFLICT", 409, "Two-factor authentication is already on");

  const secret = generateSecret();
  const values = {
    secretEnc: ctx.box.encrypt(secret),
    confirmedAt: null,
    lastStep: null,
    recoveryCodes: [],
  };
  await ctx.db
    .insert(userTotp)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userTotp.userId, set: values });
  return { secret, otpauthUrl: otpauthUrl(me.email, ISSUER, secret) };
}

/** Confirms enrolment with a first code, turns 2FA on and returns the recovery codes (shown once). */
export async function confirmSetup(
  ctx: AuthContext,
  userId: string,
  code: string,
): Promise<string[]> {
  await ctx.mfaGuard.assert(userId);
  const [row] = await ctx.db.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1);
  if (!row || row.confirmedAt) throw new AppError("CONFLICT", 409, "Start setup first");

  const step = verifyTotp(ctx.box.decrypt(row.secretEnc), code);
  if (step === null) {
    await ctx.mfaGuard.fail(userId);
    throw badCode();
  }
  await ctx.mfaGuard.clear(userId);

  const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
  await ctx.db
    .update(userTotp)
    .set({
      confirmedAt: new Date(),
      lastStep: step,
      recoveryCodes: codes.map((c) => ({ hash: sha256(normalizeRecoveryCode(c)), usedAt: null })),
    })
    .where(eq(userTotp.userId, userId));
  return codes;
}

// ---------------------------------------------------------------- verification helpers

/** Accepts a code only if its time step is newer than the last one used (atomic, replay-safe). */
export async function acceptTotp(ctx: AuthContext, userId: string, code: string): Promise<boolean> {
  const [row] = await ctx.db.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1);
  if (!row?.confirmedAt) return false;
  const step = verifyTotp(ctx.box.decrypt(row.secretEnc), code, { lastStep: row.lastStep });
  if (step === null) return false;
  const advanced = await ctx.db
    .update(userTotp)
    .set({ lastStep: step })
    .where(
      and(eq(userTotp.userId, userId), or(isNull(userTotp.lastStep), lt(userTotp.lastStep, step))),
    )
    .returning({ userId: userTotp.userId });
  return advanced.length > 0;
}

/** Burns one unused recovery code. */
async function acceptRecoveryCode(
  ctx: AuthContext,
  userId: string,
  code: string,
): Promise<boolean> {
  const hash = sha256(normalizeRecoveryCode(code));
  return withTransaction(ctx.db, async (tx) => {
    const [row] = await tx
      .select()
      .from(userTotp)
      .where(eq(userTotp.userId, userId))
      .for("update")
      .limit(1);
    if (!row?.confirmedAt) return false;
    const idx = row.recoveryCodes.findIndex((c) => c.hash === hash && c.usedAt === null);
    if (idx === -1) return false;
    const next = row.recoveryCodes.map((c, i) =>
      i === idx ? { ...c, usedAt: new Date().toISOString() } : c,
    );
    await tx.update(userTotp).set({ recoveryCodes: next }).where(eq(userTotp.userId, userId));
    return true;
  });
}

// ---------------------------------------------------------------- login + disable

/** Second step of login: exchanges the MFA challenge token plus a code for a full session. */
export async function completeLogin(
  ctx: AuthContext,
  input: { mfaToken: string; code?: string | undefined; recoveryCode?: string | undefined },
  meta: ClientMeta,
): Promise<SessionIssued> {
  const userId = await verifyMfaToken(ctx.keys, input.mfaToken);
  await ctx.mfaGuard.assert(userId);

  const user = await repo.findUserById(ctx.db, userId);
  if (!user || !canSignIn(user.status)) throw badCode();

  const ok = input.code
    ? await acceptTotp(ctx, userId, input.code)
    : input.recoveryCode
      ? await acceptRecoveryCode(ctx, userId, input.recoveryCode)
      : false;
  if (!ok) {
    await ctx.mfaGuard.fail(userId);
    throw badCode();
  }

  await ctx.mfaGuard.clear(userId);
  await ctx.lockout.recordSuccess(user.email);
  await repo.touchLogin(ctx.db, userId);
  return issueSession(ctx, user, meta, { mfaVerified: true });
}

/** Turns 2FA off. Needs a current code, and the password when the account has one. */
export async function disable(
  ctx: AuthContext,
  userId: string,
  input: { password?: string | undefined; code: string },
): Promise<void> {
  await ctx.mfaGuard.assert(userId);
  const user = await repo.findUserById(ctx.db, userId);
  if (!user) throw new AppError("UNAUTHENTICATED", 401, "Account not found");
  if (user.passwordHash) {
    if (!input.password || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new AppError("UNAUTHENTICATED", 401, "Incorrect password");
    }
  }
  if (!(await acceptTotp(ctx, userId, input.code))) {
    await ctx.mfaGuard.fail(userId);
    throw badCode();
  }
  await ctx.mfaGuard.clear(userId);
  await ctx.db.delete(userTotp).where(eq(userTotp.userId, userId));
}
