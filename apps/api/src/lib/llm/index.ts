import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Database } from "@prepquest/db";
import type { ServerEnv } from "@prepquest/shared";
import { AnthropicProvider } from "./anthropic.js";
import { LlmGateway } from "./gateway.js";
import { MockProvider } from "./mock.js";
import type { LlmProvider, LlmRequest, LlmResult } from "./types.js";

export * from "./gateway.js";
export * from "./types.js";
export { MockProvider } from "./mock.js";

/** `LLM_MODE=record`: calls the real model and appends request/response fixtures for tests. */
class RecordingProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly dir: string,
  ) {}
  async generate(
    req: LlmRequest,
    model: string,
    opts: Parameters<LlmProvider["generate"]>[2],
  ): Promise<LlmResult> {
    const res = await this.inner.generate(req, model, opts);
    await mkdir(this.dir, { recursive: true });
    await appendFile(
      resolve(this.dir, `${req.task}.jsonl`),
      `${JSON.stringify({ model, request: { ...req, userId: undefined, sessionId: undefined }, response: res.text })}\n`,
    );
    return res;
  }
}

export function createLlmGateway(
  env: ServerEnv,
  db: Database,
  log: (level: "warn" | "error", msg: string, extra?: Record<string, unknown>) => void,
  provider?: LlmProvider,
  opts: { retryDelayMs?: number } = {},
): LlmGateway {
  let p = provider;
  if (!p) {
    if (env.LLM_MODE === "mock") p = new MockProvider();
    else {
      const live = new AnthropicProvider(env.ANTHROPIC_API_KEY ?? "");
      p = env.LLM_MODE === "record" ? new RecordingProvider(live, env.LLM_RECORD_DIR) : live;
    }
  }
  return new LlmGateway({
    provider: p,
    models: {
      interviewer: env.LLM_MODEL_INTERVIEWER,
      evaluator: env.LLM_MODEL_EVALUATOR,
      light: env.LLM_MODEL_LIGHT,
    },
    fallbackModel: env.LLM_MODEL_FALLBACK,
    db,
    dailyTokenBudget: env.LLM_DAILY_TOKEN_BUDGET_PER_USER,
    sessionTokenCap: env.LLM_SESSION_TOKEN_CAP,
    log,
    ...(opts.retryDelayMs !== undefined ? { retryDelayMs: opts.retryDelayMs } : {}),
  });
}
