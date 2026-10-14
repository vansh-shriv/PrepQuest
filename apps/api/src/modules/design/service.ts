import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  designCanvases,
  newId,
  systemDesignPrompts,
  type Database,
  type StoredDesignReview,
} from "@prepquest/db";
import {
  DEFAULT_LOAD_ESTIMATE,
  analyzeDesign,
  describeGraph,
  estimateLoad,
  validateCanvas,
  type DesignCanvas,
} from "@prepquest/analytics-core";
import {
  DESIGN_REVIEW_PROMPT_VERSION,
  DESIGN_REVIEW_SYSTEM,
  buildDesignReviewPrompt,
} from "@prepquest/prompts";
import {
  AppError,
  DESIGN_FINDING_AREAS,
  DESIGN_RUBRIC,
  EMPTY_PANEL,
  type DesignCanvasDto,
  type DesignCanvasFull,
  type DesignCanvasListItem,
  type DesignPanelDto,
  type DesignPromptDetail,
  type DesignPromptItem,
  type DesignReferenceDto,
  type DesignReviewDto,
} from "@prepquest/shared";
import type { AiContext } from "../ai-context.js";

// System design practice (C3): prompts, canvases that autosave with a version, a review by the model whose
// answer is checked against the drawing, and the reference designs, which open once the learner has been reviewed.

const MAX_CANVASES = 20;
const PER_MINUTE = 3;
const PER_DAY = 10;
const STALE_MS = 5 * 60_000;

type Row = typeof designCanvases.$inferSelect;
type PromptRow = typeof systemDesignPrompts.$inferSelect;

const promptItem = (p: PromptRow, started: boolean): DesignPromptItem => ({
  slug: p.slug,
  title: p.title,
  difficulty: p.difficulty,
  tags: p.tags,
  started,
});

export async function listPrompts(db: Database, userId: string): Promise<DesignPromptItem[]> {
  const prompts = await db
    .select()
    .from(systemDesignPrompts)
    .where(eq(systemDesignPrompts.status, "published"))
    .orderBy(asc(systemDesignPrompts.difficulty), asc(systemDesignPrompts.title));
  const mine = await db
    .select({ promptId: designCanvases.promptId })
    .from(designCanvases)
    .where(eq(designCanvases.userId, userId));
  const started = new Set(mine.map((m) => m.promptId));
  return prompts.map((p) => promptItem(p, started.has(p.id)));
}

async function promptBySlug(db: Database, slug: string): Promise<PromptRow> {
  const [p] = await db
    .select()
    .from(systemDesignPrompts)
    .where(and(eq(systemDesignPrompts.slug, slug), eq(systemDesignPrompts.status, "published")));
  if (!p) throw new AppError("NOT_FOUND", 404, "Design prompt not found");
  return p;
}

export async function getPrompt(
  db: Database,
  userId: string,
  slug: string,
): Promise<DesignPromptDetail> {
  const p = await promptBySlug(db, slug);
  const [has] = await db
    .select({ id: designCanvases.id })
    .from(designCanvases)
    .where(and(eq(designCanvases.userId, userId), eq(designCanvases.promptId, p.id)))
    .limit(1);
  return {
    ...promptItem(p, Boolean(has)),
    statementMd: p.statementMd,
    requirementHints: p.requirementHints,
  };
}

// ---------------------------------------------------------------- canvases

