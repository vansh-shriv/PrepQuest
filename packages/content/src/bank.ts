import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { companyPacks, newId, questionBank, type Db } from "@prepquest/db";
import { z } from "zod";
import type { Issue } from "./types.js";
import type { Taxonomy } from "./validate.js";

// Question bank (CS, behavioural, design) and company packs: authored as JSON under content/questions
// and content/company-packs, validated here, and upserted by slug (doc 17 sections 5 and 6).

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(80);

export const bankQuestionSchema = z.object({
  slug,
  category: z.enum(["cs", "behavioral", "hld", "lld"]).optional(),
  topic: z.string().min(1).max(40),
  competency: z.string().max(40).optional(),
  difficulty: z.number().int().min(1).max(5),
  text: z.string().min(20).max(600),
  reference_answer: z.string().min(40).max(2500),
  followups: z.array(z.string().min(5).max(300)).min(1).max(4),
  rubric_points: z.array(z.string().min(3).max(200)).min(2).max(6),
  tags: z.array(z.string().max(40)).max(8).default([]),
});
export type BankQuestion = z.infer<typeof bankQuestionSchema> & {
  category: "cs" | "behavioral" | "hld" | "lld";
};

const questionFileSchema = z.object({
  category: z.enum(["cs", "behavioral", "design"]),
  questions: z.array(bankQuestionSchema).min(1),
});

