import { z } from "zod";
import { INTERVIEW_STATES } from "./types.js";

// The control channel (doc 13 §3): the model ends each reply with a machine-readable block that is
// stripped before display and validated before use.

export const INTENTS = [
  "followup",
  "clarify_answer",
  "prompt_approach",
  "nudge",
  "hint",
  "challenge",
  "praise",
  "transition",
  "close",
  "redirect",
  "warn",
] as const;
export type Intent = (typeof INTENTS)[number];

export const FLAGS = [
  "candidate_vague",
  "approach_stated",
  "candidate_done",
  "off_topic",
  "abusive",
  "asked_for_hint",
  "asked_if_ai",
] as const;

export const controlSchema = z.object({
  intent: z.enum(INTENTS).catch("followup"),
  hint_level: z.number().int().min(0).max(3).catch(0),
  next_state: z.enum(INTERVIEW_STATES).optional().catch(undefined),
  topic_tags: z
    .array(z.string().max(40))
    .max(6)
    .catch([])
    .default(() => []),
  flags: z
    .array(z.string().max(40))
    .max(8)
    .catch([])
    .default(() => []),
  asked_question_id: z.string().max(80).optional().catch(undefined),
});
export type Control = z.infer<typeof controlSchema>;

export const DEFAULT_CONTROL: Control = {
  intent: "followup",
  hint_level: 0,
  topic_tags: [],
  flags: [],
};

const CONTROL_RE = /<control>([\s\S]*?)<\/control>/gi;

export interface ParsedReply {
  /** What the candidate sees: the reply with every control block removed. */
  spoken: string;
  control: Control;
  /** The model produced a valid control block. */
  hadControl: boolean;
}

export function parseReply(raw: string): ParsedReply {
  let control: Control | null = null;
  for (const match of raw.matchAll(CONTROL_RE)) {
    try {
      const json: unknown = JSON.parse(match[1] ?? "");
      const parsed = controlSchema.safeParse(json);
      if (parsed.success) control = parsed.data; // the last valid block wins
    } catch {
      /* malformed block: ignore */
    }
  }
  // also drop an unterminated trailing block (the stream was cut off)
  const spoken = raw
    .replace(CONTROL_RE, "")
    .replace(/<control>[\s\S]*$/i, "")
    .trim();
  return { spoken, control: control ?? { ...DEFAULT_CONTROL }, hadControl: control !== null };
}

/**
 * Filters a token stream so the candidate never sees the control block, even when the tag is split
 * across chunks. `push` returns text that is safe to show; `finish` flushes what is left.
 */
export class ControlStreamFilter {
  private pending = "";
  private inControl = false;
  private static readonly OPEN = "<control>";

  push(delta: string): string {
    if (this.inControl) return "";
    this.pending += delta;
    const open = this.pending.toLowerCase().indexOf(ControlStreamFilter.OPEN);
    if (open !== -1) {
      const out = this.pending.slice(0, open).trimEnd();
      this.pending = "";
      this.inControl = true;
      return out;
    }
    // hold back a possible partial "<control>" and any trailing whitespace (it may precede the tag)
    let hold = this.pending.length - this.pending.trimEnd().length;
    const max = Math.min(this.pending.length, ControlStreamFilter.OPEN.length - 1);
    for (let n = max; n > 0; n--) {
      if (ControlStreamFilter.OPEN.startsWith(this.pending.slice(-n).toLowerCase())) {
        hold = Math.max(hold, n);
        break;
      }
    }
    const out = this.pending.slice(0, this.pending.length - hold);
    this.pending = this.pending.slice(this.pending.length - hold);
    return out;
  }

  finish(): string {
    if (this.inControl) return "";
    const out = this.pending.trimEnd();
    this.pending = "";
    return out;
  }
}

/** Tags the prompts use to delimit untrusted data. Candidate text must not be able to forge them. */
const FORGEABLE_TAGS = [
  "control",
  "candidate_message",
  "resume_data",
  "jd_data",
  "code",
  "plan",
  "memory",
  "signals",
  "system",
  "transcript",
  "resume_text",
];
const TAG_RE = new RegExp(`<\\s*(/?)\\s*(${FORGEABLE_TAGS.join("|")})\\b[^>]*>?`, "gi");

export const MAX_CANDIDATE_CHARS = 2000;

/** Neutralises tag lookalikes so user text cannot close a data block or fake a control block. */
export function neutralizeTags(text: string): string {
  return text.replace(
    TAG_RE,
    (_m, slash: string, name: string) => `[${slash}${name.toLowerCase()}]`,
  );
}

export function sanitizeCandidateText(text: string): string {
  // eslint-disable-next-line no-control-regex -- strip control characters except newline and tab
  const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return neutralizeTags(clean).trim().slice(0, MAX_CANDIDATE_CHARS);
}
