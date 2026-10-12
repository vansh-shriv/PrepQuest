import { z } from "zod";

// Spaced repetition, quizzes, roadmaps and company tracks (D6, C1, P3, P4). Doc 04, 02, 11.

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(80);

// ---------------------------------------------------------------- spaced repetition (D6)

export const reviewGradeSchema = z.object({ rating: z.enum(["again", "hard", "good", "easy"]) });
export const reviewSnoozeSchema = z.object({ days: z.number().int().min(1).max(30) });
export const reviewSuspendSchema = z.object({ suspended: z.boolean() });
export const reviewSettingsSchema = z.object({ cap: z.number().int().min(1).max(30) });

export interface ReviewCardDto {
  id: string;
  problem: {
    slug: string;
    title: string;
    difficulty: "easy" | "medium" | "hard";
    topics: string[];
  };
  dueOn: string;
  /** Days past the due date (0 when due today). */
  overdueDays: number;
  intervalDays: number;
  ease: number;
  lapses: number;
  suspended: boolean;
}

export interface ReviewsResponse {
  today: string;
  cap: number;
  doneToday: number;
  /** Due cards beyond today's cap: they carry over. */
  waiting: number;
  due: ReviewCardDto[];
  /** Cards coming due in the next seven days, by day. */
  upcoming: Array<{ date: string; count: number }>;
  paused: ReviewCardDto[];
  stats: { cards: number; mature: number; lapses: number; retention: number | null };
}

export interface ReviewGradeResponse {
  id: string;
  intervalDays: number;
  dueOn: string;
  lapses: number;
  /** A failed review: the card starts over at one day. */
  lapsed: boolean;
}

// ---------------------------------------------------------------- quizzes (C1)

export const QUIZ_SUBJECT_LABELS: Record<string, string> = {
  os: "Operating systems",
  dbms: "Databases",
  cn: "Computer networks",
  oop: "Object-oriented design",
  sql: "SQL",
  embedded: "Embedded systems",
  ml: "Machine learning basics",
};

export const createQuizAttemptSchema = z.object({
  mode: z.enum(["practice", "timed", "drill", "weak"]),
  subject: z.string().max(20).optional(),
  topic: z.string().max(40).optional(),
  count: z.number().int().min(3).max(30).optional(),
  /** Timed tests only: minutes for the whole test. */
  minutes: z.number().int().min(1).max(90).optional(),
});
export type CreateQuizAttemptInput = z.infer<typeof createQuizAttemptSchema>;

export const quizAnswerSchema = z.object({
  questionId: z.string().uuid(),
  response: z.union([z.string().max(500), z.boolean(), z.array(z.string().max(20)).max(6)]),
  timeMs: z.number().int().min(0).max(3_600_000).optional(),
});
export type QuizAnswerInput = z.infer<typeof quizAnswerSchema>;

export interface QuizCatalogResponse {
  subjects: Array<{
    subject: string;
    label: string;
    questions: number;
    topics: Array<{ topic: string; questions: number }>;
    /** The learner's own record in this subject. */
    answered: number;
    correct: number;
  }>;
  /** Questions whose latest answer was wrong: what a weak-area quiz draws from. */
  weakCount: number;
  recent: QuizHistoryItem[];
}

export interface QuizHistoryItem {
  id: string;
  mode: string;
  subject: string | null;
  finishedAt: string | null;
  correct: number | null;
  total: number;
}

export interface QuizQuestionDto {
  id: string;
  subject: string;
  topic: string;
  difficulty: number;
  type: "single" | "multi" | "tf" | "blank" | "output";
  body: string;
  options: Array<{ id: string; text: string }> | null;
}

export interface QuizAttemptDto {
  id: string;
  mode: "practice" | "timed" | "drill" | "weak";
  subject: string | null;
  total: number;
  startedAt: string;
  /** Timed tests end here whether or not the browser stays open. */
  deadlineAt: string | null;
  finished: boolean;
  questions: QuizQuestionDto[];
  /** Question ids already answered (so a reload resumes where it stopped). */
  answered: string[];
}