const weight = z.number().min(0).max(1);
export const packSchema = z.object({
  slug,
  title: z.string().min(3).max(120),
  role: z.string().max(80),
  level: z.enum(["intern", "sde1", "sde2"]),
  version: z.number().int().min(1),
  reviewed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  disclaimer: z.string().min(10).max(300),
  process: z
    .array(
      z.object({
        round: z.string(),
        type: z.string().optional(),
        format: z.string().optional(),
        minutes: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(8),
  topic_weights: z.record(z.string(), weight),
  difficulty_band: z.object({ easy: weight, medium: weight, hard: weight }),
  interview_style: z.object({
    bar: z.string(),
    follow_up_depth: z.number().int().min(0).max(5),
    hint_policy: z.enum(["sparse", "balanced", "generous"]),
    behavioral_weight: weight,
    notes: z.string().max(400),
  }),
  rubric_weights: z.record(z.string(), weight),
  behavioral_competencies: z.array(z.string()).min(2).max(8),
  cs_topics: z
    .array(z.enum(["os", "dbms", "cn", "oop"]))
    .max(4)
    .default([]),
  checklist: z.array(z.string()).max(10),
  pitfalls: z.array(z.string()).max(10),
});
export type CompanyPackData = z.infer<typeof packSchema>;

export interface LoadedBank {
  questions: BankQuestion[];
  packs: CompanyPackData[];
  issues: Issue[];
}

async function jsonFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

export async function loadBank(root: string): Promise<LoadedBank> {
  const issues: Issue[] = [];
  const questions: BankQuestion[] = [];
  const packs: CompanyPackData[] = [];
  for (const file of await jsonFiles(join(root, "questions"))) {
    try {
      const parsed = questionFileSchema.parse(
        JSON.parse(await readFile(join(root, "questions", file), "utf8")),
      );
      for (const q of parsed.questions) {
        const category = parsed.category === "design" ? q.category : parsed.category;
        if (!category) {
          issues.push({
            level: "error",
            problem: `questions/${file} ${q.slug}`,
            message: "design questions need a category (hld or lld)",
          });
          continue;
        }
        questions.push({ ...q, category });
      }
    } catch (e) {
      issues.push({
        level: "error",
        problem: `questions/${file}`,
        message: (e as Error).message.split("\n")[0] ?? "invalid",
      });
    }
  }
  for (const file of await jsonFiles(join(root, "company-packs"))) {
    try {
      packs.push(
        packSchema.parse(JSON.parse(await readFile(join(root, "company-packs", file), "utf8"))),
      );
    } catch (e) {
      issues.push({
        level: "error",
        problem: `company-packs/${file}`,
        message: (e as Error).message.split("\n")[0] ?? "invalid",
      });
    }
  }
  return { questions, packs, issues };
}

const RUBRIC_KEYS = new Set([
  "problem_solving",
  "code_quality",
  "communication",
  "optimization",
  "edge_cases",
  "testing",
  "correctness",
]);

/** Rules beyond the schema: unique slugs, behavioural questions have a competency, weights add up, topics exist. */
export function validateBank(bank: LoadedBank, taxonomy: Taxonomy): Issue[] {
  const issues: Issue[] = [];
  const err = (problem: string, message: string) =>
    issues.push({ level: "error", problem, message });
  const seen = new Set<string>();
  for (const q of bank.questions) {
    if (seen.has(q.slug)) err(q.slug, "duplicate question slug");
    seen.add(q.slug);
    if (q.category === "behavioral" && !q.competency)
      err(q.slug, "behavioural questions need a competency");
  }
  const competencies = new Set(
    bank.questions.filter((q) => q.competency).map((q) => q.competency as string),
  );
  const packSlugs = new Set<string>();
  for (const p of bank.packs) {
    const name = `pack ${p.slug}`;
    if (packSlugs.has(p.slug)) err(name, "duplicate pack slug");
    packSlugs.add(p.slug);
    const wsum = Object.values(p.rubric_weights).reduce((a, b) => a + b, 0);
    if (Math.abs(wsum - 1) > 0.01)
      err(name, `rubric weights sum to ${wsum.toFixed(2)}, expected 1 (+-0.01)`);
    for (const k of Object.keys(p.rubric_weights))
      if (!RUBRIC_KEYS.has(k)) err(name, `unknown rubric dimension "${k}"`);
    const band = p.difficulty_band;
    if (Math.abs(band.easy + band.medium + band.hard - 1) > 0.01)
      err(name, "difficulty band must sum to 1");
    for (const t of Object.keys(p.topic_weights)) {
      if (!taxonomy.topics.has(t) && !taxonomy.patterns.has(t)) err(name, `unknown topic "${t}"`);
    }
    for (const c of p.behavioral_competencies) {
      if (!competencies.has(c)) err(name, `no behavioural question for competency "${c}"`);
    }
    const age = (Date.now() - new Date(p.reviewed_at).getTime()) / 86_400_000;
    if (age > 183)
      issues.push({
        level: "warning",
        problem: name,
        message: "last reviewed more than 6 months ago",
      });
  }
  return issues;
}

export async function importBank(
  db: Db,
  bank: LoadedBank,
): Promise<{ questions: number; packs: number }> {
  for (const q of bank.questions) {
    const values = {
      slug: q.slug,
      category: q.category,
      topic: q.topic,
      competency: q.competency ?? null,
      difficulty: q.difficulty,
      text: q.text,
      referenceAnswer: q.reference_answer,
      followups: q.followups,
      rubricPoints: q.rubric_points,
      tags: q.tags,
      status: "published" as const,
    };
    await db
      .insert(questionBank)
      .values({ id: newId(), ...values })
      .onConflictDoUpdate({ target: questionBank.slug, set: { ...values, updatedAt: sql`now()` } });
  }
  for (const p of bank.packs) {
    const values = {
      slug: p.slug,
      title: p.title,
      role: p.role,
      level: p.level,
      version: p.version,
      data: p,
      status: "published" as const,
      reviewedAt: p.reviewed_at,
      provisional: false,
    };
    const [existing] = await db
      .select({ id: companyPacks.id })
      .from(companyPacks)
      .where(eq(companyPacks.slug, p.slug));
    if (existing) await db.update(companyPacks).set(values).where(eq(companyPacks.id, existing.id));
    else await db.insert(companyPacks).values({ id: newId(), ...values });
  }
  return { questions: bank.questions.length, packs: bank.packs.length };
}
