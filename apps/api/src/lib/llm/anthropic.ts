import Anthropic from "@anthropic-ai/sdk";
import { TransientLlmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types.js";

/**
 * The five-series models take `output_config.effort` and reject non-default sampling parameters,
 * so `temperature` is never sent; reasoning depth is the latency/quality control instead.
 */
const SUPPORTS_EFFORT = /^claude-(sonnet|opus|haiku|fable|mythos)-5/;

export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string, timeoutMs = 60_000) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async generate(
    req: LlmRequest,
    model: string,
    opts: { onDelta?: (delta: string) => void; signal?: AbortSignal },
  ): Promise<LlmResult> {
    // two cache breakpoints: the static system block and the per-session context (doc 13 §4)
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
    ];
    if (req.context) {
      system.push({ type: "text", text: req.context, cache_control: { type: "ephemeral" } });
    }
    const params: Anthropic.MessageCreateParamsStreaming = {
      model,
      max_tokens: req.maxTokens,
      system,
      messages: req.messages,
      stream: true,
      ...(SUPPORTS_EFFORT.test(model) && req.effort
        ? { output_config: { effort: req.effort } }
        : {}),
    };
    const stream = this.client.messages.stream(params, opts.signal ? { signal: opts.signal } : {});
    if (opts.onDelta) {
      const onDelta = opts.onDelta;
      stream.on("text", (delta) => onDelta(delta));
    }
    const final = await stream.finalMessage();
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      model: final.model,
      refused: final.stop_reason === "refusal",
      usage: {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/** Errors worth a retry on the fallback model: 5xx, timeouts, connection failures, rate limits. */
export function isTransientLlmError(err: unknown): boolean {
  if (err instanceof TransientLlmError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  if (err instanceof Anthropic.APIError) {
    const s = err.status;
    return s === 408 || s === 409 || s === 429 || (typeof s === "number" && s >= 500);
  }
  return false;
}
