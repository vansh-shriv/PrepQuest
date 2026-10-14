import { z } from "zod";

// Integrity review (X2): contracts for the reviewer queue and for a learner's own notices and appeals.

export const INTEGRITY_REVIEW_ROLES = ["moderator", "reviewer", "admin"] as const;

export const FLAG_KINDS = ["similarity", "paste", "focus"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];
export const FLAG_SEVERITIES = ["low", "medium", "high"] as const;
export type FlagSeverityValue = (typeof FLAG_SEVERITIES)[number];
export const FLAG_STATUSES = ["open", "confirmed", "dismissed", "escalated", "appealed"] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

export const flagListQuerySchema = z.object({
  status: z.enum(FLAG_STATUSES).optional(),
  contest: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(80)
    .optional(),
});

export const scanContestSchema = z.object({
  contestSlug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(80),
});

export const flagDecisionSchema = z.object({
  decision: z.enum(["confirm", "dismiss", "escalate"]),
  note: z.string().trim().min(5, "Say why, in a few words").max(1000),
});
export type FlagDecision = z.infer<typeof flagDecisionSchema>;

export const appealSchema = z.object({
  text: z
    .string()
    .trim()
    .min(20, "Tell the reviewer what happened (at least 20 characters)")
    .max(1500),
});

export interface FlagListItem {
  id: string;
  kind: FlagKind;
  severity: FlagSeverityValue;
  score: number | null;
  status: FlagStatus;
  contest: { slug: string; title: string } | null;
  user: { handle: string; displayName: string };
  createdAt: string;
}

export interface FlagListResponse {
  items: FlagListItem[];
  /** Open flags, for the badge on the queue. */
  open: number;
}

export interface FlagCodeSide {
  submissionId: string;
  problemSlug: string;
  language: string;
  handle: string;
  code: string;
  /** Lines (1-based) that belong to a matching stretch. */
  matchedLines: number[];
}

export interface FlagDetail extends FlagListItem {
  counts: { paste: number; blur: number } | null;
  /** Other signals that raised the severity (shown to the reviewer, never to the learner). */
  aggravating: string[];
  /** Weak style markers: context only, never a reason on their own. */
  aiStyle: string[];
  /** Matching pairs, side by side. */
  pairs: Array<{ similarity: number; mine: FlagCodeSide; other: FlagCodeSide }>;
  decisionNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  appealText: string | null;
  appealedAt: string | null;
}

export interface ScanResult {
  contest: string;
  participants: number;
  /** Pairs of accepted solutions that were compared. */
  compared: number;
  flagsCreated: number;
  flagsUpdated: number;
}

/** What a learner is told: that a review reached a decision, why, and whether they can appeal. No evidence. */
export interface MyIntegrityNotice {
  id: string;
  contest: { slug: string; title: string } | null;
  kind: FlagKind;
  status: "confirmed" | "appealed" | "dismissed";
  decisionNote: string | null;
  decidedAt: string | null;
  appealText: string | null;
  canAppeal: boolean;
}