export interface QuizAnswerResult {
  saved: true;
  /** Practice-style modes reveal the answer straight away; timed tests wait for the end. */
  feedback: null | {
    correct: boolean;
    answer: unknown;
    explanation: string;
    interviewLine: string | null;
  };
}

export interface QuizResultDto {
  id: string;
  mode: string;
  correct: number;
  total: number;
  percent: number;
  medianSeconds: number | null;
  xpAwarded: number;
  /** The attempt ended because the clock ran out. */
  expired: boolean;
  review: Array<{
    question: QuizQuestionDto;
    response: unknown;
    answered: boolean;
    correct: boolean;
    answer: unknown;
    explanation: string;
    interviewLine: string | null;
  }>;
}

// ---------------------------------------------------------------- roadmaps (P3)

export type RoadmapNodeState = "locked" | "open" | "cleared" | "mastered";

export interface RoadmapSummaryDto {
  slug: string;
  title: string;
  track: string;
  description: string | null;
  nodes: number;
  cleared: number;
  mastered: number;
  /** The node to work on next, if any. */
  nextNode: { id: string; title: string } | null;
}

export interface RoadmapNodeDto {
  id: string;
  title: string;
  summary: string;
  state: RoadmapNodeState;
  /** 0 to 1, or null when there is no evidence yet. */
  mastery: number | null;
  layer: number;
  requires: string[];
  /** Titles of the prerequisites still blocking this node. */
  blockedBy: string[];
  unlockThreshold: number;
  masterThreshold: number;
  resources: Array<{ title: string; kind: string; note?: string }>;
  /** The measure: a topic, a quiz subject, or the ladder alone. */
  measure: { kind: "topic" | "quiz" | "ladder"; label: string };
  ladder: Array<{
    slug: string;
    title: string;
    difficulty: "easy" | "medium" | "hard";
    solved: boolean;
    /** The last problem of a ladder is the checkpoint. */
    checkpoint: boolean;
  }>;
  quiz: { subject: string; href: string } | null;
}

export interface RoadmapDto {
  slug: string;
  title: string;
  track: string;
  description: string | null;
  nodes: RoadmapNodeDto[];
  nextNode: string | null;
}

export interface RoadmapsResponse {
  roadmaps: RoadmapSummaryDto[];
}

// ---------------------------------------------------------------- company tracks (P4)

export const trackCompareQuery = z.object({ a: slug, b: slug });

export interface TrackProblemDto {
  slug: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  topics: string[];
  solved: boolean;
}

export interface TrackSummaryDto {
  slug: string;
  title: string;
  role: string;
  level: string;
  reviewedAt: string | null;
  started: boolean;
  solved: number;
  total: number;
}

export interface TrackDto extends TrackSummaryDto {
  disclaimer: string;
  process: Array<{ round: string; type?: string; format?: string; minutes: number }>;
  heatmap: Array<{ topic: string; name: string; weight: number; heat: number }>;
  problems: TrackProblemDto[];
  behavioralCompetencies: string[];
  checklist: string[];
  pitfalls: string[];
  interviewStyle: { bar: string; notes: string };
  /** Readiness for this company, when there is enough evidence. */
  readiness: { score: number | null; band: number | null; label: string };
  /** Where to practise the rounds: a ready-made interview configuration. */
  interview: { href: string; types: string[] };
  planHref: string;
}

export interface TracksResponse {
  tracks: TrackSummaryDto[];
}

export interface TrackCompareResponse {
  a: { slug: string; title: string };
  b: { slug: string; title: string };
  shared: TrackProblemDto[];
  onlyA: TrackProblemDto[];
  onlyB: TrackProblemDto[];
  /** Share of B's list that preparing for A already covers (0 to 1). */
  coversB: number;
  coversA: number;
  /** What to add for B if you are ready for A. */
  addForB: TrackProblemDto[];
}

export interface StartTrackResponse {
  track: TrackDto;
  /** The study plan was (re)built around this company. */
  planCreated: boolean;
}
