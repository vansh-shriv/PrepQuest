import type { InterviewState, Persona } from "./types.js";

// Proactive interviewer reactions to what the candidate does in the editor (doc 03 I6, doc 13 §5.3).
// Pure decisions: the engine feeds in facts and applies the result. The model only gets to say
// whether to speak and how to phrase it; when, how often and never-while-typing are rules here.

export type ReactionKind =
  "ac_reached" | "run_failed" | "no_approach_before_code" | "complexity_smell" | "idle_coding";

/** At most one proactive message per minute unless the candidate asks (doc 03 I6). */
export const REACTION_COOLDOWN_MS = 60_000;
/** No proactive message within this long after the last code change ("typing burst"). */
export const TYPING_QUIET_MS = 5_000;
/** Reactions per question, so a long session is not a lecture. */
export const MAX_REACTIONS_PER_QUESTION = 4;
/** How long after a failed run the interviewer waits before asking about it. */
export const RUN_FAILED_DELAY_MS = 20_000;
/** How long after a smelly snapshot the interviewer waits (the candidate may be mid-edit). */
export const SMELL_DELAY_MS = 15_000;
/** Silence while coding before a nudge (friendly mentors speak up sooner). */
export const CODING_IDLE_MS: Record<Persona, number> = {
  friendly: 3 * 60_000,
  neutral: 5 * 60_000,
  strict: 6 * 60_000,
  rapid: 2 * 60_000,
};

const LOOP = /\b(for|while)\b/;

/** Two loops nested by indentation, a cheap stand-in for "this is probably quadratic". */
export function detectNestedLoops(code: string): boolean {
  const lines = code.split("\n");
  const stack: number[] = [];
  for (const raw of lines) {
    if (raw.trim() === "" || /^\s*(#|\/\/)/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    while (stack.length > 0 && stack[stack.length - 1]! >= indent) stack.pop();
    if (LOOP.test(raw) && /[:{]\s*$|\)\s*\{?\s*$|:\s*\S/.test(raw)) {
      if (stack.length > 0) return true;
      stack.push(indent);
    }
  }
  return false;
}

export interface ReactionFacts {
  state: InterviewState;
  persona: Persona;
  interruptionsOff: boolean;
  elapsedMs: number;
  lastProactiveMs: number | null;
  lastCodeChangeMs: number | null;
  reactionsOnQuestion: number;
  reactedKinds: readonly ReactionKind[];
}

/** Rules every proactive message must pass, whatever triggered it. */
export function mayReact(f: ReactionFacts): { ok: true } | { ok: false; why: string } {
  if (f.interruptionsOff) return { ok: false, why: "interruptions are off" };
  if (f.reactionsOnQuestion >= MAX_REACTIONS_PER_QUESTION)
    return { ok: false, why: "reaction cap" };
  if (f.lastProactiveMs !== null && f.elapsedMs - f.lastProactiveMs < REACTION_COOLDOWN_MS) {
    return { ok: false, why: "cooldown" };
  }
  if (f.lastCodeChangeMs !== null && f.elapsedMs - f.lastCodeChangeMs < TYPING_QUIET_MS) {
    return { ok: false, why: "typing" };
  }
  return { ok: true };
}

export interface PendingReaction {
  kind: ReactionKind;
  /** Interview time at which it becomes due. */
  dueMs: number;
}

/** What a snapshot of the code can trigger. Returns the reaction to schedule, if any. */
export function reactionForSnapshot(input: {
  state: InterviewState;
  code: string;
  /** Length of the starter code the candidate was given. */
  starterLength: number;
  approachStated: boolean;
  elapsedMs: number;
  reactedKinds: readonly ReactionKind[];
}): PendingReaction | null {
  const written = input.code.length - input.starterLength;
  if (
    (input.state === "CLARIFY" || input.state === "APPROACH") &&
    !input.approachStated &&
    written > 60 &&
    !input.reactedKinds.includes("no_approach_before_code")
  ) {
    return { kind: "no_approach_before_code", dueMs: input.elapsedMs };
  }
  if (
    input.state === "CODING" &&
    detectNestedLoops(input.code) &&
    !input.reactedKinds.includes("complexity_smell")
  ) {
    return { kind: "complexity_smell", dueMs: input.elapsedMs + SMELL_DELAY_MS };
  }
  return null;
}

/** A run or submit that did not pass. */
export function reactionForRun(input: {
  elapsedMs: number;
  reactedKinds: readonly ReactionKind[];
}): PendingReaction | null {
  if (input.reactedKinds.filter((k) => k === "run_failed").length >= 2) return null;
  return { kind: "run_failed", dueMs: input.elapsedMs + RUN_FAILED_DELAY_MS };
}

/** Silence while coding: due once the candidate has done nothing for the persona's patience. */
export function idleCodingDue(input: {
  state: InterviewState;
  persona: Persona;
  elapsedMs: number;
  lastActivityMs: number;
  reactedKinds: readonly ReactionKind[];
}): boolean {
  if (input.state !== "CODING") return false;
  if (input.reactedKinds.filter((k) => k === "idle_coding").length >= 2) return false;
  return input.elapsedMs - input.lastActivityMs >= CODING_IDLE_MS[input.persona];
}

/** Instruction for the interviewer prompt (the model phrases it; it may stay silent via the classifier). */
export const REACTION_NOTE: Record<ReactionKind, string> = {
  ac_reached:
    "The judge accepted the candidate's solution. Acknowledge briefly, then ask about its time and space complexity.",
  run_failed:
    "The candidate's last run did not pass. Do not say what is wrong. Ask what the failing case tells them, or what they would check first.",
  no_approach_before_code:
    "The candidate started writing code before describing an approach. Ask them to walk you through their plan first.",
  complexity_smell:
    "The code has nested loops. Do not state the complexity. Ask what the time complexity of what they wrote is, and whether it can be better.",
  idle_coding:
    "The candidate has been quiet for a long time while coding. Offer a graded nudge: a guiding question only. This is not a hint and does not use the hint budget.",
};
