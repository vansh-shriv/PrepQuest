import { z } from "zod";

// Shareable reports (U5). Contracts shared by the API and the web app.

export const SHARE_ENTITIES = ["scorecard", "contest", "readiness"] as const;
export type ShareEntity = (typeof SHARE_ENTITIES)[number];

export const SHARE_EXPIRY = ["7d", "30d", "never"] as const;

/** What the viewer may see. The defaults share a summary and scores only. */
export const shareOptionsSchema = z.object({
  /** Leave out quotes from the interview transcript (the evidence behind each score). */
  hideTranscript: z.boolean().default(true),
  /** Leave out quotes from the learner's code. */
  hideCode: z.boolean().default(true),
  /** Remove the company name, in the header and inside the texts. */
  hideCompany: z.boolean().default(true),
  /** Show "A PrepQuest learner" instead of the learner's name and handle. */
  hideName: z.boolean().default(false),
});
export type ShareOptions = z.infer<typeof shareOptionsSchema>;

export const createShareSchema = z
  .object({
    entityType: z.enum(SHARE_ENTITIES),
    /** Interview session id (scorecard), contest slug (contest) or target (readiness, optional). */
    ref: z.string().min(1).max(100).optional(),
    visibility: z.enum(["unlisted", "public"]).default("unlisted"),
    options: shareOptionsSchema.default({
      hideTranscript: true,
      hideCode: true,
      hideCompany: true,
      hideName: false,
    }),
    expiresIn: z.enum(SHARE_EXPIRY).default("30d"),
  })
  .refine((v) => v.entityType === "readiness" || Boolean(v.ref), {
    message: "Say which report to share.",
    path: ["ref"],
  });
export type CreateShareInput = z.infer<typeof createShareSchema>;

export interface ScorecardReport {
  kind: "scorecard";
  title: string;
  interviewType: string;
  level: string;
  role: string | null;
  company: string | null;
  minutes: number;
  overall: number | null;
  band: string | null;
  summary: string | null;
  scores: Array<{
    name: string;
    score: number | null;
    weight: number;
    justification: string;
    quotes: string[];
  }>;
  strengths: Array<{ text: string; quotes: string[] }>;
  redFlags: Array<{ category: string; severity: string; text: string }>;
}

export interface ContestReport {
  kind: "contest";
  title: string;
  scoring: "icpc" | "points";
  rank: number;
  of: number;
  solved: number;
  penalty: number;
  score: number;
  problems: Array<{ label: string; solved: boolean; minute: number | null; wrong: number }>;
}

export interface ReadinessReport {
  kind: "readiness";
  title: string;
  target: string;
  label: string;
  score: number | null;
  band: number | null;
  coverage: number;
  components: Array<{ label: string; score: number | null; weight: number }>;
}

export type ReportPayload = ScorecardReport | ContestReport | ReadinessReport;

export interface ShareDto {
  id: string;
  entityType: ShareEntity;
  title: string;
  visibility: "unlisted" | "public";
  options: ShareOptions;
  expiresAt: string | null;
  revokedAt: string | null;
  views: number;
  createdAt: string;
  /** Active, expired or revoked. */
  status: "active" | "expired" | "revoked";
}

export interface CreatedShareDto extends ShareDto {
  /** The secret part of the link. It is shown once: only a hash is stored. */
  token: string;
  path: string;
}

export interface PublicReportDto {
  entityType: ShareEntity;
  title: string;
  /** "A PrepQuest learner" when the owner hid their name. */
  owner: string;
  createdAt: string;
  visibility: "unlisted" | "public";
  payload: ReportPayload;
}
