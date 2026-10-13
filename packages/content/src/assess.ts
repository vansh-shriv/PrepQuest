import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { guardQuery } from "@prepquest/analytics-core";
import {
  aptitudeItems,
  newId,
  oaTemplates,
  sqlDatasets,
  sqlProblems,
  type Db,
} from "@prepquest/db";
import { runQuery } from "@prepquest/sql-runner";
import { z } from "zod";
import type { Issue } from "./types.js";
import { QUIZ_SUBJECTS } from "./learning.js";

// SQL datasets and problems (content/sql), aptitude items (content/aptitude) and online-assessment templates
// (content/oa): authored as JSON, validated here and upserted by slug (doc 17).

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(80);

export const APTITUDE_SECTIONS = ["quant", "logical", "verbal", "di", "pseudocode"] as const;

export const sqlProblemSchema = z.object({
  slug,
  title: z.string().min(3).max(80),
  topic: z.string().min(2).max(30),
  difficulty: z.enum(["easy", "medium", "hard"]),
  statement: z.string().min(20).max(900),
  expected: z.string().min(6).max(1500),
  orderSensitive: z.boolean().default(false),
  hint: z.string().max(300).optional(),
  note: z.string().max(500).optional(),
});

export const sqlDatasetSchema = z.object({
  slug,
  title: z.string().min(2).max(60),
  description: z.string().max(300).optional(),
  schema: z.array(z.string()).min(1),
  seed: z.array(z.string()).min(1),
  problems: z.array(sqlProblemSchema).min(1),
});
export type SqlDatasetSource = z.infer<typeof sqlDatasetSchema>;

const option = z.object({ id: z.string().regex(/^[a-f]$/), text: z.string().min(1).max(300) });

export const aptitudeItemSchema = z.object({
  slug,
  topic: z.string().min(2).max(40),
  difficulty: z.number().int().min(1).max(5),
  type: z.enum(["single", "blank"]).default("single"),
  body: z.string().min(8).max(1600),
  options: z.array(option).min(2).max(6).optional(),
  answer: z.union([z.string(), z.array(z.string()).min(1)]),
  explanation: z.string().min(10).max(900),
  shortcut: z.string().max(400).optional(),
  estSeconds: z.number().int().min(10).max(300).default(60),
});
export type AptitudeItemSource = z.infer<typeof aptitudeItemSchema> & { section: string };

const aptitudeFileSchema = z.object({
  section: z.enum(APTITUDE_SECTIONS),
  items: z.array(aptitudeItemSchema).min(1),
});

export const oaSectionSchema = z.object({
  key: slug,
  title: z.string().min(2).max(60),
  source: z.enum(["aptitude", "quiz"]),
  from: z.string().min(2).max(20),
  count: z.number().int().min(1).max(60),
  minutes: z.number().int().min(1).max(120),
});

export const oaTemplateSchema = z.object({
  slug,
  title: z.string().min(3).max(80),
  kind: z.enum(["oa", "drill"]),
  description: z.string().min(10).max(500),
  negativeMarking: z.number().min(0).max(1),
  calculator: z.boolean(),
  sections: z.array(oaSectionSchema).min(1).max(8),
});
export type OaTemplateSource = z.infer<typeof oaTemplateSchema>;

export interface LoadedAssess {
  datasets: SqlDatasetSource[];
  aptitude: AptitudeItemSource[];
  templates: OaTemplateSource[];
  issues: Issue[];
}

async function jsonFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

export async function loadAssess(root: string): Promise<LoadedAssess> {
  const issues: Issue[] = [];
  const datasets: SqlDatasetSource[] = [];
  const aptitude: AptitudeItemSource[] = [];
  const templates: OaTemplateSource[] = [];
  const read = async (dir: string, file: string) =>
    JSON.parse(await readFile(join(root, dir, file), "utf8")) as unknown;
  const fail = (where: string, e: unknown) =>
    issues.push({
      level: "error",
      problem: where,
      message: (e as Error).message.split("\n")[0] ?? "invalid",
    });
  for (const file of await jsonFiles(join(root, "sql"))) {
    try {
      datasets.push(sqlDatasetSchema.parse(await read("sql", file)));
    } catch (e) {
      fail(`sql/${file}`, e);
    }
  }
  for (const file of await jsonFiles(join(root, "aptitude"))) {
    try {
      const parsed = aptitudeFileSchema.parse(await read("aptitude", file));
      for (const it of parsed.items) aptitude.push({ ...it, section: parsed.section });
    } catch (e) {
      fail(`aptitude/${file}`, e);
    }
  }
  for (const file of await jsonFiles(join(root, "oa"))) {
    try {
      const parsed = z
        .object({ templates: z.array(oaTemplateSchema) })
        .parse(await read("oa", file));
      templates.push(...parsed.templates);
    } catch (e) {
      fail(`oa/${file}`, e);
    }
  }
  return { datasets, aptitude, templates, issues };
}

/**
 * Rules beyond the schema. SQL problems are run for real: the dataset must build, the expected query must
 * pass the same guard learners face and must return rows.
 */
