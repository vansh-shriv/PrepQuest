import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { citext, inet, timestamps } from "./columns.js";

// Identity and accounts (U1). Doc 10 §2.1.

export const userRole = pgEnum("user_role", [
  "user",
  "content_editor",
  "reviewer",
  "moderator",
  "support",
  "admin",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: citext("email").notNull().unique(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordHash: text("password_hash"), // argon2id; null for OAuth-only accounts
    role: userRole("role").notNull().default("user"),
    status: text("status").notNull().default("active"),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("users_status_check", sql`${t.status} IN ('active','suspended','pending_deletion')`),
    index("users_pending_deletion_idx")
      .on(t.deletionRequestedAt)
      .where(sql`${t.deletionRequestedAt} IS NOT NULL`),
  ],
);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  handle: citext("handle").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarKey: text("avatar_key"),
  bio: text("bio"),
  college: text("college"),
  branch: text("branch"),
  gradYear: integer("grad_year"),
  country: text("country"),
  timezone: text("timezone").notNull().default("UTC"),
  links: jsonb("links").$type<Record<string, string>>().notNull().default({}),
  publicProfile: boolean("public_profile").notNull().default(false),
  /** Per-field visibility on the public profile: showBio / showCollege / showStats (default true). */
  privacy: jsonb("privacy").$type<Record<string, boolean>>().notNull().default({}),
  placementDate: date("placement_date"),
  hoursPerDay: jsonb("hours_per_day").$type<Record<string, number>>(),
  targetRoles: text("target_roles").array(),
  targetCompanies: text("target_companies").array(),
  track: text("track"), // sde | fullstack | ml | embedded | data
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  xp: bigint("xp", { mode: "number" }).notNull().default(0),
  level: integer("level").notNull().default(1),
  streakCurrent: integer("streak_current").notNull().default(0),
  streakBest: integer("streak_best").notNull().default(0),
  streakLastActive: date("streak_last_active"),
  streakFreezes: integer("streak_freezes").notNull().default(1),
  ...timestamps,
});

export const userSettings = pgTable(
  "user_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    theme: text("theme").notNull().default("system"),
    readableMode: boolean("readable_mode").notNull().default(false),
    retroCursor: boolean("retro_cursor").notNull().default(true),
    sound: boolean("sound").notNull().default(false),
    reducedMotion: boolean("reduced_motion").notNull().default(false),
    editor: jsonb("editor").$type<Record<string, unknown>>().notNull().default({}),
    shortcuts: jsonb("shortcuts").$type<Record<string, string>>().notNull().default({}),
    hintMode: text("hint_mode").notNull().default("strict"),
    openEditorials: boolean("open_editorials").notNull().default(false),
    defaultLanguage: text("default_language").notNull().default("cpp"),
    notifications: jsonb("notifications").$type<Record<string, unknown>>().notNull().default({}),
    quietHours: jsonb("quiet_hours").$type<Record<string, unknown>>(),
    personalizedCallbacks: boolean("personalized_callbacks").notNull().default(true), // X5
    /** Most spaced-repetition reviews asked per day (D6). */
    reviewCap: smallint("review_cap").notNull().default(5),
    /** Flashcard limits per day (X6): new cards and reviews. */
    flashcardNewPerDay: smallint("flashcard_new_per_day").notNull().default(10),
    flashcardReviewsPerDay: smallint("flashcard_reviews_per_day").notNull().default(60),
    /** Default strictness of code reviews (X3): gentle | strict | pedantic. */
    reviewStrictness: text("review_strictness").notNull().default("strict"),
    ...timestamps,
  },
  (t) => [
    check("user_settings_theme_check", sql`${t.theme} IN ('cream','night','contrast','system')`),
    check("user_settings_hint_mode_check", sql`${t.hintMode} IN ('strict','relaxed')`),
    check(
      "user_settings_review_strictness_check",
      sql`${t.reviewStrictness} IN ('gentle','strict','pedantic')`,
    ),
  ],
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    email: citext("email"),
    ...timestamps,
  },
  (t) => [
    unique("oauth_accounts_provider_user_key").on(t.provider, t.providerUserId),
    index("oauth_accounts_user_idx").on(t.userId),
  ],
);

/** One row per refresh token; rotation links rows in a family. Only the token's SHA-256 is stored. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    ip: inet("ip"),
    /** True when this session passed a second factor; carried over on refresh. */
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by"),
    ...timestamps,
  },
  (t) => [
    index("auth_sessions_user_idx").on(t.userId, t.revokedAt),
    index("auth_sessions_family_idx").on(t.familyId),
  ],
);

export const emailTokens = pgTable(
  "email_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("email_tokens_kind_check", sql`${t.kind} IN ('verify_email','reset_password')`),
    index("email_tokens_user_idx").on(t.userId, t.kind),
  ],
);

/** TOTP second factor. The secret is AES-GCM encrypted by the app; recovery codes are hashed. */
export const userTotp = pgTable("user_totp", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secretEnc: text("secret_enc").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  /** Last accepted 30 s time step, to reject replay of a code. */
  lastStep: bigint("last_step", { mode: "number" }),
  recoveryCodes: jsonb("recovery_codes")
    .$type<Array<{ hash: string; usedAt: string | null }>>()
    .notNull()
    .default([]),
  ...timestamps,
});
