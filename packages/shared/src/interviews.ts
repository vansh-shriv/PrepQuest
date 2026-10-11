import { z } from "zod";

// Contracts for resumes, job descriptions and interviews (docs 03, 11 §7-8), shared by API and web.

const str = (max: number) => z.string().trim().max(max);
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max).default([]);

export const resumeParsedSchema = z.object({
  education: list(
    z.object({
      institution: str(200),
      degree: str(200).nullish(),
      field: str(200).nullish(),
      start: str(40).nullish(),
      end: str(40).nullish(),
      gpa: str(40).nullish(),
    }),
    10,
  ),
  experience: list(
    z.object({
      company: str(200),
      role: str(200).nullish(),
      start: str(40).nullish(),
      end: str(40).nullish(),
      bullets: list(str(600), 15),
      tech: list(str(60), 20),
    }),
    15,
  ),
  projects: list(
    z.object({
      name: str(200),
      summary: str(1200).default(""),
      tech: list(str(60), 20),
      bullets: list(str(600), 15),
      metrics: list(str(200), 10),
    }),
    15,
  ),
  skills: z
    .object({
      languages: list(str(60), 40),
      frameworks: list(str(60), 40),
      tools: list(str(60), 40),
      domains: list(str(60), 40),
    })
    .default({ languages: [], frameworks: [], tools: [], domains: [] }),
  achievements: list(str(400), 15),
  claims: list(
    z.object({
      text: str(500),
      section: str(60).default(""),
      metric: str(200).nullish(),
    }),
    30,
  ),
});
export type ResumeParsed = z.infer<typeof resumeParsedSchema>;

export const RESUME_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export const updateParsedResumeSchema = z.object({
  parsed: resumeParsedSchema,
  label: str(80).min(1).optional(),
  /** Marks the parsed data as reviewed by the user (the resume becomes `ready`). */
  confirm: z.boolean().default(false),
});
export type UpdateParsedResumeInput = z.infer<typeof updateParsedResumeSchema>;

export const createJdSchema = z.object({
  company: str(120).nullish(),
  role: str(120).nullish(),
  text: str(20_000).min(40),
  resumeId: z.string().uuid().nullish(),
});
export type CreateJdInput = z.infer<typeof createJdSchema>;

export const jdAnalysisSchema = z.object({
  required: list(str(200), 30),
  nice_to_have: list(str(200), 30),
  responsibilities: list(str(300), 20),
  seniority: str(60).default(""),
  keywords: list(str(60), 40),
});
export type JdAnalysis = z.infer<typeof jdAnalysisSchema>;

export const jdGapSchema = z.object({
  matched: list(str(200), 40),
  missing: list(str(200), 40),
  weak_evidence: list(str(200), 40),
});
export type JdGap = z.infer<typeof jdGapSchema>;

// --- interviews -----------------------------------------------------------------------------

export const INTERVIEW_TYPE_VALUES = [
  "dsa",
  "project",
  "resume",
  "cs",
  "behavioral",
  "lld",
  "hld",
] as const;
export type InterviewTypeValue = (typeof INTERVIEW_TYPE_VALUES)[number];

export const planInterviewSchema = z.object({
  type: z.enum(INTERVIEW_TYPE_VALUES),
  /** A curated company pack (by slug) that shapes the plan and the scorecard weights. */
  packSlug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(80)
    .nullish(),
  role: str(120).nullish(),
  company: str(120).nullish(),
  level: z.enum(["intern", "sde1", "sde2"]).default("sde1"),
  persona: z.enum(["friendly", "neutral", "strict", "rapid"]).default("neutral"),
  /** How the candidate talks to the interviewer: typing, speaking, or both. */
  mode: z.enum(["text", "voice", "mixed"]).default("text"),
  difficulty: z.number().int().min(1).max(5).default(3),
  adaptive: z.boolean().default(true),
  hintBudget: z.number().int().min(0).max(3).default(2),
  interruptionLevel: z.enum(["off", "low", "normal"]).default("normal"),
  realistic: z.boolean().default(true),
  minutes: z.number().int().min(15).max(60).optional(),
  resumeId: z.string().uuid().nullish(),
  jdId: z.string().uuid().nullish(),
});
export type PlanInterviewInput = z.infer<typeof planInterviewSchema>;

