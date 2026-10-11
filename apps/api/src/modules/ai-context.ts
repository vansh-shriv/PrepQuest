import type { Database } from "@prepquest/db";
import type { ServerEnv } from "@prepquest/shared";
import type { ObjectStore } from "@prepquest/storage";
import type { Kv } from "../lib/kv.js";
import type { BackgroundRunner } from "../lib/jobs.js";
import type { RateLimiter } from "../lib/limiter.js";
import type { LlmGateway } from "../lib/llm/index.js";

/** Everything the resume and interview modules need; built once in `buildApp`. */
export interface AiContext {
  db: Database;
  env: ServerEnv;
  store: ObjectStore;
  llm: LlmGateway;
  jobs: BackgroundRunner;
  limiter: RateLimiter;
  kv: Kv;
  log: {
    info: (obj: object, msg?: string) => void;
    warn: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  };
  /** Wall clock; tests pin it (`TEST_CLOCK_ISO` style). */
  now: () => Date;
}
