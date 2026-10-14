import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  NODE_TYPES,
  analyzeDesign,
  validateCanvas,
  type DesignCanvas,
} from "@prepquest/analytics-core";
import { newId, systemDesignPrompts, type Db } from "@prepquest/db";
import type { Issue } from "./types.js";

// System design prompts (content/design/<slug>.json): a statement, questions for the requirements panel and
// three layered reference designs. Validated here (the canvases must be valid, and the finished version must
// pass the same checks the learner's design does) and upserted by slug.

const canvasSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string().min(1).max(20),
      type: z.enum(NODE_TYPES),
      label: z.string().min(1).max(200),
      x: z.number().int(),
      y: z.number().int(),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string().min(1).max(20),
      from: z.string(),
      to: z.string(),
      label: z.string().max(40),
    }),
  ),
});

const layer = z.object({
  title: z.string().min(3).max(80),
  description: z.string().min(20).max(600),
  canvas: canvasSchema,
});

export const designPromptSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60),
  title: z.string().min(5).max(80),
  kind: z.literal("hld"),
  difficulty: z.number().int().min(1).max(3),
  tags: z.array(z.string().min(2).max(30)).max(8),
  statementMd: z.string().min(50).max(3000),
  requirementHints: z.object({
    functional: z.array(z.string().min(3).max(120)).min(2).max(8),
    nonFunctional: z.array(z.string().min(3).max(120)).min(2).max(8),
  }),
  reference: z.object({ v1: layer, v2: layer, v3: layer }),
});
export type DesignPromptSource = z.infer<typeof designPromptSchema>;

export interface LoadedDesign {
  prompts: DesignPromptSource[];
  issues: Issue[];
}

export async function loadDesign(root: string): Promise<LoadedDesign> {
  const issues: Issue[] = [];
  const prompts: DesignPromptSource[] = [];
  let files: string[] = [];
  try {
    files = (await readdir(join(root, "design"))).filter((f) => f.endsWith(".json")).sort();
  } catch {
    /* no design folder */
  }
  for (const file of files) {
    try {
      prompts.push(
        designPromptSchema.parse(JSON.parse(await readFile(join(root, "design", file), "utf8"))),
      );
    } catch (e) {
      issues.push({
        level: "error",
        problem: `design/${file}`,
        message: (e as Error).message.split("\n")[0] ?? "invalid",
      });
    }
  }
  return { prompts, issues };
}

export function validateDesign(d: LoadedDesign): Issue[] {
  const issues: Issue[] = [];
  const slugs = new Set<string>();
  for (const p of d.prompts) {
    const name = `design ${p.slug}`;
    if (slugs.has(p.slug))
      issues.push({ level: "error", problem: name, message: "duplicate slug" });
    slugs.add(p.slug);
    for (const v of ["v1", "v2", "v3"] as const) {
      for (const m of validateCanvas(p.reference[v].canvas as DesignCanvas)) {
        issues.push({ level: "error", problem: name, message: `${v}: ${m}` });
      }
    }
    // the finished design must not break the rules the learner's design is checked against
    for (const f of analyzeDesign(p.reference.v3.canvas as DesignCanvas)) {
      if (f.severity === "important") {
        issues.push({ level: "error", problem: name, message: `v3: ${f.code}: ${f.message}` });
      }
    }
  }
  return issues;
}

export async function importDesign(db: Db, d: LoadedDesign): Promise<{ prompts: number }> {
  for (const p of d.prompts) {
    const values = {
      kind: p.kind,
      title: p.title,
      statementMd: p.statementMd,
      requirementHints: p.requirementHints,
      reference: p.reference,
      difficulty: p.difficulty,
      tags: p.tags,
      status: "published",
    };
    const [existing] = await db
      .select({ id: systemDesignPrompts.id })
      .from(systemDesignPrompts)
      .where(eq(systemDesignPrompts.slug, p.slug));
    if (existing) {
      await db
        .update(systemDesignPrompts)
        .set(values)
        .where(eq(systemDesignPrompts.id, existing.id));
    } else {
      await db.insert(systemDesignPrompts).values({ id: newId(), slug: p.slug, ...values });
    }
  }
  return { prompts: d.prompts.length };
}