/** Optional overrides to the previewed plan (doc 03 I2: users can override any plan item). */
export const createInterviewSchema = planInterviewSchema.extend({
  problemSlugs: z.array(z.string().max(120)).max(2).optional(),
  /** Resume items (`projects[0]`, `experience[1]`) to cover in a project deep-dive. */
  projectRefs: z.array(z.string().max(40)).max(3).optional(),
  /** Bank questions (`bank:<slug>` slugs) to ask instead of a random draw. */
  questionSlugs: z.array(z.string().max(80)).max(8).optional(),
});
export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;

export const interviewMessageSchema = z.object({
  clientMsgId: z.string().min(1).max(80),
  text: z.string().min(1).max(4000),
  modality: z.enum(["text", "voice"]).default("text"),
  /** Word timestamps from speech recognition, relative to the start of the utterance. */
  words: z
    .array(z.object({ w: z.string().max(80), startMs: z.number(), endMs: z.number() }))
    .max(1500)
    .optional(),
});

/** The candidate cut an interviewer reply short; `charIndex` is how far the speech engine got. */
export const bargeInSchema = z.object({
  turnId: z.string().uuid(),
  charIndex: z.number().int().min(0).max(10_000),
});
export type BargeInInput = z.infer<typeof bargeInSchema>;
export type InterviewMessageInput = z.infer<typeof interviewMessageSchema>;

export const interviewFeedbackSchema = z.object({
  helpful: z.boolean(),
  text: str(1000).nullish(),
});

export const interviewCodeEventSchema = z.object({
  kind: z.enum(["snapshot", "run", "submit", "paste", "focus_lost"]),
  language: str(20).nullish(),
  code: z.string().max(60_000).nullish(),
  submissionId: z.string().uuid().nullish(),
  meta: z.record(z.string(), z.unknown()).nullish(),
});
export type InterviewCodeEventInput = z.infer<typeof interviewCodeEventSchema>;

// --- response shapes (the API's DTOs, shared with the web client) --------------------------------

export type InterviewStateName =
  | "SETUP"
  | "WARMUP"
  | "PROBLEM"
  | "CLARIFY"
  | "APPROACH"
  | "CODING"
  | "TESTING"
  | "OPTIMIZE"
  | "FOLLOWUP"
  | "WRAPUP"
  | "ENDING"
  | "COMPLETED"
  | "ABANDONED"
  | "FAILED";

export interface InterviewSegmentDto {
  key: string;
  name: string;
  kind: string;
  startMs: number;
  endMs: number;
}

export type InterviewQuestionDto =
  | { kind: "problem" | "project" | "verbal"; segment: string; hidden: true }
  | {
      kind: "problem";
      segment: string;
      hidden: false;
      slug: string;
      title: string;
      difficulty: "easy" | "medium" | "hard";
    }
  | { kind: "project"; segment: string; hidden: false; sourceRef: string; title: string }
  | {
      kind: "verbal";
      segment: string;
      hidden: false;
      sourceRef: string;
      title: string;
      category: string;
    };

export interface InterviewSessionDto {
  id: string;
  type: InterviewTypeValue;
  title: string;
  usesEditor: boolean;
  state: InterviewStateName;
  persona: string;
  level: string;
  role: string | null;
  company: string | null;
  difficulty: number;
  adaptive: boolean;
  realistic: boolean;
  hintBudget: number;
  hintsGiven: number;
  hintsLeft: number;
  mode: string;
  minutes: number;
  segments: InterviewSegmentDto[];
  questions: InterviewQuestionDto[];
  questionIndex: number;
  startedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  paused: boolean;
  pausesUsed: number;
  remainingMs: number;
  elapsedMs: number;
  resumeId: string | null;
  jdId: string | null;
  createdAt: string;
}

export interface InterviewTurnDto {
  seq: number;
  speaker: "interviewer" | "candidate" | "system";
  text: string;
  offsetMs: number;
  turnId: string;
  hintUsed: boolean;
  modality: "text" | "voice";
  /** The candidate cut this reply short (voice). */
  interrupted: boolean;
}

export interface InterviewTemplateDto {
  type: InterviewTypeValue;
  title: string;
  description: string;
  defaultMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  segments: { name: string; minutes: number; kind: string }[];
  usesEditor: boolean;
  needsResume: boolean;
}

export interface InterviewPlanPreviewDto {
  type: InterviewTypeValue;
  title: string;
  minutes: number;
  segments: InterviewSegmentDto[];
  questions: (
    | {
        kind: "problem";
        slug: string;
        title: string;
        difficulty: "easy" | "medium" | "hard";
        tags: string[];
      }
    | { kind: "project"; sourceRef: string; title: string }
    | { kind: "verbal"; sourceRef: string; title: string; category: string; topic: string }
  )[];
  /** The pack applied (curated, or inferred from the free-text target and flagged). */
  pack: { slug: string; title: string; provisional: boolean } | null;
  /** What the pack changes, in plain words. */
  packEffects: string[];
  /** Rubric weights (percent) in effect. */
  rubricWeights: { key: string; name: string; weight: number }[];
  resumeId: string | null;
  jdId: string | null;
  warnings: string[];
  note: string | null;
}

