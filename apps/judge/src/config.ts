import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

/**
 * The worker's whole configuration. It deliberately knows nothing about the database, JWT keys or email:
 * a compromised judge host must not hold credentials for them (doc 12 §2).
 */
const judgeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.string().url(),
  /** `isolate` in production (Linux judge container); `process` for local development only. */
  JUDGE_SANDBOX: z.enum(["isolate", "process"]).default("process"),
  JUDGE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  JUDGE_CGROUPS: bool,
  ISOLATE_BIN: z.string().default("isolate"),
  // read access to hidden test data
  STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
  STORAGE_FS_DIR: z.string().default("../../.data/objects"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("prepquest"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
});

export type JudgeConfig = z.infer<typeof judgeEnvSchema>;

export function loadConfig(source: Record<string, string | undefined> = process.env): JudgeConfig {
  const result = judgeEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid judge environment:\n  ${problems}`);
  }
  const config = result.data;
  if (config.JUDGE_SANDBOX === "process" && config.NODE_ENV === "production") {
    throw new Error(
      "JUDGE_SANDBOX=process runs code without isolation and is not allowed in production",
    );
  }
  return config;
}
