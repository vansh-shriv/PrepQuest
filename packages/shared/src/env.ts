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
  /** Behind a reverse proxy/CDN: trust X-Forwarded-For so rate limits see real client IPs. */
  TRUST_PROXY: bool,
  RL_AUTH_PER_MIN: z.coerce.number().int().positive().default(20),
  /** Failed-or-not login attempts per IP+email per 10 minutes (doc 11 §14). */
  RL_LOGIN_PER_10MIN: z.coerce.number().int().positive().default(10),
  /** Password reset emails per address per hour. */
  RL_FORGOT_PER_HOUR: z.coerce.number().int().positive().default(3),
  /** Global per-IP budget for anonymous requests, and per-user for signed-in ones. */
  RL_ANON_PER_MIN: z.coerce.number().int().positive().default(120),
  RL_USER_PER_MIN: z.coerce.number().int().positive().default(600),
  /** Base64 32-byte key encrypting TOTP seeds at rest. Required in production. */
  DATA_ENCRYPTION_KEY: z.string().optional(),
  /** Reject passwords found in breach data (Have I Been Pwned range API). */
  BREACH_CHECK: z.enum(["on", "off"]).default("on"),
  // --- OAuth (a provider is enabled when both its id and secret are set) ---
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // --- Object storage (hidden test data, uploads) ---
  STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
  /** Root directory for the `fs` driver (dev/test). Resolved from the process working directory. */
  STORAGE_FS_DIR: z.string().default("../../.data/objects"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("prepquest"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  /** Let content authors publish their own problems (doc 17: separation of duties is the default). */
  ALLOW_SELF_PUBLISH: bool,
  // --- Email ---
  SMTP_URL: z.string().default("smtp://localhost:1025"),
  EMAIL_FROM: z.string().default("PrepQuest <no-reply@prepquest.local>"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LLM_MODE: z.enum(["live", "mock", "record"]).default("mock"),
  FF_VOICE: bool,
  FF_PEER: bool,
  FF_CONTESTS: bool,
  FF_CANVAS: bool,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Rules that depend on more than one variable. */
function checkProduction(env: ServerEnv): string | null {
  if (env.NODE_ENV === "production" && !env.DATA_ENCRYPTION_KEY) {
    return "DATA_ENCRYPTION_KEY: required in production";
  }
  return null;
}

export function parseServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  const problem = checkProduction(result.data);
  if (problem) throw new Error(`Invalid environment:\n  ${problem}`);
  return result.data;
}
