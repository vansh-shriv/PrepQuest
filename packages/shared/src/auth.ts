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
  })
  .partial()
  .strict();
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const settingsUpdateSchema = z
  .object({
    theme: z.enum(THEME_CHOICES),
    readableMode: z.boolean(),
    retroCursor: z.boolean(),
    sound: z.boolean(),
    reducedMotion: z.boolean(),
    hintMode: z.enum(["strict", "relaxed"]),
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
  };
  settings: {
    theme: (typeof THEME_CHOICES)[number];
    readableMode: boolean;
    retroCursor: boolean;
    sound: boolean;
    reducedMotion: boolean;
    hintMode: "strict" | "relaxed";
    defaultLanguage: string;
  };
}

export interface LoginResponse {
  accessToken: string;
  user: MeResponse;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}