function toFull(row: Row, prompt: { slug: string; title: string }): DesignCanvasFull {
  return {
    id: row.id,
    prompt,
    canvas: row.canvas as DesignCanvasDto,
    panel: row.panel as DesignPanelDto,
    version: row.version,
    findings: analyzeDesign(row.canvas as DesignCanvas),
    reviewStatus: row.reviewStatus as DesignCanvasFull["reviewStatus"],
    review: (row.aiReview as DesignReviewDto | null) ?? null,
    reviewError: row.reviewError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function owned(db: Database, userId: string, id: string) {
  const [r] = await db
    .select({ c: designCanvases, slug: systemDesignPrompts.slug, title: systemDesignPrompts.title })
    .from(designCanvases)
    .innerJoin(systemDesignPrompts, eq(systemDesignPrompts.id, designCanvases.promptId))
    .where(and(eq(designCanvases.id, id), eq(designCanvases.userId, userId)));
  // not yours looks the same as not found
  if (!r) throw new AppError("NOT_FOUND", 404, "Canvas not found");
  return r;
}

/** A review still pending long after it began lost its job (a restart): say so, so the learner can ask again. */
async function expireStale(db: Database, row: Row): Promise<Row> {
  if (row.reviewStatus !== "pending" || Date.now() - row.updatedAt.getTime() < STALE_MS) return row;
  const [u] = await db
    .update(designCanvases)
    .set({ reviewStatus: "failed", reviewError: "The review took too long. Try again." })
    .where(and(eq(designCanvases.id, row.id), eq(designCanvases.reviewStatus, "pending")))
    .returning();
  return u ?? row;
}

export async function createCanvas(
  db: Database,
  userId: string,
  slug: string,
): Promise<DesignCanvasFull> {
  const p = await promptBySlug(db, slug);
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(designCanvases)
    .where(eq(designCanvases.userId, userId));
  if (n >= MAX_CANVASES) {
    throw new AppError(
      "LIMIT_REACHED",
      409,
      `You can keep ${MAX_CANVASES} designs. Delete one first.`,
    );
  }
  const [row] = await db
    .insert(designCanvases)
    .values({
      id: newId(),
      userId,
      promptId: p.id,
      canvas: { nodes: [], edges: [] },
      panel: { ...EMPTY_PANEL, estimate: { ...DEFAULT_LOAD_ESTIMATE } },
    })
    .returning();
  return toFull(row!, { slug: p.slug, title: p.title });
}

export async function listCanvases(db: Database, userId: string): Promise<DesignCanvasListItem[]> {
  const rows = await db
    .select({ c: designCanvases, slug: systemDesignPrompts.slug, title: systemDesignPrompts.title })
    .from(designCanvases)
    .innerJoin(systemDesignPrompts, eq(systemDesignPrompts.id, designCanvases.promptId))
    .where(eq(designCanvases.userId, userId))
    .orderBy(desc(designCanvases.updatedAt));
  return rows.map((r) => ({
    id: r.c.id,
    prompt: { slug: r.slug, title: r.title },
    version: r.c.version,
    components: r.c.canvas.nodes.length,
    reviewed: r.c.reviewStatus === "ready",
    updatedAt: r.c.updatedAt.toISOString(),
  }));
}

export async function getCanvas(
  db: Database,
  userId: string,
  id: string,
): Promise<DesignCanvasFull> {
  const r = await owned(db, userId, id);
  return toFull(await expireStale(db, r.c), { slug: r.slug, title: r.title });
}

export async function saveCanvas(
  db: Database,
  userId: string,
  id: string,
  input: { canvas: DesignCanvasDto; panel: DesignPanelDto; baseVersion: number },
): Promise<DesignCanvasFull> {
  const r = await owned(db, userId, id);
  const issues = validateCanvas(input.canvas as DesignCanvas);
  if (issues.length > 0) {
    throw new AppError("VALIDATION_ERROR", 422, "That drawing has problems", { issues });
  }
  const [updated] = await db
    .update(designCanvases)
    .set({ canvas: input.canvas, panel: input.panel, version: input.baseVersion + 1 })
    .where(and(eq(designCanvases.id, id), eq(designCanvases.version, input.baseVersion)))
    .returning();
  if (!updated) {
    // another tab saved first: tell the client which version is stored so it can reload
    throw new AppError("VERSION_CONFLICT", 409, "This design was changed somewhere else.", {
      version: r.c.version,
    });
  }
  return toFull(updated, { slug: r.slug, title: r.title });
}

export async function deleteCanvas(db: Database, userId: string, id: string): Promise<void> {
  await owned(db, userId, id);
  await db.delete(designCanvases).where(eq(designCanvases.id, id));
}

// ---------------------------------------------------------------- review

const reviewSchema = z.object({
  summary: z.string().trim().min(1).max(900),
  scores: z.object(
    Object.fromEntries(DESIGN_RUBRIC.map((k) => [k, z.number().int().min(1).max(5)])) as Record<
      (typeof DESIGN_RUBRIC)[number],
      z.ZodNumber
    >,
  ),
  findings: z
    .array(
      z.object({
        area: z.enum(DESIGN_FINDING_AREAS),
        severity: z.enum(["important", "suggestion"]),
        message: z.string().trim().min(3).max(600),
        nodeIds: z.array(z.string().max(20)).max(10),
      }),
    )
    .max(14),
  questions: z.array(z.string().trim().min(5).max(300)).length(5),
});

/** What the reply must satisfy beyond its shape; each message goes back to the model to fix. */
export function designReviewIssues(
  v: z.infer<typeof reviewSchema>,
  canvas: DesignCanvas,
): string[] {
  const ids = new Set(canvas.nodes.map((n) => n.id));
  const issues: string[] = [];
  for (const [i, f] of v.findings.entries()) {
    for (const id of f.nodeIds) {
      if (!ids.has(id))
        issues.push(`finding ${i + 1} cites the component id "${id}", which is not on the canvas`);
    }
  }
  return issues;
}

/** The capacity numbers as lines for the prompt (nothing when the learner never touched the calculator). */
export function estimateLines(panel: DesignPanelDto): string[] {
  if (Object.keys(panel.estimate).length === 0) return [];
  const input = { ...DEFAULT_LOAD_ESTIMATE, ...panel.estimate };
  const e = estimateLoad(input);
  return [
    `${input.dau} daily users, ${input.actionsPerUser} actions each, ${input.readWriteRatio} reads per write`,
    `average ${e.avgQps} requests/s, peak ${e.peakQps}/s (${e.readQps} reads/s, ${e.writeQps} writes/s)`,
    `storage ${e.storagePerDayGB} GB/day, ${e.storageTotalTB} TB over ${input.retentionYears} years`,
    `peak outgoing bandwidth ${e.bandwidthMbps} Mbit/s`,
  ];
}

export async function requestReview(
  ctx: AiContext,
  userId: string,
  id: string,
): Promise<DesignCanvasFull> {
  const { db } = ctx;
  const r = await owned(db, userId, id);
  const row = await expireStale(db, r.c);
  if (row.reviewStatus === "pending") return toFull(row, { slug: r.slug, title: r.title });
  const canvas = row.canvas as DesignCanvas;
  if (canvas.nodes.filter((n) => n.type !== "note").length < 2) {
    throw new AppError(
      "UNSUPPORTED",
      422,
      "Draw at least two components before asking for a review.",
    );
  }
  await ctx.limiter.enforce(`dr:min:${userId}`, PER_MINUTE, 60, "design reviews");
  await ctx.limiter.enforce(`dr:day:${userId}`, PER_DAY, 86_400, "design reviews today");

  const [claimed] = await db
    .update(designCanvases)
    .set({ reviewStatus: "pending", reviewError: null })
    .where(and(eq(designCanvases.id, id), sql`${designCanvases.reviewStatus} <> 'pending'`))
    .returning();
  if (!claimed) return getCanvas(db, userId, id);
  ctx.jobs.run(`design-review:${id}`, () => generate(ctx, claimed, r.title));
  return toFull(claimed, { slug: r.slug, title: r.title });
}

async function generate(ctx: AiContext, row: Row, title: string) {
  const { db, llm } = ctx;
  const canvas = row.canvas as DesignCanvas;
  const panel = row.panel as DesignPanelDto;
  const [prompt] = await db
    .select({ statement: systemDesignPrompts.statementMd })
    .from(systemDesignPrompts)
    .where(eq(systemDesignPrompts.id, row.promptId));
  try {
    const { value, result } = await llm.json(
      {
        task: "design_review",
        modelClass: "evaluator",
        system: DESIGN_REVIEW_SYSTEM,
        messages: [
          {
            role: "user",
            content: buildDesignReviewPrompt({
              title,
              statement: prompt?.statement ?? "",
              functional: panel.functional,
              nonFunctional: panel.nonFunctional,
              apis: panel.apis,
              dataModel: panel.dataModel,
              notes: panel.notes,
              estimateLines: estimateLines(panel),
              graph: describeGraph(canvas),
              checks: analyzeDesign(canvas),
            }),
          },
        ],
        maxTokens: 6000,
        effort: "medium",
        userId: row.userId,
        promptVersion: DESIGN_REVIEW_PROMPT_VERSION,
      },
      reviewSchema,
      { check: (v) => designReviewIssues(v, canvas) },
    );
    const review: StoredDesignReview = {
      summary: value.summary,
      scores: value.scores,
      findings: value.findings,
      questions: value.questions,
      version: row.version,
      model: result.model,
    };
    await db
      .update(designCanvases)
      .set({ reviewStatus: "ready", aiReview: review })
      .where(eq(designCanvases.id, row.id));
  } catch (err) {
    ctx.log.warn({ err: String(err), canvasId: row.id }, "design review failed");
    await db
      .update(designCanvases)
      .set({
        reviewStatus: "failed",
        reviewError: "The review could not be written. Try again in a moment.",
      })
      .where(eq(designCanvases.id, row.id));
  }
}

// ---------------------------------------------------------------- reference

/** The layered reference designs open once the learner has had a review of their own attempt. */
export async function reference(
  db: Database,
  userId: string,
  slug: string,
): Promise<DesignReferenceDto> {
  const p = await promptBySlug(db, slug);
  const [tried] = await db
    .select({ id: designCanvases.id })
    .from(designCanvases)
    .where(
      and(
        eq(designCanvases.userId, userId),
        eq(designCanvases.promptId, p.id),
        eq(designCanvases.reviewStatus, "ready"),
      ),
    )
    .limit(1);
  if (!tried) {
    throw new AppError(
      "REFERENCE_LOCKED",
      403,
      "Draw your own design and get a review first. The reference opens after that.",
    );
  }
  return p.reference as unknown as DesignReferenceDto;
}
