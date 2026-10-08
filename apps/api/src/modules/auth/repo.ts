import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  authSessions,
  emailTokens,
  profiles,
  userSettings,
  userTotp,
  users,
  type Db,
} from "@prepquest/db";
import type { MeResponse, ProfileUpdate, SessionInfo, SettingsUpdate } from "@prepquest/shared";

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof authSessions.$inferSelect;

// ---- users ----

export async function insertUser(
  db: Db,
  u: { id: string; email: string; passwordHash: string | null; emailVerified?: boolean },
): Promise<void> {
  await db.insert(users).values({
    id: u.id,
    email: u.email,
    passwordHash: u.passwordHash,
    emailVerifiedAt: u.emailVerified ? new Date() : null,
  });
}

/** Creates the profile and default settings rows for a new user. */
export async function insertProfile(
  db: Db,
  p: { userId: string; handle: string; displayName: string },
): Promise<void> {
  await db
    .insert(profiles)
    .values({ userId: p.userId, handle: p.handle, displayName: p.displayName });
  await db.insert(userSettings).values({ userId: p.userId });
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export async function handleExists(db: Db, handle: string): Promise<boolean> {
  const [row] = await db
    .select({ id: profiles.userId })
    .from(profiles)
    .where(eq(profiles.handle, handle))
    .limit(1);
  return Boolean(row);
}

export async function touchLogin(db: Db, userId: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

export async function markEmailVerified(db: Db, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ emailVerifiedAt: sql`COALESCE(${users.emailVerifiedAt}, now())` })
    .where(eq(users.id, userId));
}

export async function setPasswordHash(
  db: Db,
  userId: string,
  passwordHash: string | null,
): Promise<void> {
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

// ---- sessions (refresh token families) ----

export async function createSession(
  db: Db,
  s: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    userAgent: string | null;
    ip: string | null;
    mfaVerified: boolean;
    expiresAt: Date;
  },
): Promise<void> {
  await db.insert(authSessions).values(s);
}

export async function findSessionByHash(
  db: Db,
  tokenHash: string,
): Promise<SessionRow | undefined> {
  const [row] = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/** Revokes a session if still active. Returns false if it was already revoked (lost a rotation race). */
export async function revokeSession(db: Db, id: string, replacedBy?: string): Promise<boolean> {
  const rows = await db
    .update(authSessions)
    .set({ revokedAt: new Date(), replacedBy: replacedBy ?? null })
    .where(and(eq(authSessions.id, id), isNull(authSessions.revokedAt)))
    .returning({ id: authSessions.id });
  return rows.length > 0;
}

export async function revokeFamily(db: Db, familyId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)));
}

export async function revokeAllForUser(db: Db, userId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
}

/** Revokes one session owned by the user. Returns false when it doesn't exist or isn't theirs. */
export async function revokeUserSession(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(authSessions.id, id), eq(authSessions.userId, userId), isNull(authSessions.revokedAt)),
    )
    .returning({ id: authSessions.id });
  return rows.length > 0;
}

export async function listActiveSessions(
  db: Db,
  userId: string,
  currentId: string,
): Promise<SessionInfo[]> {
  const rows = await db
    .select({
      id: authSessions.id,
      userAgent: authSessions.userAgent,
      ip: sql<string | null>`host(${authSessions.ip})`,
      createdAt: authSessions.createdAt,
      expiresAt: authSessions.expiresAt,
    })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(authSessions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    userAgent: r.userAgent,
    ip: r.ip,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    current: r.id === currentId,
  }));
}

// ---- email tokens ----

export type EmailTokenKind = "verify_email" | "reset_password";

export async function createEmailToken(
  db: Db,
  t: { id: string; userId: string; kind: EmailTokenKind; tokenHash: string; expiresAt: Date },
): Promise<void> {
  // one live token per kind: invalidate older unused ones
  await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.userId, t.userId),
        eq(emailTokens.kind, t.kind),
        isNull(emailTokens.usedAt),
      ),
    );
  await db.insert(emailTokens).values(t);
}

/** Atomically consumes a valid, unused, unexpired token. Returns the owning user id, or undefined. */
export async function consumeEmailToken(
  db: Db,
  kind: EmailTokenKind,
  tokenHash: string,
): Promise<string | undefined> {
  const [row] = await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, tokenHash),
        eq(emailTokens.kind, kind),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: emailTokens.userId });
  return row?.userId ?? undefined;
}

// ---- me ----

export async function getMe(db: Db, userId: string): Promise<MeResponse | undefined> {
  const [r] = await db
    .select({
      user: users,
      profile: profiles,
      settings: userSettings,
      totpConfirmedAt: userTotp.confirmedAt,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .leftJoin(userTotp, eq(userTotp.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!r) return undefined;

  const { user, profile, settings } = r;
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    role: user.role,
    twoFactorEnabled: r.totpConfirmedAt !== null,
    hasPassword: user.passwordHash !== null,
    deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    profile: {
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      college: profile.college,
      branch: profile.branch,
      gradYear: profile.gradYear,
      timezone: profile.timezone,
      xp: profile.xp,
      level: profile.level,
      streakCurrent: profile.streakCurrent,
      streakBest: profile.streakBest,
      publicProfile: profile.publicProfile,
      privacy: {
        showBio: profile.privacy.showBio ?? true,
        showCollege: profile.privacy.showCollege ?? true,
        showStats: profile.privacy.showStats ?? true,
      },
    },
    settings: {
      theme: settings.theme as MeResponse["settings"]["theme"],
      readableMode: settings.readableMode,
      retroCursor: settings.retroCursor,
      sound: settings.sound,
      reducedMotion: settings.reducedMotion,
      hintMode: settings.hintMode as "strict" | "relaxed",
      defaultLanguage: settings.defaultLanguage,
    },
  };
}

export async function updateProfile(db: Db, userId: string, update: ProfileUpdate): Promise<void> {
  const { privacy, ...rest } = update;
  const set = {
    ...rest,
    // merge privacy toggles instead of replacing the whole object
    ...(privacy ? { privacy: sql`${profiles.privacy} || ${JSON.stringify(privacy)}::jsonb` } : {}),
  };
  if (Object.keys(set).length === 0) return;
  await db.update(profiles).set(set).where(eq(profiles.userId, userId));
}

export async function updateSettings(
  db: Db,
  userId: string,
  update: SettingsUpdate,
): Promise<void> {
  if (Object.keys(update).length === 0) return;
  await db.update(userSettings).set(update).where(eq(userSettings.userId, userId));
}
