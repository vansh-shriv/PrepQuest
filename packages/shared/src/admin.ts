import { z } from "zod";
import { DIFFICULTY_VALUES, signatureSchema, type ProblemExample } from "./problems.js";

/** Admin and content-workflow contracts (doc 11 §12, doc 17 §8). */

export const CONTENT_ROLES = ["content_editor", "reviewer", "admin"] as const;
export const PROBLEM_STATUSES = ["draft", "in_review", "published", "archived"] as const;
export type ProblemStatusValue = (typeof PROBLEM_STATUSES)[number];

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case")
  .min(3)
  .max(60);
const tagList = z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)).max(8);
const example = z.object({
  input: z.string().min(1).max(2000),
  output: z.string().min(1).max(2000),
  explanation: z.string().max(1000).optional(),
});
const limits = z.object({
  timeLimitMs: z.number().int().min(500).max(10_000),
  memoryLimitKb: z.number().int().min(65_536).max(1_048_576),
});

export const createProblemSchema = z.object({
  slug,
  title: z.string().trim().min(3).max(100),
  difficulty: z.enum(DIFFICULTY_VALUES),
  statementMd: z.string().max(20_000).default(""),
  constraintsMd: z.string().max(5_000).default(""),
  topics: tagList.min(1),
  patterns: tagList.default([]),
  estMinutes: z.number().int().min(5).max(120),
  signature: signatureSchema,
});
export type CreateProblem = z.infer<typeof createProblemSchema>;

export const updateProblemSchema = z
  .object({
    title: z.string().trim().min(3).max(100),
    difficulty: z.enum(DIFFICULTY_VALUES),
    statementMd: z.string().max(20_000),
    constraintsMd: z.string().max(5_000),
    examples: z.array(example).min(1).max(5),
    topics: tagList.min(1),
    patterns: tagList,
    estMinutes: z.number().int().min(5).max(120),
    limits,
    starters: z
      .object({
        cpp: z.string().max(20_000),
        java: z.string().max(20_000),
        python: z.string().max(20_000),
      })
      .partial(),
  })
  .partial()
  .strict();
export type UpdateProblem = z.infer<typeof updateProblemSchema>;

/** Archiving, and other dangerous actions, need a reason that lands in the audit log. */
export const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });

export const adminListQuerySchema = z.object({
  status: z.enum(PROBLEM_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export interface AdminProblemListItem {
  id: string;
  slug: string;
  title: string;
  difficulty: (typeof DIFFICULTY_VALUES)[number];
  status: ProblemStatusValue;
  version: number;
  tests: number;
  createdBy: string | null;
  updatedAt: string;
}

export interface AdminTest {
  ordinal: number;
  kind: "sample" | "hidden" | "edge" | "stress";
  label: string | null;
  weight: number;
  inputBytes: number | null;
}

export interface AdminProblemDetail extends AdminProblemListItem {
  statementMd: string;
  constraintsMd: string | null;
  examples: ProblemExample[];
  topics: string[];
  patterns: string[];
  estMinutes: number | null;
  signature: z.infer<typeof signatureSchema> | null;
  limits: { timeLimitMs: number; memoryLimitKb: number };
  starters: { cpp: string; java: string; python: string };
  hints: Array<{ tier: 1 | 2 | 3; bodyMd: string }>;
  testCases: AdminTest[];
  /** What the signed-in admin may do with this problem right now. */
  permissions: {
    edit: boolean;
    submitReview: boolean;
    publish: boolean;
    archive: boolean;
    uploadTests: boolean;
  };
}

export interface ValidationCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail?: string;
}

export interface ValidationReport {
  ok: boolean;
  checks: ValidationCheck[];
}

export interface VersionInfo {
  version: number;
  changedBy: string | null;
  changeNote: string | null;
  createdAt: string;
  tests: number | null;
  current: boolean;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  createdAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
