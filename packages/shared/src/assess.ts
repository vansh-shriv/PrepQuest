import { z } from "zod";

// SQL practice and the aptitude / online-assessment simulator (C1, C2). Contracts shared by API and web.

export const sqlQuerySchema = z.object({ query: z.string().max(5000) });
export type SqlQueryInput = z.infer<typeof sqlQuerySchema>;

export type SqlCell = string | number | null;

export interface SqlProblemListItem {
  slug: string;
  title: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  dataset: string;
  datasetTitle: string;
  solved: boolean;
  attempts: number;
}

export interface SqlListResponse {
  problems: SqlProblemListItem[];
  topics: string[];
  solved: number;
  total: number;
}

export interface SqlTableDto {
  name: string;
  columns: Array<{ name: string; type: string; pk: boolean; notNull: boolean }>;
  rowCount: number;
  preview: SqlCell[][];
}

export interface SqlProblemDto {
  slug: string;
  title: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  statement: string;
  orderSensitive: boolean;
  hint: string | null;
  dataset: { slug: string; title: string; description: string | null };
  tables: SqlTableDto[];
  solved: boolean;
  /** Learner's latest query for this problem, to continue from. */
  lastQuery: string | null;
  /** Shown only after the problem is solved. */
  solution: { query: string; note: string | null } | null;
}

export interface SqlRunResult {
  ok: boolean;
  columns: string[];
  rows: SqlCell[][];
  truncated: boolean;
  ms: number;
  error: string | null;
  timedOut: boolean;
}

export interface SqlSubmitResult {
  verdict: "AC" | "WA" | "ERROR" | "TLE";
  message: string | null;
  result: SqlRunResult;
  expected: { columns: string[]; rows: number };
  /** XP paid for this submission: only the first accepted solution of a problem earns it. */
  xpAwarded: number;
  firstSolve: boolean;
  solution: { query: string; note: string | null } | null;
}

// Online assessments

export const oaStartSchema = z.object({ template: z.string().min(2).max(80) });
export type OaStartInput = z.infer<typeof oaStartSchema>;

export const oaAnswerSchema = z.object({
  itemId: z.string().uuid(),
  /** A choice id, typed text, or null to clear the answer. */
  response: z.union([z.string().max(200), z.null()]),
});
export type OaAnswerInput = z.infer<typeof oaAnswerSchema>;

export const APTITUDE_LABELS: Record<string, string> = {
  quant: "Quantitative",
  logical: "Logical reasoning",
  verbal: "Verbal",
  di: "Data interpretation",
  pseudocode: "Pseudocode",
};

export interface OaSectionPlan {
  key: string;
  title: string;
  count: number;
  minutes: number;
}

export interface OaTemplateDto {
  slug: string;
  title: string;
  kind: "oa" | "drill";
  description: string;
  negativeMarking: number;
  calculator: boolean;
  sections: OaSectionPlan[];
  totalMinutes: number;
  totalQuestions: number;
  attempts: number;
  bestPercent: number | null;
}

export interface OaAttemptSummary {
  id: string;
  template: string;
  title: string;
  startedAt: string;
  finishedAt: string | null;
  percent: number | null;
  marks: number | null;
  maxMarks: number | null;
}

export interface OaCatalogResponse {
  templates: OaTemplateDto[];
  recent: OaAttemptSummary[];
  /** An unfinished attempt to resume, if any. */
  open: OaAttemptSummary | null;
}

export interface OaItemDto {
  id: string;
  topic: string;
  type: "single" | "multi" | "tf" | "blank" | "output";
  body: string;
  options: Array<{ id: string; text: string }> | null;
}

export interface OaSectionStatusDto extends OaSectionPlan {
  status: "pending" | "active" | "done";
  endedBy: "submitted" | "time" | null;
  answered: number;
}

export interface OaSectionScoreDto {
  key: string;
  title: string;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  total: number;
  marks: number;
  maxMarks: number;
  percent: number;
  accuracy: number | null;
  secondsUsed: number;
  endedBy: "submitted" | "time" | null;
  /** Share of other finished attempts of this template this one beat; null until enough exist. */
  percentile: number | null;
}

export interface OaReviewItemDto {
  id: string;
  section: string;
  topic: string;
  body: string;
  options: Array<{ id: string; text: string }> | null;
  yourAnswer: string | null;
  correct: boolean;
  answered: boolean;
  answer: string;
  explanation: string;
  shortcut: string | null;
}

export interface OaReportDto {
  sections: OaSectionScoreDto[];
  marks: number;
  maxMarks: number;
  percent: number;
  percentile: number | null;
  weakTopics: Array<{ topic: string; missed: number; total: number }>;
  secondsPerQuestion: number | null;
  rushed: string[];
  xpAwarded: number;
  review: OaReviewItemDto[];
}

export interface OaAttemptDto {
  id: string;
  template: { slug: string; title: string; negativeMarking: number; calculator: boolean };
  startedAt: string;
  finishedAt: string | null;
  sections: OaSectionStatusDto[];
  /** The step the learner is in: inside a section, between sections, or finished. */
  step: "section" | "between" | "finished";
  /** Index of the running section, or of the next one waiting. */
  index: number | null;
  /** Present while a section is running. */
  current: {
    key: string;
    secondsLeft: number;
    deadlineAt: string;
    items: OaItemDto[];
    answers: Record<string, string>;
  } | null;
  report: OaReportDto | null;
}
