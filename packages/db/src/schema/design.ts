import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";

// System design practice (C3). Doc 10 section 2.12.

export interface StoredCanvas {
  nodes: Array<{ id: string; type: string; label: string; x: number; y: number }>;
  edges: Array<{ id: string; from: string; to: string; label: string }>;
}

export interface StoredPanel {
  functional: string[];
  nonFunctional: string[];
  apis: string[];
  dataModel: string;
  notes: string;
  estimate: Record<string, number>;
}

export interface StoredReference {
  title: string;
  description: string;
  canvas: StoredCanvas;
}

/** Practice prompts from `content/design`: upserted by slug. */
export const systemDesignPrompts = pgTable(
  "system_design_prompts",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    /** hld | lld (only hld is built) */
    kind: text("kind").notNull().default("hld"),
    title: text("title").notNull(),
    statementMd: text("statement_md").notNull(),
    /** Prompts for the requirements panel, shown as questions to think about. */
    requirementHints: jsonb("requirement_hints")
      .$type<{ functional: string[]; nonFunctional: string[] }>()
      .notNull(),
    /** Layered reference designs v1, v2, v3; shown only after the learner has had a review. */
    reference: jsonb("reference").$type<Record<"v1" | "v2" | "v3", StoredReference>>().notNull(),
    difficulty: smallint("difficulty").notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status").notNull().default("published"),
    ...timestamps,
  },
  (t) => [
    check("system_design_prompts_kind_check", sql`${t.kind} IN ('hld','lld')`),
    check(
      "system_design_prompts_status_check",
      sql`${t.status} IN ('draft','published','archived')`,
    ),
  ],
);

export interface StoredDesignReview {
  summary: string;
  scores: Record<string, number>;
  findings: Array<{
    area: string;
    severity: "important" | "suggestion";
    message: string;
    nodeIds: string[];
  }>;
  questions: string[];
  /** Version of the canvas this review looked at. */
  version: number;
  model: string | null;
}

export const designCanvases = pgTable(
  "design_canvases",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => systemDesignPrompts.id, { onDelete: "cascade" }),
    /** The interview this canvas belongs to, when it was made inside one. */
    sessionId: uuid("session_id"),
    canvas: jsonb("canvas").$type<StoredCanvas>().notNull(),
    panel: jsonb("panel").$type<StoredPanel>().notNull(),
    /** Bumped on every save; a save carries the version it started from. */
    version: integer("version").notNull().default(1),
    /** none | pending | ready | failed */
    reviewStatus: text("review_status").notNull().default("none"),
    aiReview: jsonb("ai_review").$type<StoredDesignReview>(),
    reviewError: text("review_error"),
    ...timestamps,
  },
  (t) => [
    index("design_canvases_user_idx").on(t.userId, t.updatedAt),
    unique("design_canvases_id_user_key").on(t.id, t.userId),
    check(
      "design_canvases_review_status_check",
      sql`${t.reviewStatus} IN ('none','pending','ready','failed')`,
    ),
  ],
);