export async function validateAssess(
  assess: LoadedAssess,
  quizCounts: ReadonlyMap<string, number>,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const err = (problem: string, message: string) =>
    issues.push({ level: "error", problem, message });

  const datasetSlugs = new Set<string>();
  const problemSlugs = new Set<string>();
  for (const d of assess.datasets) {
    const name = `sql ${d.slug}`;
    if (datasetSlugs.has(d.slug)) err(name, "duplicate dataset slug");
    datasetSlugs.add(d.slug);
    const dataset = { schema: d.schema.join("\n"), seed: d.seed.join("\n") };
    for (const p of d.problems) {
      const pn = `sql problem ${p.slug}`;
      if (problemSlugs.has(p.slug)) err(pn, "duplicate problem slug");
      problemSlugs.add(p.slug);
      const guard = guardQuery(p.expected);
      if (!guard.ok) {
        err(pn, `expected query is refused by the guard: ${guard.reason}`);
        continue;
      }
      const r = await runQuery(dataset, guard.query);
      if (!r.ok) err(pn, `expected query fails: ${r.error}`);
      else if (r.rows.length === 0) err(pn, "expected query returns no rows");
      else if (r.truncated) err(pn, "expected result is longer than the row limit");
    }
  }

  const aptSlugs = new Set<string>();
  const bySection = new Map<string, number>();
  for (const it of assess.aptitude) {
    const name = `aptitude ${it.slug}`;
    if (aptSlugs.has(it.slug)) err(name, "duplicate item slug");
    aptSlugs.add(it.slug);
    bySection.set(it.section, (bySection.get(it.section) ?? 0) + 1);
    const ids = new Set((it.options ?? []).map((o) => o.id));
    if (ids.size !== (it.options ?? []).length) err(name, "duplicate option ids");
    if (it.type === "single") {
      if (ids.size < 2) err(name, "single items need at least two options");
      if (typeof it.answer !== "string" || !ids.has(it.answer))
        err(name, "answer must be one of the option ids");
    } else {
      if (it.options) err(name, "blank items take no options");
      if (!Array.isArray(it.answer)) err(name, "blank answer must be a list of accepted answers");
    }
  }

  const templateSlugs = new Set<string>();
  for (const t of assess.templates) {
    const name = `oa template ${t.slug}`;
    if (templateSlugs.has(t.slug)) err(name, "duplicate template slug");
    templateSlugs.add(t.slug);
    const keys = new Set<string>();
    for (const s of t.sections) {
      if (keys.has(s.key)) err(name, `duplicate section key "${s.key}"`);
      keys.add(s.key);
      const have =
        s.source === "aptitude" ? (bySection.get(s.from) ?? 0) : (quizCounts.get(s.from) ?? 0);
      if (s.source === "aptitude" && !(APTITUDE_SECTIONS as readonly string[]).includes(s.from))
        err(name, `section "${s.key}": unknown aptitude section "${s.from}"`);
      if (s.source === "quiz" && !(QUIZ_SUBJECTS as readonly string[]).includes(s.from))
        err(name, `section "${s.key}": unknown quiz subject "${s.from}"`);
      if (have < s.count)
        err(name, `section "${s.key}" asks for ${s.count} but only ${have} ${s.from} items exist`);
    }
  }
  return issues;
}

export async function importAssess(
  db: Db,
  assess: LoadedAssess,
): Promise<{ datasets: number; problems: number; aptitude: number; templates: number }> {
  let problems = 0;
  for (const d of assess.datasets) {
    const values = {
      slug: d.slug,
      title: d.title,
      description: d.description ?? null,
      schemaSql: d.schema.join("\n"),
      seedSql: d.seed.join("\n"),
      dialect: "sqlite",
    };
    const [row] = await db
      .insert(sqlDatasets)
      .values({ id: newId(), ...values })
      .onConflictDoUpdate({ target: sqlDatasets.slug, set: { ...values, updatedAt: sql`now()` } })
      .returning({ id: sqlDatasets.id });
    let position = 0;
    for (const p of d.problems) {
      const pv = {
        datasetId: row!.id,
        slug: p.slug,
        title: p.title,
        topic: p.topic,
        difficulty: p.difficulty,
        statementMd: p.statement,
        expectedQuery: p.expected,
        orderSensitive: p.orderSensitive,
        hint: p.hint ?? null,
        solutionNote: p.note ?? null,
        position: position++,
        status: "published" as const,
      };
      await db
        .insert(sqlProblems)
        .values({ id: newId(), ...pv })
        .onConflictDoUpdate({ target: sqlProblems.slug, set: { ...pv, updatedAt: sql`now()` } });
      problems++;
    }
  }
  for (const it of assess.aptitude) {
    const v = {
      slug: it.slug,
      section: it.section,
      topic: it.topic,
      difficulty: it.difficulty,
      type: it.type,
      bodyMd: it.body,
      options: it.options ?? null,
      answer: it.answer,
      explanationMd: it.explanation,
      shortcutMd: it.shortcut ?? null,
      estSeconds: it.estSeconds,
      status: "published" as const,
    };
    await db
      .insert(aptitudeItems)
      .values({ id: newId(), ...v })
      .onConflictDoUpdate({ target: aptitudeItems.slug, set: { ...v, updatedAt: sql`now()` } });
  }
  for (const t of assess.templates) {
    const v = {
      slug: t.slug,
      title: t.title,
      description: t.description,
      kind: t.kind,
      sections: t.sections,
      negativeMarking: String(t.negativeMarking),
      calculator: t.calculator,
      status: "published" as const,
    };
    await db
      .insert(oaTemplates)
      .values({ id: newId(), ...v })
      .onConflictDoUpdate({ target: oaTemplates.slug, set: { ...v, updatedAt: sql`now()` } });
  }
  return {
    datasets: assess.datasets.length,
    problems,
    aptitude: assess.aptitude.length,
    templates: assess.templates.length,
  };
}
