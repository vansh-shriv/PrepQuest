import { z } from "zod";

/** Hints, editorials, rewards and the dashboard (doc 02 D4/D5, doc 04 A1/A2). */

// ---- rewards earned by an accepted submission

export interface SolveRewards {
  /** First accepted solution of this problem: only then is XP earned. */
  firstSolve: boolean;
  xp: number;
  problemXp: number;
  streakBonusXp: number;
  levelBefore: number;
  levelAfter: number;
  streak: { current: number; best: number; usedFreeze: boolean; milestone: number | null };
  /** Badge ids earned by this submission. */
  badges: string[];
}

// ---- hints (D4)

export type HintModeValue = "strict" | "relaxed";

export interface HintTierView {
  tier: number;
  viewed: boolean;
  /** Only for tiers the user has viewed. */
  bodyMd?: string;
  locked?: {
    reason: "previous_tier" | "cooldown";
    /** ISO time the tier becomes available (cooldown). */
    unlockAt?: string;
    missingTier?: number;
  };
}

export interface HintsResponse {
  mode: HintModeValue;
  tiers: HintTierView[];
  /** Highest tier viewed. */
  hintsUsed: number;
}

export interface HintUnlocked {
  tier: number;
  bodyMd: string;
  hintsUsed: number;
}

// ---- editorial (D5)

export interface EditorialApproachDto {
  name: string;
  intuition: string;
  steps: string[];
  code: Record<string, string>;
  time: string;
  space: string;
  pitfalls?: string[];
}

export interface EditorialDto {
  approaches: EditorialApproachDto[];
  talkTrackMd: string | null;
  related: Array<{ slug: string; title: string }>;
  via: "solved" | "hints" | "setting" | "gave_up";
}

export interface EditorialLockedDetails {
  reasons: string[];
  /** ISO time "I give up" becomes available; null when it already is. */
  giveUpAt: string | null;
  canGiveUp: boolean;
}

export const ratingSchema = z.object({ rating: z.enum(["easy", "good", "hard", "again"]) });
export type SolveRating = z.infer<typeof ratingSchema>["rating"];

export const giveUpSchema = z.object({ confirm: z.literal(true) });

// ---- XP and dashboard (A1, A2)

export const DASHBOARD_RANGES = ["7d", "30d", "90d", "all"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const dashboardQuerySchema = z.object({ range: z.enum(DASHBOARD_RANGES).default("30d") });

export interface LevelInfo {
  level: number;
  into: number;
  needed: number;
  fraction: number;
}

export interface XpResponse {
  xp: number;
  level: LevelInfo;
  events: Array<{ delta: number; reason: string; at: string }>;
}

export interface SkillDto {
  topic: string;
  name: string;
  stage: "seed" | "sprout" | "bud" | "bloom";
  mastery: number;
  attempted: number;
  solved: number;
}

export interface RecommendationDto {
  slug: string;
  title: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  reason: string;
}

export interface BadgeDto {
  id: string;
  name: string;
  description: string;
  sprite: string;
  earnedAt: string | null;
}

export interface DashboardDto {
  range: DashboardRange;
  player: {
    xp: number;
    level: LevelInfo;
    /** Streak as of today in the user's time zone (a lapsed streak shows 0). */
    streak: { current: number; best: number; freezes: number };
    today: string;
    timezone: string;
  };
  solved: {
    total: number;
    easy: number;
    medium: number;
    hard: number;
    /** Distinct problems first solved inside the selected range. */
    inRange: number;
    /** Problems accepted per day for the last 30 days, oldest first. */
    daily: number[];
  };
  accuracy: {
    submissions: number;
    accepted: number;
    /** Percent of real submissions accepted (0 with no submissions). */
    acceptanceRate: number;
    /** Percent of solved problems accepted on the first submission. */
    firstTryRate: number;
    /** Mean submissions it took to get accepted, over solved problems. */
    avgAttemptsToAc: number;
  };
  /** Last 26 weeks, oldest first, only days with activity. */
  heatmap: Array<{ day: string; count: number }>;
  skills: SkillDto[];
  weakAreas: Array<{ topic: string; name: string; mastery: number; diagnosis: string | null }>;
  next: RecommendationDto[];
  recent: Array<{
    id: string;
    problem: { slug: string; title: string };
    verdict: string;
    language: string;
    createdAt: string;
  }>;
  sheets: Array<{ slug: string; title: string; solved: number; total: number }>;
  badges: BadgeDto[];
  countdown: { placementDate: string; daysLeft: number } | null;
}
