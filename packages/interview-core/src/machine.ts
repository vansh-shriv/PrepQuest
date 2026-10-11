import { timeGuard } from "./timing.js";
import type { InterviewState, InterviewType } from "./types.js";

// The interview state machine (doc 13 §3). The model proposes `next_state`; this module decides.
// Transitions are code, never the model's say-so.

type Edges = Partial<Record<InterviewState, readonly InterviewState[]>>;

const DSA_EDGES: Edges = {
  SETUP: ["WARMUP"],
  WARMUP: ["PROBLEM"],
  PROBLEM: ["CLARIFY"],
  CLARIFY: ["APPROACH"],
  APPROACH: ["CODING"],
  CODING: ["TESTING", "APPROACH"],
  TESTING: ["OPTIMIZE", "CODING"],
  OPTIMIZE: ["FOLLOWUP", "PROBLEM", "WRAPUP"],
  FOLLOWUP: ["PROBLEM", "WRAPUP", "OPTIMIZE"],
  WRAPUP: ["ENDING"],
  ENDING: ["COMPLETED"],
};

const PROJECT_EDGES: Edges = {
  SETUP: ["WARMUP"],
  WARMUP: ["PROBLEM"],
  PROBLEM: ["FOLLOWUP"],
  FOLLOWUP: ["FOLLOWUP", "PROBLEM", "WRAPUP"],
  WRAPUP: ["ENDING"],
  ENDING: ["COMPLETED"],
};

export const EDGES: Record<InterviewType, Edges> = {
  dsa: DSA_EDGES,
  project: PROJECT_EDGES,
  resume: PROJECT_EDGES,
  cs: PROJECT_EDGES,
  behavioral: PROJECT_EDGES,
  lld: PROJECT_EDGES,
  hld: PROJECT_EDGES,
};

export function isEdgeAllowed(type: InterviewType, from: InterviewState, to: InterviewState) {
  return EDGES[type][from]?.includes(to) ?? false;
}

/** Cap on clarifying exchanges before the interviewer moves on to the approach. */
export const CLARIFY_TURN_CAP = 4;
/** Minutes in APPROACH after which coding is allowed without a stated approach (with a nudge). */
export const APPROACH_PATIENCE_MS = 4 * 60_000;
/** Candidate turns in the warm-up before the first question is presented. */
export const WARMUP_TURN_CAP = 2;
/** A second question needs this much time left. */
export const MIN_MS_FOR_NEXT_QUESTION = 8 * 60_000;

export interface MachineFacts {
  type: InterviewType;
  elapsedMs: number;
  plannedMs: number;
  /** Time since the current state was entered. */
  inStateMs: number;
  /** Candidate turns spent in the current state. */
  turnsInState: number;
  approachStated: boolean;
  hasRun: boolean;
  /** The judge accepted a submission for the current problem. */
  ac: boolean;
  /** The model flagged that the candidate says they are done / satisfied. */
  candidateDone: boolean;
  questionIndex: number;
  questionCount: number;
  /** Length of the warm-up segment. */
  warmupMs: number;
  /** Candidate turns on one question before the interviewer moves on (0: no cap). */
  followupCap?: number;
  /** Time a further question needs (default 8 minutes). */
  minMsForNext?: number;
}

export interface Decision {
  state: InterviewState;
  reason: string;
  /** Moved by code (time or a guard), not by the model's proposal. */
  forced: boolean;
  /** The move starts the next planned question. */
  nextQuestion: boolean;
  /** The interviewer should nudge the candidate to begin coding / move on. */
  nudge?: "start_coding" | "move_on";
}

const stay = (state: InterviewState, reason = "stay"): Decision => ({
  state,
  reason,
  forced: false,
  nextQuestion: false,
});

/**
 * Decides the state after an interviewer turn.
 * Order: terminal states, time guards, automatic transitions, then the model's proposal if allowed.
 */
