import type { Control } from "./control.js";
import type { InterviewState, InterviewType, Persona } from "./types.js";

// Per-turn policy: what the interviewer may do right now (doc 13 §3). Code enforces; the prompt informs.

export interface PolicyInput {
  type: InterviewType;
  persona: Persona;
  state: InterviewState;
  hintBudget: number;
  hintsGiven: number;
  /** Hints already given on the current question (the ladder restarts per question). */
  hintsOnQuestion: number;
}

export interface Policy {
  hintsLeft: number;
  hintAllowed: boolean;
  /** The ladder level the next hint must have (1 question, 2 technique, 3 outline). */
  nextHintLevel: 1 | 2 | 3;
  maxWords: number;
}

const HINT_STATES: readonly InterviewState[] = [
  "CLARIFY",
  "APPROACH",
  "CODING",
  "TESTING",
  "OPTIMIZE",
];
const LONG_STATES: readonly InterviewState[] = ["PROBLEM", "WRAPUP", "ENDING"];

export const WORD_CAP = { normal: 120, rapid: 25, long: 220 } as const;

export function computePolicy(input: PolicyInput): Policy {
  const hintsLeft = Math.max(0, input.hintBudget - input.hintsGiven);
  const eligible = input.type === "dsa" && HINT_STATES.includes(input.state);
  const level = Math.min(3, input.hintsOnQuestion + 1) as 1 | 2 | 3;
  const maxWords = LONG_STATES.includes(input.state)
    ? WORD_CAP.long
    : input.persona === "rapid"
      ? WORD_CAP.rapid
      : WORD_CAP.normal;
  return { hintsLeft, hintAllowed: eligible && hintsLeft > 0, nextHintLevel: level, maxWords };
}

export interface ValidatedControl {
  control: Control;
  clamps: string[];
  /** The reply broke a hard rule and must be generated again. */
  needsRegen: boolean;
  /** This reply consumed a hint. */
  hintUsed: boolean;
}

/** Clamps illegal actions the model proposed (e.g. a hint beyond the budget). */
export function validateControl(control: Control, policy: Policy): ValidatedControl {
  const clamps: string[] = [];
  let needsRegen = false;
  const out: Control = {
    ...control,
    flags: [...control.flags],
    topic_tags: [...control.topic_tags],
  };
  const isHint = out.intent === "hint" || out.hint_level > 0;

  if (isHint && !policy.hintAllowed) {
    clamps.push("hint_not_allowed");
    needsRegen = true;
    out.intent = "followup";
    out.hint_level = 0;
  } else if (isHint) {
    if (out.hint_level === 0 || out.hint_level > policy.nextHintLevel) {
      clamps.push("hint_level_ladder");
      out.hint_level = policy.nextHintLevel;
    }
    out.intent = "hint";
  }
  return { control: out, clamps, needsRegen, hintUsed: out.hint_level > 0 };
}

export function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

/** Soft behaviour checks recorded in the turn metadata (and used by the eval suite). */
export function styleFlags(spoken: string, policy: Policy): string[] {
  const flags: string[] = [];
  if (wordCount(spoken) > policy.maxWords * 1.25) flags.push("too_long");
  if ((spoken.match(/\?/g) ?? []).length > 2) flags.push("stacked_questions");
  return flags;
}

const HINT_REQUEST_RE =
  /\b(hint|nudge|clue|i('| a)?m stuck|give me a (hint|clue|nudge)|help me)\b/i;

/** Cheap local detector, used only to label the event; the model decides how to respond. */
export function asksForHint(candidateText: string): boolean {
  return HINT_REQUEST_RE.test(candidateText);
}
