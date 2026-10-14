import { z } from "zod";

// System design practice (C3): the canvas, the side panel, the review and the reference layers.

/** Kept equal to `NODE_TYPES` in analytics-core (a test checks it). */
export const DESIGN_NODE_TYPES = [
  "client",
  "load_balancer",
  "service",
  "cache",
  "database",
  "queue",
  "cdn",
  "storage",
  "external",
  "note",
] as const;
export type DesignNodeType = (typeof DESIGN_NODE_TYPES)[number];

export const DESIGN_LIMITS = {
  nodes: 60,
  edges: 120,
  label: 40,
  noteLabel: 200,
  coordinate: 5000,
} as const;

export const designCanvasSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        type: z.enum(DESIGN_NODE_TYPES),
        label: z.string().max(DESIGN_LIMITS.noteLabel),
        x: z.number().finite().min(-DESIGN_LIMITS.coordinate).max(DESIGN_LIMITS.coordinate),
        y: z.number().finite().min(-DESIGN_LIMITS.coordinate).max(DESIGN_LIMITS.coordinate),
      }),
    )
    .max(DESIGN_LIMITS.nodes),
  edges: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        from: z.string().min(1).max(20),
        to: z.string().min(1).max(20),
        label: z.string().max(DESIGN_LIMITS.label),
      }),
    )
    .max(DESIGN_LIMITS.edges),
});
export type DesignCanvasDto = z.infer<typeof designCanvasSchema>;

const lines = (max: number) => z.array(z.string().trim().max(200)).max(max);

export const designPanelSchema = z.object({
  functional: lines(12),
  nonFunctional: lines(12),
  apis: lines(15),
  dataModel: z.string().max(3000),
  notes: z.string().max(3000),
  /** Inputs of the capacity calculator. */
  estimate: z.record(z.string().max(30), z.number().finite()),
});
export type DesignPanelDto = z.infer<typeof designPanelSchema>;

export const EMPTY_PANEL: DesignPanelDto = {
  functional: [],
  nonFunctional: [],
  apis: [],
  dataModel: "",
  notes: "",
  estimate: {},
};

export const createDesignCanvasSchema = z.object({
  promptSlug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60),
});

export const saveDesignCanvasSchema = z.object({
  canvas: designCanvasSchema,
  panel: designPanelSchema,
  /** The version this edit started from; a different stored version means another tab saved first. */
  baseVersion: z.number().int().min(1),
});

export const DESIGN_RUBRIC = [
  "requirements",
  "estimation",
  "architecture",
  "data",
  "scalability",
  "tradeoffs",
  "communication",
] as const;
export type DesignRubricKey = (typeof DESIGN_RUBRIC)[number];

export const DESIGN_RUBRIC_LABEL: Record<DesignRubricKey, string> = {
  requirements: "Requirements",
  estimation: "Estimation",
  architecture: "Architecture",
  data: "Data model",
  scalability: "Scalability",
  tradeoffs: "Trade-offs",
  communication: "Communication",
};

export const DESIGN_FINDING_AREAS = [
  "missing_components",
  "spof",
  "bottleneck",
  "consistency",
  "partitioning",
  "caching",
  "failure_handling",
  "cost",
  "security",
  "observability",
] as const;
export type DesignFindingArea = (typeof DESIGN_FINDING_AREAS)[number];

export interface DesignPromptItem {
  slug: string;
  title: string;
  difficulty: number;
  tags: string[];
  /** The learner has a canvas for it. */
  started: boolean;
}

export interface DesignPromptDetail extends DesignPromptItem {
  statementMd: string;
  requirementHints: { functional: string[]; nonFunctional: string[] };
}

export interface DesignFindingDto {
  code: string;
  severity: "important" | "suggestion";
  message: string;
  nodeIds: string[];
}

export interface DesignReviewDto {
  summary: string;
  /** 1 to 5 per rubric key. */
  scores: Partial<Record<DesignRubricKey, number>>;
  findings: Array<{
    area: DesignFindingArea;
    severity: "important" | "suggestion";
    message: string;
    nodeIds: string[];
  }>;
  /** Questions an interviewer would ask next. */
  questions: string[];
  /** The version of the canvas that was reviewed. */
  version: number;
}

export interface DesignCanvasFull {
  id: string;
  prompt: { slug: string; title: string };
  canvas: DesignCanvasDto;
  panel: DesignPanelDto;
  version: number;
  /** Checks that need no model, for the current drawing. */
  findings: DesignFindingDto[];
  reviewStatus: "none" | "pending" | "ready" | "failed";
  review: DesignReviewDto | null;
  reviewError: string | null;
  updatedAt: string;
}

export interface DesignCanvasListItem {
  id: string;
  prompt: { slug: string; title: string };
  version: number;
  components: number;
  reviewed: boolean;
  updatedAt: string;
}

export interface DesignReferenceLayer {
  title: string;
  description: string;
  canvas: DesignCanvasDto;
}

export interface DesignReferenceDto {
  v1: DesignReferenceLayer;
  v2: DesignReferenceLayer;
  v3: DesignReferenceLayer;
}
