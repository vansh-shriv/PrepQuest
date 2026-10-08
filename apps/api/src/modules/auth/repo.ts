import type { Db } from "@prepquest/db";
import type { MeResponse, SessionInfo, UserRole } from "@prepquest/shared";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  role: UserRole;
  status: string;
  email_verified_at: Date | null;
}

export async function insertUser(
  db: Db,
  u: { id: string; email: string; passwordHash: string },
): Promise<void> {
  await db.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)", [
    u.id,
    u.email,
    u.passwordHash,
  ]);
}

export async function insertProfile(
  db: Db,
  p: { userId: string; handle: string; displayName: string },
): Promise<void> {
  await db.query("INSERT INTO profiles (user_id, handle, display_name) VALUES ($1, $2, $3)", [
    p.userId,
    p.handle,
    p.displayName,
  ]);
  await db.query("INSERT INTO user_settings (user_id) VALUES ($1)", [p.userId]);
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | undefined> {
  const res = await db.query<UserRow>(
    "SELECT id, email, password_hash, role, status, email_verified_at FROM users WHERE email = $1",
    [email],
  );
  return res.rows[0];
}

export async function findUserById(db: Db, id: string): Promise<UserRow | undefined> {
  const res = await db.query<UserRow>(
    "SELECT id, email, password_hash, role, status, email_verified_at FROM users WHERE id = $1",
    [id],
  );
  return res.rows[0];
}

export async function touchLogin(db: Db, userId: string): Promise<void> {
  await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
}

// ---- sessions (refresh token families) ----

export interface SessionRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export async function createSession(
  db: Db,
  s: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    userAgent: string | null;
    ip: string | null;
    expiresAt: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO auth_sessions (id, user_id, family_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [s.id, s.userId, s.familyId, s.tokenHash, s.userAgent, s.ip, s.expiresAt],
  );
}

export async function findSessionByHash(
  db: Db,
  tokenHash: string,
): Promise<SessionRow | undefined> {
  const res = await db.query<SessionRow>(
    "SELECT id, user_id, family_id, expires_at, revoked_at FROM auth_sessions WHERE token_hash = $1",
    [tokenHash],
  );
  return res.rows[0];
}

/** Revokes a session if still active. Returns false if it was already revoked (lost a rotation race). */
export async function revokeSession(db: Db, id: string, replacedBy?: string): Promise<boolean> {
  const res = await db.query(
    "UPDATE auth_sessions SET revoked_at = now(), replaced_by = $2 WHERE id = $1 AND revoked_at IS NULL",
    [id, replacedBy ?? null],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function revokeFamily(db: Db, familyId: string): Promise<void> {
  await db.query(
    "UPDATE auth_sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL",
    [familyId],
  );
}

export async function revokeAllForUser(db: Db, userId: string): Promise<void> {
  await db.query(
    "UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
}

/** Revokes one session owned by the user. Returns false when it doesn't exist or isn't theirs. */
export async function revokeUserSession(db: Db, userId: string, id: string): Promise<boolean> {
  const res = await db.query(
    "UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    [id, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listActiveSessions(
  db: Db,
  userId: string,
  currentId: string,
): Promise<SessionInfo[]> {
  const res = await db.query<{
    id: string;
    user_agent: string | null;
    ip: string | null;
    created_at: Date;
    expires_at: Date;
  }>(
    `SELECT id, user_agent, host(ip) AS ip, created_at, expires_at FROM auth_sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
    [userId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    userAgent: r.user_agent,
    ip: r.ip,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
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
  await db.query(
    "UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL",
    [t.userId, t.kind],
  );
  await db.query(
    "INSERT INTO email_tokens (id, user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)",
    [t.id, t.userId, t.kind, t.tokenHash, t.expiresAt],
  );
}

/** Atomically consumes a valid, unused, unexpired token. Returns the owning user id, or undefined. */
export async function consumeEmailToken(
  db: Db,
  kind: EmailTokenKind,
  tokenHash: string,
): Promise<string | undefined> {
  const res = await db.query<{ user_id: string }>(
    `UPDATE email_tokens SET used_at = now()
     WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [tokenHash, kind],
  );
  return res.rows[0]?.user_id;
}

export async function markEmailVerified(db: Db, userId: string): Promise<void> {
  await db.query(
    "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1",
    [userId],
  );
}

export async function setPasswordHash(db: Db, userId: string, passwordHash: string): Promise<void> {
  await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, passwordHash]);
}

// ---- me ----

interface MeRow {
  id: string;
  email: string;
  email_verified_at: Date | null;
  role: UserRole;
  handle: string;
  display_name: string;
  bio: string | null;
  college: string | null;
  branch: string | null;
  grad_year: number | null;
  timezone: string;
  xp: string;
  level: number;
  streak_current: number;
  streak_best: number;
  theme: MeResponse["settings"]["theme"];
  readable_mode: boolean;
  retro_cursor: boolean;
  sound: boolean;
  reduced_motion: boolean;
  hint_mode: "strict" | "relaxed";
  default_language: string;
}

export async function getMe(db: Db, userId: string): Promise<MeResponse | undefined> {
  const res = await db.query<MeRow>(
    `SELECT u.id, u.email, u.email_verified_at, u.role,
            p.handle, p.display_name, p.bio, p.college, p.branch, p.grad_year, p.timezone,
            p.xp, p.level, p.streak_current, p.streak_best,
            s.theme, s.readable_mode, s.retro_cursor, s.sound, s.reduced_motion, s.hint_mode, s.default_language
     FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN user_settings s ON s.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  const r = res.rows[0];
  if (!r) return undefined;
  return {
    id: r.id,
    email: r.email,
    emailVerified: r.email_verified_at !== null,
    role: r.role,
    profile: {
      handle: r.handle,
      displayName: r.display_name,
      bio: r.bio,
      college: r.college,
      branch: r.branch,
      gradYear: r.grad_year,
      timezone: r.timezone,
      xp: Number(r.xp),
      level: r.level,
      streakCurrent: r.streak_current,
      streakBest: r.streak_best,
    },
    settings: {
      theme: r.theme,
      readableMode: r.readable_mode,
      retroCursor: r.retro_cursor,
      sound: r.sound,
      reducedMotion: r.reduced_motion,
      hintMode: r.hint_mode,
      defaultLanguage: r.default_language,
    },
  };
}

/** Applies a partial update using a fixed column whitelist (never interpolates caller keys). */
export async function updateColumns(
  db: Db,
  table: "profiles" | "user_settings",
  userId: string,
  columns: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(columns);
  if (entries.length === 0) return;
  const sets = entries.map(([col], i) => `${col} = $${i + 2}`).join(", ");
  await db.query(`UPDATE ${table} SET ${sets} WHERE user_id = $1`, [
    userId,
    ...entries.map(([, v]) => v),
  ]);
}
