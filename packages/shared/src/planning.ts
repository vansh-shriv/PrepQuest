import { z } from "zod";

// Analytics, readiness, study plans and daily goals (A2 to A5, P1, P2). Doc 04, doc 11 §9.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(80);

export const WEEKDAY_VALUES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekdayValue = (typeof WEEKDAY_VALUES)[number];

export const MOCK_TYPE_VALUES = [
  "dsa",
  "cs",
  "behavioral",
  "project",
  "resume",
  "lld",
  "hld",
] as const;

/** Everything the user can set when generating a plan; anything left out comes from the profile. */
export const generatePlanSchema = z.object({
  placementDate: day.nullish(),
  hoursPerDay: z.partialRecord(z.enum(WEEKDAY_VALUES), z.number().min(0).max(16)).optional(),
  defaultHours: z.number().min(0).max(16).optional(),
  restDays: z.array(z.enum(WEEKDAY_VALUES)).max(7).optional(),
  mockPerWeek: z.number().int().min(0).max(4).optional(),
  mockTypes: z.array(z.enum(MOCK_TYPE_VALUES)).max(7).optional(),
  packSlug: slug.nullish(),
});
export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;

export const patchPlanTaskSchema = z
  .object({
    status: z.enum(["todo", "done", "skipped"]).optional(),
    locked: z.boolean().optional(),
    date: day.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");
export type PatchPlanTaskInput = z.infer<typeof patchPlanTaskSchema>;

export const customTaskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  date: day,
  estMinutes: z.number().int().min(5).max(240).default(30),
});
export type CustomTaskInput = z.infer<typeof customTaskSchema>;

export const GOAL_TYPE_VALUES = ["problems", "xp", "interviews_week", "plan_tasks"] as const;
export const goalItemSchema = z.object({
  type: z.enum(GOAL_TYPE_VALUES),
  target: z.number().int().min(1).max(50),
});
export const goalTemplateSchema = z
  .object({
    preset: z.enum(["light", "standard", "intense", "weekend", "custom"]).optional(),
    items: z.array(goalItemSchema).min(1).max(6).optional(),
  })
  .refine((v) => v.preset !== undefined || v.items !== undefined, "Nothing to change");
export type GoalTemplateInput = z.infer<typeof goalTemplateSchema>;

export const patchTodayGoalsSchema = z.object({ items: z.array(goalItemSchema).min(1).max(6) });

export const targetQuery = z.object({ target: slug.optional() });

// --- responses -------------------------------------------------------------------------------

export interface TopicAnalyticsDto {
  topic: string;
  name: string;
  mastery: number;
  confidence: number;
  weakness: number;
  stage: "seed" | "sprout" | "bud" | "bloom";
  attempted: number;
  solved: number;
  diagnosis: string | null;
  importance: number;
  signals: {
    solve: number;
    speed: number | null;
    independence: number;
    interview: number | null;
    retention: number | null;
  };
}

export interface NextActionDto {
  kind: "problem" | "interview" | "diagnostic" | "review";
  title: string;
  /** Where the Start button goes. */
  href: string;
  why: string;
  difficulty?: "easy" | "medium" | "hard";
  topic?: string;
}

export interface TopicsResponse {
  target: string;
  topics: TopicAnalyticsDto[];
  recommendations: NextActionDto[];
}

export interface ReadinessComponentDto {
  key: string;
  label: string;
  source: string;
  weight: number;
  score: number | null;
  confidence: number;
  points: number;
  headroom: number;
}

export interface ReadinessDto {
  target: string;
  targetTitle: string;
  score: number | null;
  band: number | null;
  label: string;
  coverage: number;
  components: ReadinessComponentDto[];
  limiting: ReadinessComponentDto[];
  levers: { action: string; gain: number; component: string }[];
  eta: {
    goal: number;
    date: string | null;
    pointsPerDay: number | null;
    message: string;
    onTrack: boolean | null;
  };
  placementDate: string | null;
  /** True when the user has no data yet and should take the diagnostic. */
  needsDiagnostic: boolean;
  note: string;
}

