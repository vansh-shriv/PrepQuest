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

export const INTERVIEW_TYPES = ["dsa", "project"] as const;
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
  /** Needs a confirmed resume to generate questions. */
  needsResume: boolean;
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

export type PlannedQuestion = ProblemQuestion | ProjectQuestion;

export interface InterviewPlan {
  templateKey: InterviewType;
  minutes: number;
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