export interface InterviewListItemDto {
  id: string;
  type: string;
  title: string;
  persona: string;
  difficulty: number;
  state: InterviewStateName;
  endReason: string | null;
  startedAt: string | null;
  endedAt: string | null;
  overall: number | null;
  band: string | null;
  scorecardStatus: "none" | "generating" | "ready" | "failed";
  createdAt: string;
}

export interface EvidenceDto {
  type: "turn" | "code";
  ref: number | string;
  quote: string;
}

export interface ScorecardDto {
  overall: number | null;
  band: string | null;
  summary: string | null;
  strengths: { text: string; evidence: EvidenceDto[] }[];
  redFlags: {
    category: string;
    severity: "low" | "medium" | "high";
    text: string;
    evidence: EvidenceDto[];
    remedy: string;
  }[];
  nextActions: { kind: string; ref: string; title: string; why: string }[];
  coverage: {
    rubric: number;
    session: number;
    endReason: string | null;
    lowConfidence: boolean;
  } | null;
  helpful: number | null;
  rubric: { id: string; version: string };
  model: string | null;
  scores: {
    dimension: string;
    name: string;
    score: number | null;
    weight: number;
    justification: string;
    evidence: EvidenceDto[];
  }[];
}

export interface AnnotationDto {
  id: string;
  turnSeq: number;
  offsetMs: number;
  kind: "positive" | "improve" | "missed" | "red_flag";
  dimension: string | null;
  text: string;
  severity: string | null;
  note: string | null;
}

export interface InterviewReviewDto {
  status: "none" | "generating" | "failed" | "ready";
  session: InterviewSessionDto;
  transcript: InterviewTurnDto[];
  scorecard: ScorecardDto | null;
  annotations: AnnotationDto[];
}

export interface ResumeDto {
  id: string;
  label: string;
  mime: string;
  bytes: number;
  status: "uploaded" | "parsing" | "needs_review" | "ready" | "failed";
  parseError: string | null;
  parsed: ResumeParsed | null;
  claims: unknown;
  isDefault: boolean;
  confirmedAt: string | null;
  createdAt: string;
}

export interface JdDto {
  id: string;
  company: string | null;
  role: string | null;
  analysis: JdAnalysis | null;
  gap: JdGap | null;
  resumeId: string | null;
  createdAt: string;
}

// --- company packs, ideal answers, STAR, speech analytics, question history ---------------------

export interface CompanyPackDto {
  slug: string;
  title: string;
  role: string;
  level: string;
  disclaimer: string;
  provisional: boolean;
  reviewedAt: string | null;
  process: { round: string; type?: string; format?: string; minutes: number }[];
  topWeights: { topic: string; weight: number }[];
  difficultyBand: { easy: number; medium: number; hard: number };
  style: { bar: string; followUpDepth: number; hintPolicy: string; notes: string };
  competencies: string[];
  checklist: string[];
  pitfalls: string[];
}

export interface IdealAnswerDto {
  questionIndex: number;
  questionRef: string;
  questionText: string;
  userAnswerSummary: string;
  idealMd: string;
  gaps: string[];
  extras: string[];
  starRewriteMd: string | null;
  addedSuggestions: string[];
}

export interface StarScoreDto {
  turnSeq: number;
  s: number;
  t: number;
  a: number;
  r: number;
  specificity: number;
  impact: number;
  reflection: number;
  completeness: number;
  ownershipRatio: number | null;
  justification: string | null;
  rewriteMd: string | null;
}

export interface SpeechMetricsDto {
  basis: "voice" | "text";
  words: number;
  wpm: number | null;
  fillerCounts: Record<string, number>;
  fillerPerMin: number | null;
  hedgingRate: number;
  longPauses: { seq: number; atMs: number; lengthMs: number; kind: "thinking" | "dead_air" }[];
  series: { seq: number; offsetMs: number; wpm: number | null; words: number }[];
  flags: string[];
  /** Always shown with the numbers: these are indicators, not a diagnosis. */
  note: string;
}

export interface QuestionHistoryItemDto {
  id: string;
  kind: string;
  questionText: string;
  topic: string | null;
  outcome: number | null;
  weak: boolean;
  askedAt: string;
}
