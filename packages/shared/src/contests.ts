import { z } from "zod";

// Timed contests (D7). Contracts shared by API and web.

export const CONTEST_KINDS = ["weekly", "oa", "private"] as const;
export const CONTEST_SCORING = ["icpc", "points"] as const;

export const createContestSchema = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(1000).optional(),
  /** weekly and oa are public and need a reviewer or admin; private is open to everyone with an invite code. */
  kind: z.enum(CONTEST_KINDS).default("private"),
  scoring: z.enum(CONTEST_SCORING).default("icpc"),
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().min(10).max(360),
  freezeMinutes: z.number().int().min(0).max(60).default(0),
  problems: z
    .array(
      z.object({
        slug: z
          .string()
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
          .max(60),
        points: z.number().int().min(10).max(1000).default(100),
      }),
    )
    .min(1)
    .max(8),
});
export type CreateContestInput = z.infer<typeof createContestSchema>;

export const registerContestSchema = z.object({
  inviteCode: z.string().trim().min(4).max(32).optional(),
});

export const contestEventSchema = z.object({ type: z.enum(["blur", "paste"]) });

export const standingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export type ContestPhaseValue = "upcoming" | "running" | "past";

export interface ContestListItem {
  slug: string;
  title: string;
  kind: (typeof CONTEST_KINDS)[number];
  scoring: (typeof CONTEST_SCORING)[number];
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  phase: ContestPhaseValue;
  problemCount: number;
  participants: number;
  registered: boolean;
}

export interface ContestListResponse {
  contests: ContestListItem[];
}

export interface ContestProblemDto {
  slug: string;
  title: string;
  label: string;
  points: number;
  difficulty: "easy" | "medium" | "hard";
  /** Accepted by the signed-in user in this contest. */
  solved: boolean;
}

export interface ContestDetailDto extends ContestListItem {
  description: string | null;
  freezeMinutes: number;
  /** Hidden until the contest starts (the count is in `problemCount`). */
  problems: ContestProblemDto[] | null;
  /** Only the creator sees the code of a private contest. */
  inviteCode: string | null;
  isCreator: boolean;
  canRegister: boolean;
  /** Seconds until the start (upcoming) or the end (running); 0 once past. */
  secondsLeft: number;
}

export interface StandingCell {
  label: string;
  solved: boolean;
  wrong: number;
  minute: number | null;
  score: number;
  pending: number;
}

export interface StandingRowDto {
  rank: number;
  handle: string;
  displayName: string;
  solved: number;
  penalty: number;
  score: number;
  cells: StandingCell[];
  isMe: boolean;
}

export interface StandingsResponse {
  phase: ContestPhaseValue;
  scoring: (typeof CONTEST_SCORING)[number];
  /** The last minutes are hidden: late solves show as pending until the contest ends. */
  frozen: boolean;
  problems: Array<{ label: string; slug: string; points: number }>;
  rows: StandingRowDto[];
  /** The signed-in user's own row, wherever it is in the table. */
  me: StandingRowDto | null;
  total: number;
  page: number;
  pageSize: number;
}

export interface ContestSubmissionDto {
  id: string;
  label: string;
  language: string;
  verdict: string;
  at: string;
}

export interface ContestMeDto {
  registered: boolean;
  /** The running participation (live, or a virtual run in progress). */
  participation: {
    kind: "live" | "virtual";
    startedAt: string;
    endsAt: string;
    secondsLeft: number;
  } | null;
  submissions: ContestSubmissionDto[];
  /** The best finished virtual run, placed among the real standings. */
  virtual: {
    solved: number;
    penalty: number;
    score: number;
    wouldRank: number;
    of: number;
  } | null;
}
