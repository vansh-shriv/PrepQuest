import { and, eq, lte } from "drizzle-orm";
import {
  authSessions,
  codeDrafts,
  customTests,
  oauthAccounts,
  profiles,
  submissions,
  userProblemState,
  userSettings,
  users,
  type Database,
  type Db,
} from "@prepquest/db";
import { AppError, type PrepSettings, type PublicProfile } from "@prepquest/shared";
import { acceptTotp } from "../auth/mfa.js";
import { verifyPassword } from "../auth/password.js";
import * as repo from "../auth/repo.js";
import { escapeHtml, safeSend, type AuthContext } from "../auth/service.js";

export const DELETION_GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- prep settings

export async function getPrep(db: Db, userId: string): Promise<PrepSettings> {
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) throw new AppError("NOT_FOUND", 404, "Profile not found");
  return {
    placementDate: p.placementDate,
    hoursPerDay: p.hoursPerDay as PrepSettings["hoursPerDay"],
    targetRoles: p.targetRoles ?? [],
    targetCompanies: p.targetCompanies ?? [],
    track: p.track as PrepSettings["track"],
  };
}

export async function putPrep(db: Db, userId: string, prep: PrepSettings): Promise<PrepSettings> {
  await db.update(profiles).set(prep).where(eq(profiles.userId, userId));
  return getPrep(db, userId);
}

// ---------------------------------------------------------------- public profile

/** Privacy-filtered profile for /u/:handle. Private profiles look exactly like missing ones. */
export async function getPublicProfile(db: Db, handle: string): Promise<PublicProfile> {
  const [p] = await db
    .select({ profile: profiles, status: users.status })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.handle, handle))
    .limit(1);
  if (!p || !p.profile.publicProfile || p.status !== "active") {
    throw new AppError("NOT_FOUND", 404, "Profile not found");
  }
  const { profile } = p;
  const show = (key: string) => profile.privacy[key] ?? true;
  return {
    handle: profile.handle,
    displayName: profile.displayName,
    avatarKey: profile.avatarKey,
    bio: show("showBio") ? profile.bio : null,
    college: show("showCollege") ? profile.college : null,
    joinedAt: profile.createdAt.toISOString(),
    stats: show("showStats")
      ? {
          xp: profile.xp,
          level: profile.level,
          streakCurrent: profile.streakCurrent,
          streakBest: profile.streakBest,
        }
      : null,
  };
}

// ---------------------------------------------------------------- data export

/** Everything we hold about the user, as JSON. Secrets (hashes, TOTP seed) are deliberately excluded. */
export async function exportData(db: Db, userId: string) {
  const [account] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) throw new AppError("NOT_FOUND", 404, "Account not found");

  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  const linkedAccounts = await db
    .select({
      provider: oauthAccounts.provider,
      email: oauthAccounts.email,
      createdAt: oauthAccounts.createdAt,
    })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.userId, userId));
  const sessions = await db
    .select({
      userAgent: authSessions.userAgent,
      createdAt: authSessions.createdAt,
      expiresAt: authSessions.expiresAt,
      revokedAt: authSessions.revokedAt,
    })
    .from(authSessions)
    .where(eq(authSessions.userId, userId));

  return {
    exportedAt: new Date().toISOString(),
    format: "prepquest-export-v1",
    account,
    profile,
    settings,
    linkedAccounts,
    sessions,
    submissions: await db.select().from(submissions).where(eq(submissions.userId, userId)),
    codeDrafts: await db.select().from(codeDrafts).where(eq(codeDrafts.userId, userId)),
    customTests: await db.select().from(customTests).where(eq(customTests.userId, userId)),
    problemProgress: await db
      .select()
      .from(userProblemState)
      .where(eq(userProblemState.userId, userId)),
  };
}

// ---------------------------------------------------------------- deletion

/**
 * Schedules deletion after a 14-day grace period and signs the user out everywhere. Re-authentication:
 * the password when the account has one, plus a current 2FA code when 2FA is on. Signing in during the
 * grace period lets the user cancel.
 */
export async function requestDeletion(
  ctx: AuthContext,
  userId: string,
  input: { password?: string | undefined; code?: string | undefined },
): Promise<Date> {
  const me = await repo.getMe(ctx.db, userId);
  const user = await repo.findUserById(ctx.db, userId);
  if (!me || !user) throw new AppError("UNAUTHENTICATED", 401, "Account not found");

  if (user.passwordHash) {
    if (!input.password || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new AppError("UNAUTHENTICATED", 401, "Incorrect password");
    }
  }
  if (me.twoFactorEnabled) {
    await ctx.mfaGuard.assert(userId);
    if (!input.code || !(await acceptTotp(ctx, userId, input.code))) {
      await ctx.mfaGuard.fail(userId);
      throw new AppError("UNAUTHENTICATED", 401, "That code didn't work");
    }
    await ctx.mfaGuard.clear(userId);
  }

  const requestedAt = user.deletionRequestedAt ?? new Date();
  await ctx.db
    .update(users)
    .set({ status: "pending_deletion", deletionRequestedAt: requestedAt })
    .where(eq(users.id, userId));
  await repo.revokeAllForUser(ctx.db, userId);

  const purgeOn = new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * DAY_MS);
  await safeSend(ctx, {
    to: user.email,
    subject: "Your PrepQuest account is scheduled for deletion",
    text: `Your account and all its data will be permanently deleted on ${purgeOn.toUTCString()}.\n\nChanged your mind? Log in before then and choose "Cancel deletion".`,
    html: `<p>Your account and all its data will be permanently deleted on <b>${escapeHtml(purgeOn.toUTCString())}</b>.</p><p>Changed your mind? Log in before then and choose "Cancel deletion".</p>`,
  });
  return purgeOn;
}

export async function cancelDeletion(db: Db, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ status: "active", deletionRequestedAt: null })
    .where(and(eq(users.id, userId), eq(users.status, "pending_deletion")));
}

/**
 * Hard-deletes accounts whose grace period has ended. Foreign keys cascade to every user-owned table;
 * authored content (problems, sheets) keeps its rows with the author cleared. Returns the count.
 * Object-storage files (resumes, audio) are purged here too once those features exist.
 */
export async function purgeDueAccounts(
  db: Database,
  now = new Date(),
  graceDays = DELETION_GRACE_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - graceDays * DAY_MS);
  const deleted = await db
    .delete(users)
    .where(and(eq(users.status, "pending_deletion"), lte(users.deletionRequestedAt, cutoff)))
    .returning({ id: users.id });
  return deleted.length;
}
