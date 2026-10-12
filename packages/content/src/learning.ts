import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { graphIssues, QUIZ_TYPES } from "@prepquest/analytics-core";
import { newId, quizQuestions, roadmaps, type Db } from "@prepquest/db";
import { z } from "zod";
import type { Issue } from "./types.js";
import type { Taxonomy } from "./validate.js";

// Quiz questions (content/quizzes/<subject>.json) and roadmaps (content/roadmaps/<slug>.json): authored as
// JSON, validated here and upserted by slug, like the question bank (doc 17).

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(80);

export const QUIZ_SUBJECTS = ["os", "dbms", "cn", "oop", "sql", "embedded", "ml"] as const;

const option = z.object({ id: z.string().regex(/^[a-f]$/), text: z.string().min(1).max(300) });

export const quizQuestionSchema = z.object({
  slug,
  topic: z.string().min(1).max(40),
  difficulty: z.number().int().min(1).max(5),
  type: z.enum(QUIZ_TYPES),
  body: z.string().min(10).max(900),
  options: z.array(option).min(2).max(6).optional(),
  /** single: an option id. multi: option ids. tf: boolean. blank and output: accepted answers. */
  answer: z.union([z.string(), z.boolean(), z.array(z.string()).min(1)]),
  explanation: z.string().min(20).max(1200),
  interview_line: z.string().min(10).max(300).optional(),
  tags: z.array(z.string().max(40)).max(8).default([]),
});
export type QuizQuestionSource = z.infer<typeof quizQuestionSchema> & { subject: string };

const quizFileSchema = z.object({
  subject: z.enum(QUIZ_SUBJECTS),
  questions: z.array(quizQuestionSchema).min(1),
});

const resource = z.object({
  title: z.string().min(2).max(120),
  kind: z.enum(["read", "watch", "practice"]).default("read"),
  note: z.string().max(300).optional(),
});

export const roadmapNodeSchema = z.object({
  id: slug,
  title: z.string().min(2).max(80),
  summary: z.string().min(20).max(600),
  /** Taxonomy topic or pattern whose mastery measures this node. */
  topic: z.string().max(40).optional(),
  /** A quiz subject whose accuracy measures this node (for fundamentals nodes). */
  quiz_subject: z.enum(QUIZ_SUBJECTS).optional(),
  resources: z.array(resource).max(6).default([]),
  /** The ladder: problems to solve, easiest first. The last one is the checkpoint ("boss"). */
  problems: z.array(slug).max(12).default([]),
  requires: z.array(slug).max(5).default([]),
  unlock_threshold: z.number().min(0.3).max(0.95).optional(),
  master_threshold: z.number().min(0.4).max(1).optional(),
});
export type RoadmapNodeSource = z.infer<typeof roadmapNodeSchema>;

export const roadmapSchema = z.object({
  slug,
  title: z.string().min(3).max(100),
  track: z.enum(["sde", "fundamentals", "fullstack", "ml", "embedded"]),
  description: z.string().min(20).max(400),
  version: z.number().int().min(1),
  nodes: z.array(roadmapNodeSchema).min(2).max(40),
});
export type RoadmapSource = z.infer<typeof roadmapSchema>;

export interface LoadedLearning {
  quizzes: QuizQuestionSource[];
  roadmaps: RoadmapSource[];
  issues: Issue[];
}

async function jsonFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

export async function loadLearning(root: string): Promise<LoadedLearning> {
  const issues: Issue[] = [];
  const quizzes: QuizQuestionSource[] = [];
  const maps: RoadmapSource[] = [];
  for (const file of await jsonFiles(join(root, "quizzes"))) {
    try {
      const parsed = quizFileSchema.parse(
        JSON.parse(await readFile(join(root, "quizzes", file), "utf8")),
      );
      for (const q of parsed.questions) quizzes.push({ ...q, subject: parsed.subject });
    } catch (e) {
      issues.push({
        level: "error",
        problem: `quizzes/${file}`,
        message: (e as Error).message.split("\n")[0] ?? "invalid",
      });
    }
  }
  for (const file of await jsonFiles(join(root, "roadmaps"))) {
    try {
      maps.push(
        roadmapSchema.parse(JSON.parse(await readFile(join(root, "roadmaps", file), "utf8"))),
      );
    } catch (e) {
      issues.push({
        level: "error",
        problem: `roadmaps/${file}`,
        message: (e as Error).message.split("\n")[0] ?? "invalid",
      });
    }
  }
  return { quizzes, roadmaps: maps, issues };
}

