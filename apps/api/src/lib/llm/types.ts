// LLM gateway types (doc 08 §3.5). Every model call in the product goes through `LlmGateway`.

export type ModelClass = "interviewer" | "evaluator" | "light";

export type LlmTask =
  | "interviewer_turn"
  | "scorecard"
  | "annotations"
  | "summary"
  | "reaction"
  | "resume_parse"
  | "jd_analysis"
  | "qgen";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  task: LlmTask;
  modelClass: ModelClass;
  /** Static instructions: cached by the provider. */
  system: string;
  /** Semi-static per-session context (plan, candidate facts): cached after the system block. */
  context?: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** Reasoning depth. Interview turns use `low` for latency, evaluation uses `high`. */
  effort?: "low" | "medium" | "high";
  userId?: string | null;
  sessionId?: string | null;
  promptVersion?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage;
  model: string;
  /** The provider stopped because the model declined (safety) rather than finishing. */
  refused: boolean;
}

/** One concrete backend (Anthropic, the mock, a recorder). */
export interface LlmProvider {
  generate(
    req: LlmRequest,
    model: string,
    opts: { onDelta?: (delta: string) => void; signal?: AbortSignal },
  ): Promise<LlmResult>;
}

export const ZERO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Thrown by providers (and test doubles) for failures that are worth a retry. */
export class TransientLlmError extends Error {}
