import { z } from "zod";

/** Problem-bank contracts shared by the API and the web app (doc 11 §3). */

/** Accepts repeated params (`?topic=a&topic=b`) or CSV (`?topic=a,b`). */
const listParam = <T extends z.ZodType<string>>(item: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return [];
    const parts = Array.isArray(v) ? v : [v];
    return parts
      .flatMap((p) => String(p).split(","))
      .map((s) => s.trim())
      .filter(Boolean);
  }, z.array(item).max(20));

const slugLike = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(60);

export const DIFFICULTY_VALUES = ["easy", "medium", "hard"] as const;
export const STATUS_FILTERS = ["unsolved", "attempted", "solved"] as const;
export const SORTS = ["default", "difficulty", "acceptance", "recent"] as const;
export const LANGUAGE_VALUES = ["cpp", "java", "python"] as const;
export type LanguageValue = (typeof LANGUAGE_VALUES)[number];

export const problemListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  topic: listParam(slugLike),
  pattern: listParam(slugLike),
  /** `any` matches problems with at least one selected topic; `all` requires every one. */
  topicMode: z.enum(["any", "all"]).default("any"),
  difficulty: listParam(z.enum(DIFFICULTY_VALUES)),
  company: listParam(slugLike),
  status: listParam(z.enum(STATUS_FILTERS)),
  sheet: slugLike.optional(),
  minAcc: z.coerce.number().min(0).max(100).optional(),
  maxAcc: z.coerce.number().min(0).max(100).optional(),
  maxMinutes: z.coerce.number().int().min(1).max(600).optional(),
  sort: z.enum(SORTS).default("default"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});
export type ProblemListQuery = z.infer<typeof problemListQuerySchema>;

export type ProblemStatus = "unseen" | "attempted" | "solved";

export interface ProblemListItem {
  slug: string;
  title: string;
  difficulty: (typeof DIFFICULTY_VALUES)[number];
  topics: string[];
  patterns: string[];
  acceptanceRate: number;
  estMinutes: number | null;
  /** The signed-in user's progress; null for anonymous visitors. */
  status: ProblemStatus | null;
}

export interface ProblemListResponse {
  items: ProblemListItem[];
  nextCursor: string | null;
  total: number;
}

export interface ProblemExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface ProblemLanguage {
  language: LanguageValue;
  timeLimitMs: number;
  memoryLimitKb: number;
  starterCode: string;
}

export interface ProblemDetail {
  slug: string;
  title: string;
  difficulty: (typeof DIFFICULTY_VALUES)[number];
  statementMd: string;
  constraintsMd: string | null;
  examples: ProblemExample[];
  topics: string[];
  patterns: string[];
  companies: Array<{ slug: string; name: string }>;
  estMinutes: number | null;
  acceptanceRate: number;
  version: number;
  archived: boolean;
  languages: ProblemLanguage[];
  state: { status: ProblemStatus; attempts: number } | null;
  /** Whether the signed-in user bookmarked it; null for anonymous visitors. */
  bookmarked: boolean | null;
}

export interface FacetTag {
  slug: string;
  name: string;
  count: number;
}

export interface TagFacets {
  topics: FacetTag[];
  patterns: FacetTag[];
}

export interface SheetSummary {
  slug: string;
  title: string;
  description: string | null;
  total: number;
  /** Distinct problems the user has solved in this sheet (null when signed out). */
  solved: number | null;
}

export interface SheetDetail extends SheetSummary {
  sections: Array<{ name: string; problems: ProblemListItem[] }>;
}

// ---- drafts and custom tests (D2) ----

export const MAX_CODE_BYTES = 64 * 1024;
export const MAX_CUSTOM_TESTS = 20;

export const languageQuerySchema = z.object({ language: z.enum(LANGUAGE_VALUES) });

export const draftSaveSchema = z.object({
  code: z.string().refine((s) => new TextEncoder().encode(s).length <= MAX_CODE_BYTES, {
    message: "Code is larger than 64 KB",
  }),
  cursor: z.object({ line: z.number().int().min(1), column: z.number().int().min(1) }).optional(),
  /** The draft version this edit was based on (0 when there is no draft yet). */
  baseVersion: z.number().int().min(0),
});
export type DraftSave = z.infer<typeof draftSaveSchema>;

export interface Draft {
  code: string;
  cursor: { line: number; column: number } | null;
  version: number;
  updatedAt: string;
}

export interface DraftHistoryItem {
  code: string;
  savedAt: string;
}

export const customTestSchema = z.object({
  label: z.string().trim().max(60).optional(),
  input: z.string().min(0).max(MAX_CODE_BYTES),
});

export interface CustomTest {
  id: string;
  label: string | null;
  input: string;
}

// ---- function signatures (shared by content tools, admin and the judge drivers) ----

/** Parameter/return types supported by generated drivers (doc 12 lists more for later). */
export const PARAM_TYPES = [
  "int",
  "long",
  "double",
  "bool",
  "string",
  "int[]",
  "long[]",
  "double[]",
  "bool[]",
  "string[]",
  "int[][]",
  "long[][]",
] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

const identifier = z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/, "camelCase identifier");

export const signatureSchema = z
  .object({
    function: identifier,
    params: z
      .array(z.object({ name: identifier, type: z.enum(PARAM_TYPES) }))
      .min(1)
      .max(6),
    returns: z.enum(PARAM_TYPES),
  })
  .refine((s) => new Set(s.params.map((p) => p.name)).size === s.params.length, {
    message: "parameter names must be unique",
  });
export type Signature = z.infer<typeof signatureSchema>;