export interface ReadinessHistoryResponse {
  target: string;
  items: { date: string; score: number | null; band: number | null }[];
}

export interface TrendsResponse {
  points: {
    id: string;
    at: string;
    type: string;
    overall: number;
    moving: number;
    settingsChanged: boolean;
  }[];
  best: string | null;
  worst: string | null;
  deltas: { dimension: string; delta: number; recent: number; previous: number }[];
  habits: { flag: string; count: number; of: number; message: string }[];
  speech: { id: string; at: string; fillerPerMin: number | null; wpm: number | null }[];
  excluded: number;
  sessions: number;
}

export interface TimeAnalyticsResponse {
  summaries: {
    difficulty: "easy" | "medium" | "hard";
    count: number;
    medianSeconds: number | null;
    expectedSeconds: number;
    histogram: number[];
    outliers: number;
  }[];
  phases: { think: number; debug: number; solves: number } | null;
  slowest: { slug: string; title: string; difficulty: string; seconds: number }[];
  coaching: string | null;
  note: string;
}

export interface DiagnosticDto {
  id: string;
  startedAt: string;
  completedAt: string | null;
  problems: {
    slug: string;
    title: string;
    difficulty: "easy" | "medium" | "hard";
    topic: string;
    status: "todo" | "attempted" | "solved";
  }[];
  answered: number;
  total: number;
}

export interface PlanTaskDto {
  id: string;
  date: string;
  kind: string;
  refType: string | null;
  ref: string | null;
  title: string;
  estMinutes: number;
  status: "todo" | "done" | "skipped" | "moved";
  locked: boolean;
  custom: boolean;
  why: string;
  phase: string;
  topic: string | null;
  /** In-app link to do the task. */
  href: string | null;
}

export interface PlanDiffDto {
  added: { key: string; title: string; date: string }[];
  removed: { key: string; title: string; date: string }[];
  moved: { key: string; title: string; from: string; to: string }[];
  unchanged: number;
  summary: string;
}

export interface PlanDto {
  id: string;
  version: number;
  target: string;
  placementDate: string | null;
  inputs: {
    hoursPerDay: Record<string, number>;
    defaultHours: number;
    restDays: string[];
    mockPerWeek: number;
    efficiency: number;
    mockTypes: string[];
  };
  phases: { name: string; label: string; start: string; end: string }[];
  warnings: string[];
  narrativeMd: string | null;
  tasks: PlanTaskDto[];
  minutesPerDay: Record<string, number>;
  today: string;
  lastDiff:
    (PlanDiffDto & { reason: string; fromVersion: number; toVersion: number; at: string }) | null;
}

export interface GoalProgressDto {
  type: "problems" | "xp" | "interviews_week" | "plan_tasks";
  label: string;
  target: number;
  progress: number;
  done: boolean;
}

export interface GoalsTodayResponse {
  date: string;
  preset: string;
  items: GoalProgressDto[];
  completed: boolean;
  rewardXp: number;
  suggestion: { direction: "lower" | "raise"; message: string } | null;
}

export interface GoalTemplateResponse {
  preset: string;
  items: { type: GoalProgressDto["type"]; target: number }[];
  presets: {
    key: string;
    label: string;
    minutes: number;
    items: { type: string; target: number }[];
  }[];
}

export interface QuestBoardResponse {
  goals: GoalsTodayResponse;
  tasks: PlanTaskDto[];
  hasPlan: boolean;
  readiness: { score: number | null; band: number | null; label: string; needsDiagnostic: boolean };
  /** Spaced-repetition reviews waiting today (already limited by the daily cap). */
  reviews: { due: number; waiting: number; cap: number; doneToday: number };
  next: NextActionDto | null;
}
