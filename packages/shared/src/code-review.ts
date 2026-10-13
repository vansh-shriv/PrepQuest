import { z } from "zod";

// Code review mode (X3) and the complexity analyzer (X4): request and response shapes.

export const REVIEW_STRICTNESS = ["gentle", "strict", "pedantic"] as const;
export type ReviewStrictness = (typeof REVIEW_STRICTNESS)[number];

export const REVIEW_SEVERITIES = ["nit", "suggestion", "important"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const REVIEW_CATEGORIES = [
  "readability",
  "idioms",
  "complexity",
  "edge-cases",
  "maintainability",
  "presentation",
] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

/** How many comments each strictness may carry, and which severities it shows. */
export const STRICTNESS_RULES: Record<
  ReviewStrictness,
  { maxComments: number; severities: readonly ReviewSeverity[]; blurb: string }
> = {
  gentle: {
    maxComments: 5,
    severities: ["important", "suggestion"],
    blurb: "Only what matters most, kindly put.",
  },
  strict: {
    maxComments: 10,
    severities: ["important", "suggestion", "nit"],
    blurb: "What an interviewer would notice.",
  },
  pedantic: {
    maxComments: 18,
    severities: ["important", "suggestion", "nit"],
    blurb: "Every nit, naming included.",
  },
};

export const reviewCreateSchema = z.object({
  /** Defaults to the learner's saved setting. */
  strictness: z.enum(REVIEW_STRICTNESS).optional(),
  /** Ask for a cleaner version, which is shown only if the judge accepts it. */
  refactor: z.boolean().default(true),
});
export type ReviewCreate = z.infer<typeof reviewCreateSchema>;

export const codeReviewSettingsSchema = z.object({ strictness: z.enum(REVIEW_STRICTNESS) });

export interface ReviewCommentDto {
  line: number;
  severity: ReviewSeverity;
  category: ReviewCategory;
  message: string;
}

export type RefactorStatus = "none" | "checking" | "verified" | "rejected";

export interface CodeReviewDto {
  id: string;
  submissionId: string;
  strictness: ReviewStrictness;
  status: "pending" | "ready" | "failed";
  summary: string | null;
  comments: ReviewCommentDto[];
  /** 1 to 5 per category. */
  ratings: Partial<Record<ReviewCategory, number>>;
  /** The refactor appears only once the judge has accepted it. */
  refactor: { status: RefactorStatus; code: string | null; notes: string | null };
  error: string | null;
  createdAt: string;
}

// ---- complexity ----

export const complexityCreateSchema = z.object({
  claimed: z.string().trim().min(1, "Say what you think the complexity is").max(40),
});
export type ComplexityCreate = z.infer<typeof complexityCreateSchema>;

export interface ComplexitySampleDto {
  n: number;
  timeMs: number | null;
  memoryKb: number | null;
  /** Ran out of time or memory at this size. */
  limit: boolean;
}

export interface ComplexityDto {
  id: string;
  submissionId: string;
  claimed: string;
  status: "running" | "ready" | "failed";
  samples: ComplexitySampleDto[];
  /** Which class the numbers look like, and the fit quality. */
  measured: { id: string; label: string; r2: number; confidence: "high" | "medium" | "low" } | null;
  /** Other classes that fit within noise. */
  plausible: string[];
  verdict: "matches" | "better" | "worse" | "inconclusive" | null;
  message: string | null;
  hint: { maxLoopDepth: number; deepestLine: number; recursion: boolean } | null;
  /** Always shown: this is an estimate, not a proof. */
  caveat: string;
  error: string | null;
}

export interface ComplexitySupportDto {
  /** The problem has generators for scaling inputs. */
  supported: boolean;
}
