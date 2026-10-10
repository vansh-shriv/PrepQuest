import { z } from "zod";

// ---------------------------------------------------------------- signatures and values

// Defined in @prepquest/shared so the admin API and web forms use the same schema.
import {
  PARAM_TYPES,
  signatureSchema,
  type ParamType,
  type SaveEditorial,
  type Signature,
} from "@prepquest/shared";
export { PARAM_TYPES, signatureSchema, type ParamType, type Signature };

// ---------------------------------------------------------------- problem files

export const LANGUAGES = ["cpp", "java", "python"] as const;
export type Language = (typeof LANGUAGES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

export const metaSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case slug")
    .max(60),
  title: z.string().min(3).max(100),
  difficulty: z.enum(DIFFICULTIES),
  /** Topic tag slugs (must exist in the taxonomy). */
  topics: z.array(z.string()).min(1).max(5),
  /** Pattern tag slugs. */
  patterns: z.array(z.string()).max(4).default([]),
  companies: z
    .array(
      z.object({
        slug: z.string(),
        frequency: z.number().int().min(1).max(5).default(1),
        lastSeenYear: z.number().int().min(2015).max(2100).optional(),
      }),
    )
    .default([]),
  estMinutes: z.number().int().min(5).max(120),
  /** Provenance: where the idea comes from. Statements are always original wording (doc 17 §1). */
  source: z.string().min(3),
  license: z.string().min(2),
  checker: z.enum(["exact", "tokens", "float", "special"]).default("exact"),
  limits: z
    .object({
      /** C++ time limit; other languages get the multipliers below. */
      timeLimitMs: z.number().int().min(500).max(10_000).default(1000),
      memoryLimitKb: z.number().int().min(65_536).max(1_048_576).default(262_144),
    })
    .default({ timeLimitMs: 1000, memoryLimitKb: 262_144 }),
});
export type ProblemMeta = z.infer<typeof metaSchema>;

export const exampleSchema = z.object({
  /** One JSON value per signature parameter, in order. */
  args: z.array(z.unknown()),
  /** The JSON value the function returns. */
  expected: z.unknown(),
  explanation: z.string().optional(),
});
export type Example = z.infer<typeof exampleSchema>;

export const TEST_KINDS = ["sample", "hidden", "edge", "stress"] as const;
export type TestKind = (typeof TEST_KINDS)[number];

export const manifestEntrySchema = z.object({
  ordinal: z.number().int().min(1),
  kind: z.enum(TEST_KINDS),
  /** Shown to the user when this test fails, e.g. "edge: empty input". Never reveals the input. */
  label: z.string().max(80).optional(),
  weight: z.number().int().min(1).default(1),
});
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/** A hand-written or generated test case before it is encoded to .in/.out files. */
export const caseSchema = z.object({
  kind: z.enum(["hidden", "edge", "stress"]),
  label: z.string().max(80).optional(),
  args: z.array(z.unknown()),
});
export type TestCase = z.infer<typeof caseSchema>;

/** `editorial.json`: an approach's code may reference a file (e.g. the reference solution) instead of inlining it. */
export const editorialFileSchema = z.object({
  approaches: z
    .array(
      z.object({
        name: z.string(),
        intuition: z.string(),
        steps: z.array(z.string()),
        code: z.partialRecord(
          z.enum(["cpp", "java", "python"]),
          z.union([z.string(), z.object({ file: z.string() })]),
        ),
        time: z.string(),
        space: z.string(),
        pitfalls: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  talkTrackMd: z.string().nullable().optional(),
  relatedSlugs: z.array(z.string()).optional(),
});
export type EditorialFile = z.infer<typeof editorialFileSchema>;

export const hintsSchema = z.object({
  1: z.string().optional(),
  2: z.string().optional(),
  3: z.string().optional(),
});

export const sheetSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(3).max(80),
  description: z.string().max(400).optional(),
  sections: z
    .array(z.object({ name: z.string().min(1).max(60), problems: z.array(z.string()).min(1) }))
    .min(1),
});
export type SheetFile = z.infer<typeof sheetSchema>;

// ---------------------------------------------------------------- in-memory bundle

export interface TestFile {
  ordinal: number;
  kind: TestKind;
  label?: string | undefined;
  weight: number;
  input: string;
  output: string;
}

/** Everything about one problem, loaded from `content/problems/<slug>/`. */
export interface ProblemBundle {
  dir: string;
  meta: ProblemMeta;
  statementMd: string;
  constraintsMd: string;
  examples: Example[];
  signature: Signature;
  /** Author-supplied starter code; missing languages are generated from the signature. */
  starters: Partial<Record<Language, string>>;
  hints: Partial<Record<1 | 2 | 3, string>>;
  /** Resolved from `editorial.json` (file references replaced by their contents), or null. */
  editorial: SaveEditorial | null;
  tests: TestFile[];
}

export interface Issue {
  level: "error" | "warning";
  problem: string;
  message: string;
}