export function decideNext(
  current: InterviewState,
  proposed: InterviewState | undefined,
  facts: MachineFacts,
): Decision {
  if (current === "COMPLETED" || current === "ABANDONED" || current === "FAILED") {
    return stay(current, "terminal");
  }
  if (current === "ENDING") return stay(current);

  const guard = timeGuard(facts.elapsedMs, facts.plannedMs);
  if (guard === "end") {
    return { state: "ENDING", reason: "time up", forced: true, nextQuestion: false };
  }
  const inLastCoding =
    (current === "CODING" || current === "TESTING") &&
    facts.questionIndex >= facts.questionCount - 1;
  if (guard === "force_wrapup" && current !== "WRAPUP" && !inLastCoding) {
    return { state: "WRAPUP", reason: "85% of the time used", forced: true, nextQuestion: false };
  }

  // Automatic transitions (code decides, the proposal is ignored).
  switch (current) {
    case "SETUP":
      return { state: "WARMUP", reason: "start", forced: true, nextQuestion: false };
    case "WARMUP":
      if (facts.turnsInState >= WARMUP_TURN_CAP || facts.inStateMs >= facts.warmupMs) {
        return { state: "PROBLEM", reason: "warm-up done", forced: true, nextQuestion: false };
      }
      break;
    case "PROBLEM":
      // the problem has been presented in this turn
      return {
        state: facts.type === "dsa" ? "CLARIFY" : "FOLLOWUP",
        reason: "presented",
        forced: true,
        nextQuestion: false,
      };
    case "CLARIFY":
      if (facts.approachStated) {
        return { state: "APPROACH", reason: "approach stated", forced: true, nextQuestion: false };
      }
      if (facts.turnsInState >= CLARIFY_TURN_CAP) {
        return { state: "APPROACH", reason: "clarify cap", forced: true, nextQuestion: false };
      }
      break;
    case "APPROACH":
      if (facts.approachStated) {
        return { state: "CODING", reason: "approach stated", forced: true, nextQuestion: false };
      }
      if (facts.inStateMs >= APPROACH_PATIENCE_MS) {
        return {
          state: "CODING",
          reason: "approach patience",
          forced: true,
          nextQuestion: false,
          nudge: "start_coding",
        };
      }
      break;
    case "FOLLOWUP":
      if (facts.followupCap && facts.turnsInState >= facts.followupCap) {
        // enough on this question: the next one if there is time, otherwise wrap up
        const hasNext = facts.questionIndex + 1 < facts.questionCount;
        const room =
          facts.plannedMs - facts.elapsedMs >= (facts.minMsForNext ?? MIN_MS_FOR_NEXT_QUESTION);
        return hasNext && room
          ? { state: "PROBLEM", reason: "followup cap", forced: true, nextQuestion: true }
          : {
              state: "WRAPUP",
              reason: "followup cap, last question",
              forced: true,
              nextQuestion: false,
            };
      }
      break;
    case "CODING":
      if (facts.hasRun || facts.candidateDone) {
        return { state: "TESTING", reason: "first run", forced: true, nextQuestion: false };
      }
      break;
    case "TESTING":
      if (facts.ac || facts.candidateDone) {
        return { state: "OPTIMIZE", reason: "accepted", forced: true, nextQuestion: false };
      }
      break;
    default:
      break;
  }

  if (!proposed || proposed === current) return stay(current);
  if (proposed === "ENDING" || proposed === "COMPLETED") {
    return stay(current, "the engine ends the interview, not the model");
  }
  if (!isEdgeAllowed(facts.type, current, proposed)) {
    return stay(current, `illegal edge ${current} -> ${proposed}`);
  }

  if (proposed === "PROBLEM" && current === "WARMUP") {
    // the first question: the index stays at 0
    return { state: "PROBLEM", reason: "model proposal", forced: false, nextQuestion: false };
  }
  if (proposed === "PROBLEM") {
    const hasNext = facts.questionIndex + 1 < facts.questionCount;
    const timeLeft = facts.plannedMs - facts.elapsedMs;
    if (!hasNext || timeLeft < (facts.minMsForNext ?? MIN_MS_FOR_NEXT_QUESTION)) {
      return stay(current, "no time or question for another problem");
    }
    return { state: "PROBLEM", reason: "next question", forced: false, nextQuestion: true };
  }
  if (proposed === "CODING" && current === "APPROACH" && !facts.approachStated) {
    return stay(current, "coding needs an approach first");
  }
  if (proposed === "TESTING" && !facts.hasRun && !facts.candidateDone) {
    return stay(current, "testing needs a run");
  }
  if (proposed === "OPTIMIZE" && current === "TESTING" && !facts.ac && !facts.candidateDone) {
    return stay(current, "optimize needs a pass");
  }
  return { state: proposed, reason: "model proposal", forced: false, nextQuestion: false };
}

/** Which segment a state belongs to: question segments follow the question index. */
export function segmentKeyFor(
  state: InterviewState,
  questionIndex: number,
  questionSegmentKeys: readonly string[],
): string {
  if (state === "SETUP" || state === "WARMUP") return "warmup";
  if (state === "WRAPUP" || state === "ENDING" || state === "COMPLETED") return "wrapup";
  return questionSegmentKeys[Math.min(questionIndex, questionSegmentKeys.length - 1)] ?? "q1";
}