/** Rules beyond the schema: the answer fits the type and the options, slugs are unique, roadmaps are DAGs. */
export function validateLearning(
  learning: LoadedLearning,
  taxonomy: Taxonomy,
  problemSlugs: ReadonlySet<string>,
): Issue[] {
  const issues: Issue[] = [];
  const err = (problem: string, message: string) =>
    issues.push({ level: "error", problem, message });
  const seen = new Set<string>();
  for (const q of learning.quizzes) {
    const name = `quiz ${q.slug}`;
    if (seen.has(q.slug)) err(name, "duplicate question slug");
    seen.add(q.slug);
    const ids = new Set((q.options ?? []).map((o) => o.id));
    const choice = q.type === "single" || q.type === "multi";
    if (choice && ids.size < 2) err(name, "choice questions need at least two options");
    if (!choice && q.options) err(name, `${q.type} questions take no options`);
    if (ids.size !== (q.options ?? []).length) err(name, "duplicate option ids");
    if (q.type === "single") {
      if (typeof q.answer !== "string" || !ids.has(q.answer))
        err(name, "single answer must be one of the option ids");
    } else if (q.type === "multi") {
      if (!Array.isArray(q.answer) || q.answer.length < 2 || !q.answer.every((a) => ids.has(a)))
        err(name, "multi answer must list two or more option ids");
    } else if (q.type === "tf") {
      if (typeof q.answer !== "boolean") err(name, "true/false answer must be a boolean");
    } else if (!Array.isArray(q.answer)) {
      err(name, `${q.type} answer must be a list of accepted answers`);
    }
  }
  const mapSlugs = new Set<string>();
  const quizSubjects = new Set(learning.quizzes.map((q) => q.subject));
  for (const r of learning.roadmaps) {
    const name = `roadmap ${r.slug}`;
    if (mapSlugs.has(r.slug)) err(name, "duplicate roadmap slug");
    mapSlugs.add(r.slug);
    for (const issue of graphIssues(r.nodes.map((n) => ({ id: n.id, requires: n.requires }))))
      err(name, issue);
    for (const n of r.nodes) {
      if (n.topic && !taxonomy.topics.has(n.topic) && !taxonomy.patterns.has(n.topic))
        err(name, `node "${n.id}": unknown topic "${n.topic}"`);
      if (!n.topic && !n.quiz_subject && n.problems.length === 0)
        err(name, `node "${n.id}" has nothing to measure it by (topic, quiz subject or problems)`);
      if (n.quiz_subject && !quizSubjects.has(n.quiz_subject))
        err(name, `node "${n.id}": no quiz questions for subject "${n.quiz_subject}"`);
      for (const p of n.problems)
        if (!problemSlugs.has(p)) err(name, `node "${n.id}": unknown problem "${p}"`);
      if (
        n.unlock_threshold !== undefined &&
        n.master_threshold !== undefined &&
        n.master_threshold < n.unlock_threshold
      )
        err(name, `node "${n.id}": master threshold is below the unlock threshold`);
    }
  }
  return issues;
}

export async function importLearning(
  db: Db,
  learning: LoadedLearning,
): Promise<{ quizzes: number; roadmaps: number }> {
  for (const q of learning.quizzes) {
    const values = {
      slug: q.slug,
      subject: q.subject,
      topic: q.topic,
      difficulty: q.difficulty,
      type: q.type,
      bodyMd: q.body,
      options: q.options ?? null,
      answer: q.answer,
      explanationMd: q.explanation,
      interviewLine: q.interview_line ?? null,
      tags: q.tags,
      status: "published" as const,
    };
    await db
      .insert(quizQuestions)
      .values({ id: newId(), ...values })
      .onConflictDoUpdate({
        target: quizQuestions.slug,
        set: { ...values, updatedAt: sql`now()` },
      });
  }
  for (const r of learning.roadmaps) {
    const values = {
      slug: r.slug,
      title: r.title,
      track: r.track,
      description: r.description,
      version: r.version,
      data: { nodes: r.nodes },
      status: "published" as const,
    };
    await db
      .insert(roadmaps)
      .values({ id: newId(), ...values })
      .onConflictDoUpdate({ target: roadmaps.slug, set: { ...values, updatedAt: sql`now()` } });
  }
  return { quizzes: learning.quizzes.length, roadmaps: learning.roadmaps.length };
}
