import { and, eq, gte, sql } from "drizzle-orm";
import type { z } from "zod";
import { llmUsage, type Database } from "@prepquest/db";
import { AppError } from "@prepquest/shared";
import { isTransientLlmError } from "./anthropic.js";
import type { LlmProvider, LlmRequest, LlmResult, LlmUsage, ModelClass } from "./types.js";

// The single entry point for model calls (doc 08 §3.5, doc 13 §2): model routing from config,
// budgets, retry then fallback model, usage accounting, and schema-validated JSON with a repair loop.

export interface GatewayOptions {
  provider: LlmProvider;
  models: Record<ModelClass, string>;
  fallbackModel: string;
  db: Database;
  dailyTokenBudget: number;
  sessionTokenCap: number;
  log: (level: "warn" | "error", msg: string, extra?: Record<string, unknown>) => void;
  /** Delay before the single same-model retry (tests set 0). */
  retryDelayMs?: number;
}

export interface CallOptions {
  onDelta?: (delta: string) => void;
  /** Called when an attempt that already streamed text failed or was declined: clear what was shown. */
  onReset?: () => void;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LlmGateway {
  constructor(private readonly o: GatewayOptions) {}

  modelFor(cls: ModelClass): string {
    return this.o.models[cls];
  }

  /** Tokens counted against the budgets (cache reads are nearly free and not counted). */
  private static billable(u: LlmUsage): number {
    return u.inputTokens + u.outputTokens + u.cacheWriteTokens;
  }

  async assertBudget(userId: string | null | undefined, sessionId: string | null | undefined) {
    const expr = sql<number>`coalesce(sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens}), 0)::int`;
    if (userId) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const [row] = await this.o.db
        .select({ used: expr })
        .from(llmUsage)
        .where(and(eq(llmUsage.userId, userId), gte(llmUsage.createdAt, startOfDay)));
      if ((row?.used ?? 0) >= this.o.dailyTokenBudget) {
        throw new AppError(
          "QUOTA_EXCEEDED",
          429,
          "Daily AI usage limit reached. Try again tomorrow.",
        );
      }
    }
    if (sessionId) {
      const [row] = await this.o.db
        .select({ used: expr })
        .from(llmUsage)
        .where(eq(llmUsage.sessionId, sessionId));
      if ((row?.used ?? 0) >= this.o.sessionTokenCap) {
        throw new AppError("QUOTA_EXCEEDED", 429, "This session reached its AI usage limit.");
      }
    }
  }

  private async record(
    req: LlmRequest,
    model: string,
    ok: boolean,
    usage: LlmUsage,
    latencyMs: number,
    meta?: Record<string, unknown>,
  ) {
    try {
      await this.o.db.insert(llmUsage).values({
        userId: req.userId ?? null,
        sessionId: req.sessionId ?? null,
        task: req.task,
        model,
        promptVersion: req.promptVersion ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        latencyMs,
        ok,
        meta: meta ?? null,
      });
    } catch (err) {
      this.o.log("warn", "could not record llm usage", { err: String(err) });
    }
  }

  /** One logical call: primary model, a retry, then the fallback model; usage is recorded per attempt. */
  async text(req: LlmRequest, opts: CallOptions = {}): Promise<LlmResult> {
    await this.assertBudget(req.userId, req.sessionId);
    const primary = this.modelFor(req.modelClass);
    const attempts: string[] = [primary, primary];
    if (this.o.fallbackModel !== primary) attempts.push(this.o.fallbackModel);
    let lastError: unknown;
    for (let i = 0; i < attempts.length; i++) {
      const model = attempts[i]!;
      if (i === 1) await sleep(this.o.retryDelayMs ?? 400);
      const started = Date.now();
      let emitted = false;
      const attemptOpts: CallOptions = {
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onDelta
          ? {
              onDelta: (d: string) => {
                emitted = true;
                opts.onDelta?.(d);
              },
            }
          : {}),
      };
      try {
        const res = await this.o.provider.generate(req, model, attemptOpts);
        await this.record(req, res.model, true, res.usage, Date.now() - started, {
          attempt: i,
          refused: res.refused,
        });
        if (res.refused && model !== this.o.fallbackModel) {
          // a safety decline: the same model would decline again, so go straight to the fallback
          lastError = new Error("refused");
          if (emitted) opts.onReset?.();
          i = attempts.length - 2;
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (emitted) opts.onReset?.(); // text from a failed attempt must not stay on screen
        await this.record(
          req,
          model,
          false,
          { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          Date.now() - started,
          { attempt: i, error: err instanceof Error ? err.name : "error" },
        );
        if (opts.signal?.aborted) throw err;
        // a bad request will not get better on retry
        if (!isTransientLlmError(err)) break;
        this.o.log("warn", "llm attempt failed", { task: req.task, model, attempt: i });
      }
    }
    this.o.log("error", "llm unavailable", { task: req.task, err: String(lastError) });
    throw new AppError(
      "UPSTREAM_AI_UNAVAILABLE",
      503,
      "The AI service is unavailable right now. Please try again shortly.",
    );
  }

  /**
   * Schema-validated JSON. `check` adds domain checks (e.g. evidence must exist in the transcript);
   * its messages are fed back to the model in the repair loop (doc 13 §5.7: up to 2 repairs).
   */
  async json<T>(
    req: LlmRequest,
    schema: z.ZodType<T>,
    opts: { maxRepairs?: number; check?: (value: T) => string[]; initialIssues?: string[] } = {},
  ): Promise<{ value: T; result: LlmResult; repairs: number }> {
    const maxRepairs = opts.maxRepairs ?? 2;
    let messages = [...req.messages];
    let lastIssues: string[] = [];
    for (let attempt = 0; attempt <= maxRepairs; attempt++) {
      const result = await this.text({ ...req, messages });
      const parsed = extractJson(result.text);
      let issues: string[];
      let value: T | undefined;
      if (parsed === undefined) {
        issues = ["the reply was not valid JSON"];
      } else {
        const checked = schema.safeParse(parsed);
        if (!checked.success) {
          issues = checked.error.issues
            .slice(0, 8)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
        } else {
          issues = opts.check?.(checked.data) ?? [];
          value = checked.data;
        }
      }
      if (issues.length === 0 && value !== undefined) return { value, result, repairs: attempt };
      lastIssues = issues;
      messages = [
        ...req.messages,
        { role: "assistant", content: result.text.slice(0, 12_000) },
        {
          role: "user",
          content: `Your JSON had problems. Fix all of them and return the complete corrected JSON only:\n${issues
            .slice(0, 12)
            .map((x) => `- ${x}`)
            .join("\n")}`,
        },
      ];
    }
    this.o.log("warn", "llm json failed validation", { task: req.task, issues: lastIssues });
    throw new LlmValidationError(lastIssues);
  }
}

export class LlmValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`LLM output failed validation: ${issues.slice(0, 3).join("; ")}`);
  }
}

/** Pulls the first JSON object out of a reply, tolerating code fences and surrounding prose. */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
