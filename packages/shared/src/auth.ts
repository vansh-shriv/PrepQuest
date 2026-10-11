import { z } from "zod";

/** Auth and profile contracts shared by the API and web forms (doc 11 §2). */

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

// Policy (doc 14): min 10 chars, no composition rules. Breach check is a later hardening step.
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters");

export const handleSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_]{3,20}$/, "3-20 letters, numbers or underscores");

export const displayNameSchema = z.string().trim().min(1, "Required").max(50);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  handle: handleSchema,
  displayName: displayNameSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Required").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const THEME_CHOICES = ["cream", "night", "contrast", "system"] as const;

export const profileUpdateSchema = z
  .object({
    displayName: displayNameSchema,
    bio: z.string().trim().max(500).nullable(),
    college: z.string().trim().max(120).nullable(),
    branch: z.string().trim().max(120).nullable(),
    gradYear: z.number().int().min(2000).max(2100).nullable(),
    timezone: z.string().trim().min(1).max(64),
    publicProfile: z.boolean(),
    privacy: z
      .object({ showBio: z.boolean(), showCollege: z.boolean(), showStats: z.boolean() })
      .partial()
      .strict(),
  })
  .partial()
  .strict();
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const TRACKS = ["sde", "fullstack", "ml", "embedded", "data"] as const;

/** Prep settings (doc 11 GET/PUT /me/prep). PUT replaces all fields. */
export const prepSchema = z
  .object({
    placementDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .nullable(),
    hoursPerDay: z
      .partialRecord(
        z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
        z.number().min(0).max(16),
      )
      .nullable(),
    targetRoles: z.array(z.string().trim().min(1).max(60)).max(10),
    targetCompanies: z.array(z.string().trim().min(1).max(60)).max(20),
    track: z.enum(TRACKS).nullable(),
  })
  .strict();
export type PrepSettings = z.infer<typeof prepSchema>;

// ---- second factor, account deletion ----
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");
export const mfaLoginSchema = z
  .object({
    mfaToken: z.string().min(20).max(2000),
    code: totpCodeSchema.optional(),
    recoveryCode: z.string().trim().min(8).max(32).optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: "Provide a code or a recovery code",
  });
export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(128).optional(),
  code: totpCodeSchema,
});
export const deleteAccountSchema = z.object({
  confirm: z.literal("DELETE"),
  password: z.string().min(1).max(128).optional(),
  /** Current 2FA code, required when two-factor authentication is on. */
  code: totpCodeSchema.optional(),
});

export const settingsUpdateSchema = z
  .object({
    theme: z.enum(THEME_CHOICES),
    readableMode: z.boolean(),
    retroCursor: z.boolean(),
    sound: z.boolean(),
    reducedMotion: z.boolean(),
    hintMode: z.enum(["strict", "relaxed"]),
    openEditorials: z.boolean(),
    /** The interviewer may refer back to earlier sessions (X5). */
    personalizedCallbacks: z.boolean(),
    defaultLanguage: z.enum(["cpp", "java", "python"]),
  })
  .partial()
  .strict();
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export const USER_ROLES = [
  "user",
  "content_editor",
  "reviewer",
  "moderator",
  "support",
  "admin",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** The user object returned by login and GET /me. */
export interface MeResponse {
  id: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  profile: {
    handle: string;
    displayName: string;
    bio: string | null;
    college: string | null;
    branch: string | null;
    gradYear: number | null;
    timezone: string;
    xp: number;
    level: number;
    streakCurrent: number;
    streakBest: number;
    publicProfile: boolean;
    privacy: { showBio: boolean; showCollege: boolean; showStats: boolean };
  };
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  /** ISO time the account was scheduled for deletion, or null. */
  deletionRequestedAt: string | null;
  settings: {
    theme: (typeof THEME_CHOICES)[number];
    readableMode: boolean;
    retroCursor: boolean;
    sound: boolean;
    reducedMotion: boolean;
    hintMode: "strict" | "relaxed";
    openEditorials: boolean;
    personalizedCallbacks: boolean;
    defaultLanguage: string;
  };
}

export interface LoginResponse {
  accessToken: string;
  user: MeResponse;
}

/** Login for an account with 2FA: finish with POST /auth/2fa/login. */
export interface MfaRequiredResponse {
  mfaRequired: true;
  mfaToken: string;
}

export interface PublicProfile {
  handle: string;
  displayName: string;
  avatarKey: string | null;
  bio: string | null;
  college: string | null;
  joinedAt: string;
  stats: { xp: number; level: number; streakCurrent: number; streakBest: number } | null;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}
