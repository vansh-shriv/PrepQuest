import type { interviewSessions, StoredCanvas } from "@prepquest/db";
import type {
  InterviewPlan,
  InterviewState,
  MachineFacts,
  PendingReaction,
  ReactionKind,
} from "@prepquest/interview-core";
import { getTemplate } from "@prepquest/interview-core";

export type SessionRow = typeof interviewSessions.$inferSelect;

/** Per-question bookkeeping used for adaptive difficulty, question memory and the scorecard. */
export interface QuestionLog {
  index: number;
  startMs: number;
  endMs: number | null;
  hints: number;
  solved: boolean;
  runs: number;
}

/** Orchestrator working memory, stored in `interview_sessions.state_data`. */
export interface StateData {
  questionIndex: number;
  /** Offset (ms of interview time) at which the current state was entered. */
  stateEnteredMs: number;
  /** Candidate turns since the current state was entered. */
  turnsInState: number;
  approachStated: boolean;
  hasRun: boolean;
  ac: boolean;
  candidateDone: boolean;
  hintsOnQuestion: number;
  abuseCount: number;
  warningsSent: string[];
  idlePrompts: number;
  lastRun: string | null;
  lastCode: { language: string; code: string; hash: string } | null;
  /** The drawing of a design interview as the interviewer last saw it. */
  lastCanvas?: { canvas: StoredCanvas; hash: string } | null;
  questions: QuestionLog[];
  difficulty: number;
  summaryUpTo: number;
  /** Sum of completed pauses. */
  pausedMs: number;
  /** Interview time of the last candidate or code activity. */
  lastActivityMs: number;
  /** Interview time of the last change to the code (typing-burst suppression). */
  lastCodeChangeMs: number | null;
  /** Length of the first snapshot of the question: the starter code the candidate was given. */
  starterLen: number | null;
  lastProactiveMs: number | null;
  reactionsOnQuestion: number;
  reactedKinds: ReactionKind[];
  pendingReaction: PendingReaction | null;
  /** Set when the previous turn nudged the candidate (start coding / move on). */
  nudge: string | null;
}

export function initialStateData(difficulty: number): StateData {
  return {
    questionIndex: 0,
    stateEnteredMs: 0,
    turnsInState: 0,
    approachStated: false,
    hasRun: false,
    ac: false,
    candidateDone: false,
    hintsOnQuestion: 0,
    abuseCount: 0,
    warningsSent: [],
    idlePrompts: 0,
    lastRun: null,
    lastCode: null,
    questions: [{ index: 0, startMs: 0, endMs: null, hints: 0, solved: false, runs: 0 }],
    difficulty,
    summaryUpTo: 0,
    pausedMs: 0,
    lastActivityMs: 0,
    lastCodeChangeMs: null,
    starterLen: null,
    lastProactiveMs: null,
    reactionsOnQuestion: 0,
    reactedKinds: [],
    pendingReaction: null,
    nudge: null,
  };
}

export function readStateData(s: SessionRow): StateData {
  const sd = s.stateData as Partial<StateData> | null;
  return { ...initialStateData(s.difficulty), ...(sd ?? {}) };
}

export function readPlan(s: SessionRow): InterviewPlan {
  return s.plan as InterviewPlan;
}

/** Interview time that has actually elapsed: wall clock since start minus time spent paused. */
export function elapsedMs(s: SessionRow, now: Date): number {
  if (!s.startedAt) return 0;
  const sd = readStateData(s);
  const end = s.endedAt ?? s.pausedAt ?? now;
  return Math.max(0, end.getTime() - s.startedAt.getTime() - sd.pausedMs);
}

export function plannedMs(s: SessionRow): number {
  return s.plannedSeconds * 1000;
}

export function remainingMsOf(s: SessionRow, now: Date): number {
  return Math.max(0, plannedMs(s) - elapsedMs(s, now));
}

export function isActive(s: SessionRow): boolean {
  return s.startedAt !== null && s.endedAt === null;
}

export function toFacts(s: SessionRow, now: Date, sd: StateData): MachineFacts {
  const plan = readPlan(s);
  const e = elapsedMs(s, now);
  const warmup = plan.segments.find((seg) => seg.kind === "warmup");
  return {
    type: (getTemplate(s.templateKey)?.type ?? "dsa") as MachineFacts["type"],
    elapsedMs: e,
    plannedMs: plannedMs(s),
    inStateMs: e - sd.stateEnteredMs,
    turnsInState: sd.turnsInState,
    approachStated: sd.approachStated,
    hasRun: sd.hasRun,
    ac: sd.ac,
    candidateDone: sd.candidateDone,
    questionIndex: sd.questionIndex,
    questionCount: plan.questions.length,
    warmupMs: warmup ? warmup.endMs - warmup.startMs : 5 * 60_000,
    followupCap: getTemplate(s.templateKey)?.followupCap ?? 0,
    minMsForNext: getTemplate(s.templateKey)?.minMsForNext ?? 8 * 60_000,
  };
}

export const ACTIVE_STATES: readonly InterviewState[] = [
  "WARMUP",
  "PROBLEM",
  "CLARIFY",
  "APPROACH",
  "CODING",
  "TESTING",
  "OPTIMIZE",
  "FOLLOWUP",
  "WRAPUP",
  "ENDING",
];
