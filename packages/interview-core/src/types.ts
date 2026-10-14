// Shared vocabulary for the interview engine (doc 13 §3). Pure types: no I/O.

export const INTERVIEW_STATES = [
  "SETUP",
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
  "COMPLETED",
  "ABANDONED",
  "FAILED",
] as const;
export type InterviewState = (typeof INTERVIEW_STATES)[number];

export const TERMINAL_STATES: readonly InterviewState[] = ["COMPLETED", "ABANDONED", "FAILED"];

export const INTERVIEW_TYPES = [
  "dsa",
  "project",
  "cs",
  "behavioral",
  "resume",
  "hld",
  "lld",
] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const PERSONAS = ["friendly", "neutral", "strict", "rapid"] as const;
export type Persona = (typeof PERSONAS)[number];

export const INTERRUPTION_LEVELS = ["off", "low", "normal"] as const;
export type InterruptionLevel = (typeof INTERRUPTION_LEVELS)[number];

export type SegmentKind = "warmup" | "question" | "followup" | "wrapup";

export interface SegmentTemplate {
  key: string;
  name: string;
  kind: SegmentKind;
  /** Default minutes at the template's default duration. */
  minutes: number;
}

export interface InterviewTemplate {
  key: InterviewType;
  type: InterviewType;
  title: string;
  description: string;
  defaultMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  segments: readonly SegmentTemplate[];
  rubricId: string;
  /** The code editor (and judge) is part of this interview. */
  usesEditor: boolean;
  /** A drawing board (the system design canvas) is part of this interview. */
  usesCanvas?: boolean;
  /** Needs a confirmed resume to generate questions. */
  needsResume: boolean;
  /** Where questions come from. */
  source: "problems" | "resume" | "bank";
  /** Bank category for `source: bank` templates. */
  bankCategory?: "cs" | "behavioral" | "hld" | "lld";
  /** Candidate turns on one question before the interviewer moves on (0: no cap). */
  followupCap: number;
  /** Time a further question needs. */
  minMsForNext: number;
  /** Hints exist (coding rounds only). */
  hasHints: boolean;
}

/** A segment placed on the timeline of one session. */
export interface PlannedSegment {
  key: string;
  name: string;
  kind: SegmentKind;
  startMs: number;
  endMs: number;
}

export interface ProblemQuestion {
  kind: "problem";
  problemId: string;
  slug: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  /** Segment this question belongs to. */
  segmentKey: string;
}

export interface ProjectQuestion {
  kind: "project";
  id: string;
  question: string;
  /** Resume item the question is about (shown to the user for transparency). */
  sourceRef: string;
  followups: string[];
  rubricPoints: string[];
  difficulty: number;
  segmentKey: string;
}

/** A question from the bank (CS, behavioural or design). */
export interface VerbalQuestion {
  kind: "verbal";
  id: string;
  question: string;
  /** `bank:<slug>`. */
  sourceRef: string;
  category: "cs" | "behavioral" | "hld" | "lld";
  topic: string;
  competency: string | null;
  followups: string[];
  rubricPoints: string[];
  /** Confidential reference answer, for grounding facts. Never shown to the candidate. */
  reference: string;
  difficulty: number;
  segmentKey: string;
}

export type PlannedQuestion = ProblemQuestion | ProjectQuestion | VerbalQuestion;

/** Questions that are asked in words (everything except coding problems). */
export type SpokenQuestion = ProjectQuestion | VerbalQuestion;
export const isSpoken = (q: PlannedQuestion): q is SpokenQuestion => q.kind !== "problem";

export interface InterviewPlan {
  templateKey: InterviewType;
  minutes: number;
  /** Company pack slug the plan was shaped by, if any. */
  packSlug?: string | null;
  /** Rubric weights (0-100) overriding the template's, from the pack. */
  rubricWeights?: Record<string, number> | null;
  /** The pack's interview style, passed to the interviewer prompt. */
  style?: { notes: string; followUpDepth: number } | null;
  /** Lines the interviewer may use to refer back to earlier sessions (X5), when the user allows it. */
  callbacks?: string[];
  segments: PlannedSegment[];
  questions: PlannedQuestion[];
}

export interface TranscriptTurn {
  seq: number;
  speaker: "interviewer" | "candidate" | "system";
  text: string;
  offsetMs: number;
  /** Set when the candidate cut an interviewer reply short: the part they heard. */
  interruptedAfter?: string;
}
