import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

/** Server-side environment, validated once at startup. Extended per phase (see .env.example). */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:4000"),
  API_PORT: z.coerce.number().int().default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  // --- Auth ---
  JWT_PRIVATE_KEY_PATH: z.string().default("./secrets/jwt_ed25519_private.pem"),
  JWT_PUBLIC_KEY_PATH: z.string().default("./secrets/jwt_ed25519_public.pem"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z.string().optional(),
  RL_AUTH_PER_MIN: z.coerce.number().int().positive().default(20),
  // --- Email ---
  SMTP_URL: z.string().default("smtp://localhost:1025"),
  EMAIL_FROM: z.string().default("PrepQuest <no-reply@prepquest.local>"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LLM_MODE: z.enum(["live", "mock", "record"]).default("mock"),
  FAKE_JUDGE: bool,
  FF_VOICE: bool,
  FF_PEER: bool,
  FF_CONTESTS: bool,
  FF_CANVAS: bool,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  return result.data;
}
