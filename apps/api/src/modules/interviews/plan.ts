import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { companyPacks } from "@prepquest/db";
import { questionMemory, resumes, type Database } from "@prepquest/db";
import {
  buildPlan,
  getTemplate,
  pickProblems,
  pickVerbal,
  planLevel,
  questionCountFor,
  segmentKeyForQuestion,
  toProblemQuestion,
  toVerbalQuestion,
  type BankCandidate,
  type Candidate,
  type InterviewPlan,
  type InterviewTemplate,
  type PackStyle,
  type PlannedQuestion,
} from "@prepquest/interview-core";
import { PROMPT_VERSIONS, QGEN_SYSTEM, buildQgenPrompt } from "@prepquest/prompts";
import { AppError, type CreateInterviewInput, type ResumeParsed } from "@prepquest/shared";
import { z } from "zod";
import { getJd, getOwnedResume } from "../resumes/service.js";
import { interviewSignals } from "../progress/service.js";
import type { AiContext } from "../ai-context.js";
import { loadBankBySlugs, loadBankCandidates, memorySignals } from "./bank.js";
import { findPack, provisionalPackFor, provisionalSlug, toPackStyle } from "./packs.js";

const RECENT_DAYS = 60;

export async function loadCandidates(db: Database): Promise<Candidate[]> {
  const { rows } = await db.execute(sql`
    SELECT p.id, p.slug, p.title, p.difficulty::text AS difficulty,
           COALESCE(array_agg(t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS tags
    FROM problems p
    LEFT JOIN problem_tags pt ON pt.problem_id = p.id
    LEFT JOIN tags t ON t.id = pt.tag_id
    WHERE p.status = 'published' AND p.signature IS NOT NULL
      AND EXISTS (SELECT 1 FROM test_cases tc WHERE tc.problem_id = p.id AND tc.version = p.current_version)
    GROUP BY p.id`);
  return (
    rows as Array<{ id: string; slug: string; title: string; difficulty: string; tags: string[] }>
  ).map((r) => ({
    problemId: r.id,
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty as Candidate["difficulty"],
    tags: r.tags,
  }));
}

async function recentRefs(db: Database, userId: string, kind: string): Promise<Set<string>> {
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  const rows = await db
    .select({ ref: questionMemory.refKey })
    .from(questionMemory)
    .where(
      and(
        eq(questionMemory.userId, userId),
        eq(questionMemory.kind, kind),
        gte(questionMemory.askedAt, since),
      ),
    )
    .orderBy(desc(questionMemory.askedAt));
  return new Set(rows.map((r) => r.ref));
}

/** Resume items a project interview can cover, best-evidenced first. */
export function resumeRefs(p: ResumeParsed): { ref: string; label: string; weight: number }[] {
  const items = [
    ...p.projects.map((x, i) => ({
      ref: `projects[${i}]`,
      label: x.name,
      weight: x.bullets.length + x.metrics.length * 2 + x.tech.length,
    })),
    ...p.experience.map((x, i) => ({
      ref: `experience[${i}]`,
      label: `${x.role ?? "Role"} at ${x.company}`,
      weight: (x.bullets.length + x.tech.length) * 0.8,
    })),
  ];
  return items.sort((a, b) => b.weight - a.weight);
}

export interface PlanResult {
  template: InterviewTemplate;
  minutes: number;
  plan: InterviewPlan;
  resumeId: string | null;
  jdId: string | null;
  warnings: string[];
  /** The pack that shaped the plan (curated, or provisional and flagged). */
  pack: typeof companyPacks.$inferSelect | null;
  packStyle: PackStyle | null;
  /** A free-text target was given but its provisional pack does not exist yet (preview only). */
  packPending: boolean;
}

const qgenSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().max(40),
        question: z.string().min(10).max(600),
        source_ref: z.string().max(40),
        followups: z.array(z.string().max(300)).max(4).default([]),
        rubric_points: z.array(z.string().max(200)).min(1).max(6),
        difficulty: z.number().int().min(1).max(5).catch(3),
      }),
    )
    .min(1)
    .max(6),
});

/**
 * Builds the plan for a session. With `generate: false` (the preview) no model is called and project
 * questions are left as placeholders naming the resume item they will cover.
 */
export async function buildSessionPlan(
  ctx: AiContext,
  userId: string,
  input: CreateInterviewInput,
  opts: { generate: boolean },
): Promise<PlanResult> {
  const template = getTemplate(input.type);
  if (!template) throw new AppError("VALIDATION_FAILED", 422, "Unknown interview type");
  const minutes = input.minutes ?? template.defaultMinutes;
  if (minutes < template.minMinutes || minutes > template.maxMinutes) {
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      `${template.title} runs ${template.minMinutes} to ${template.maxMinutes} minutes`,
    );
  }
  const warnings: string[] = [];
  const count = questionCountFor(template, minutes);
  const segKey = (i: number) => segmentKeyForQuestion(template, i, count);
  const resolved = await resolvePack(ctx, userId, input, opts.generate, warnings);
  const packStyle = resolved.style;

  let resumeId: string | null = null;
  let jdId: string | null = null;
  let questions: PlannedQuestion[];

  if (input.jdId) {
    await getJd(ctx.db, userId, input.jdId);
    jdId = input.jdId;
  }

  if (template.type === "dsa") {
    const pool = await loadCandidates(ctx.db);
    if (pool.length === 0)
      throw new AppError("UNSUPPORTED", 422, "There are no problems to ask yet.");
    let picks: Candidate[];
    if (input.problemSlugs && input.problemSlugs.length > 0) {
      picks = input.problemSlugs.map((slug) => {
        const hit = pool.find((c) => c.slug === slug);
        if (!hit)
          throw new AppError(
            "VALIDATION_FAILED",
            422,
            `Problem "${slug}" can't be used in an interview`,
          );
        return hit;
      });
    } else {
      const [recent, signals] = await Promise.all([
        recentRefs(ctx.db, userId, "problem"),
        interviewSignals(ctx.db, userId, ctx.now()),
      ]);
      picks = pickProblems(pool, {
        count,
        level: planLevel(input.difficulty, packStyle),
        ...(packStyle
          ? {
              topicWeights: packStyle.topic_weights,
              tierBand: packStyle.difficulty_band,
            }
          : {}),
        recentSlugs: recent,
        solvedCleanSlugs: new Set(signals.solvedClean),
        weakTags: new Set(signals.weakTopics),
        random: Math.random,
      });
    }
    questions = picks.map((c, i) => toProblemQuestion(c, segKey(i)));
    if (questions.length < count && !input.problemSlugs) {
      warnings.push("Only one suitable problem was available.");
    }
  } else if (template.source === "bank") {
    const category = template.bankCategory!;
    const pool = await loadBankCandidates(ctx.db, category);
    if (pool.length === 0) {
      throw new AppError("UNSUPPORTED", 422, "There are no questions of this kind yet.");
    }
    let picks: BankCandidate[];
    if (input.questionSlugs && input.questionSlugs.length > 0) {
      picks = await loadBankBySlugs(
        ctx.db,
        input.questionSlugs.map((q) => q.replace(/^bank:/, "")),
      );
      if (
        picks.length !== input.questionSlugs.length ||
        picks.some((p) => p.category !== category)
      ) {
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "One of the questions can't be used in this round",
        );
      }
    } else {
      const mem = await memorySignals(ctx.db, userId);
      const allowed =
        category === "behavioral"
          ? (packStyle?.behavioral_competencies ?? [])
          : category === "cs"
            ? (packStyle?.cs_topics ?? [])
            : [];
      const base = {
        level: planLevel(input.difficulty, packStyle),
        recentSlugs: mem.recentSlugs,
        weakSlugs: mem.weakSlugs,
        recentCompetencies: mem.recentTopics,
        isSemanticDuplicate: mem.isSemanticDuplicate,
        random: Math.random,
      };
      picks = pickVerbal(pool, { ...base, count, allowedTopics: allowed });
      if (picks.length < count) {
        // the pack's topics ran out: fill with anything else, never a repeat
        const have = new Set(picks.map((p) => p.slug));
        picks = [
          ...picks,
          ...pickVerbal(
            pool.filter((c) => !have.has(c.slug)),
            { ...base, count: count - picks.length },
          ),
        ];
      }
    }
    questions = picks.map((c, i) => toVerbalQuestion(c, segKey(i)));
    if (questions.length < count && !input.questionSlugs) {
      warnings.push(`Only ${questions.length} suitable question(s) were available.`);
    }
  } else {
    const resume = await resolveResume(ctx.db, userId, input.resumeId);
    resumeId = resume.id;
    const parsed = resume.parsed as ResumeParsed;
    const refs = resumeRefs(parsed);
    if (refs.length === 0) {
      throw new AppError(
        "RESUME_REQUIRED",
        422,
        "Your resume has no projects or experience to ask about.",
      );
    }
    const chosen = input.projectRefs?.length
      ? input.projectRefs.map((r) => {
          const hit = refs.find((x) => x.ref === r);
          if (!hit) throw new AppError("VALIDATION_FAILED", 422, `"${r}" is not on your resume`);
          return hit;
        })
      : refs.slice(0, count);
    if (!opts.generate) {
      // placeholders: the label of the resume item stands in for the question text
      questions = chosen.map((c, i) => ({
        kind: "project" as const,
        id: `preview-${i}`,
        question: c.label,
        sourceRef: c.ref,
        followups: [],
        rubricPoints: [],
        difficulty: input.difficulty,
        segmentKey: segKey(i),
      }));
    } else {
      questions = await generateProjectQuestions(
        ctx,
        userId,
        parsed,
        chosen.map((c) => c.ref),
        input,
        jdId,
        segKey,
      );
    }
  }

  const rubricWeights =
    template.type === "dsa" && packStyle
      ? Object.fromEntries(
          Object.entries(packStyle.rubric_weights).map(([k, v]) => [k, Math.round(v * 1000) / 10]),
        )
      : null;
  return {
    template,
    minutes,
    plan: buildPlan(template, minutes, questions, {
      packSlug: resolved.pack?.slug ?? null,
      rubricWeights,
      style: packStyle
        ? {
            notes: packStyle.interview_style.notes,
            followUpDepth: packStyle.interview_style.follow_up_depth,
          }
        : null,
    }),
    resumeId,
    jdId,
    warnings,
    pack: resolved.pack,
    packStyle,
    packPending: resolved.pending,
  };
}

/**
 * The company pack for a plan: a curated one chosen by slug, or the user's provisional pack for a
 * free-text target (inferred once by the model, then reused). The preview never calls the model.
 */
async function resolvePack(
  ctx: AiContext,
  userId: string,
  input: CreateInterviewInput,
  generate: boolean,
  warnings: string[],
): Promise<{
  pack: typeof companyPacks.$inferSelect | null;
  style: PackStyle | null;
  pending: boolean;
}> {
  if (input.packSlug) {
    const row = await findPack(ctx.db, userId, input.packSlug);
    if (!row)
      throw new AppError("VALIDATION_FAILED", 422, `Unknown company pack "${input.packSlug}"`);
    return { pack: row, style: toPackStyle(row), pending: false };
  }
  const company = input.company?.trim();
  if (!company) return { pack: null, style: null, pending: false };
  const slug = provisionalSlug(userId, company, input.role ?? null, input.level);
  const existing = await findPack(ctx.db, userId, slug);
  if (existing) return { pack: existing, style: toPackStyle(existing), pending: false };
  if (!generate) return { pack: null, style: null, pending: true };
  try {
    const row = await provisionalPackFor(ctx, userId, {
      company,
      role: input.role ?? null,
      level: input.level,
    });
    return { pack: row, style: toPackStyle(row), pending: false };
  } catch (err) {
    ctx.log.warn({ err }, "provisional pack failed");
    warnings.push("We couldn't infer a profile for that company, so the standard style is used.");
    return { pack: null, style: null, pending: false };
  }
}

export async function resolveResume(
  db: Database,
  userId: string,
  resumeId: string | null | undefined,
) {
  if (resumeId) {
    const r = await getOwnedResume(db, userId, resumeId);
    if (r.status !== "ready") {
      throw new AppError("RESUME_REQUIRED", 422, "Review and confirm this resume first.");
    }
    return r;
  }
  const [def] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.status, "ready")))
    .orderBy(desc(resumes.isDefault), desc(resumes.createdAt))
    .limit(1);
  if (!def)
    throw new AppError(
      "RESUME_REQUIRED",
      422,
      "Upload and confirm a resume to start a project interview.",
    );
  return def;
}

async function generateProjectQuestions(
  ctx: AiContext,
  userId: string,
  parsed: ResumeParsed,
  refs: string[],
  input: CreateInterviewInput,
  jdId: string | null,
  segKey: (i: number) => string,
): Promise<PlannedQuestion[]> {
  // the prompt only sees the chosen items, so every question cites one of them
  const keepProjects = new Set(refs.filter((r) => r.startsWith("projects")).map(indexOf));
  const keepExp = new Set(refs.filter((r) => r.startsWith("experience")).map(indexOf));
  const slim: ResumeParsed = {
    ...parsed,
    projects: parsed.projects.filter((_, i) => keepProjects.has(i)),
    experience: parsed.experience.filter((_, i) => keepExp.has(i)),
  };
  // refs inside the slim resume are renumbered; map them back to the original refs
  const back: Record<string, string> = {};
  [...keepProjects]
    .sort((a, b) => a - b)
    .forEach((orig, i) => (back[`projects[${i}]`] = `projects[${orig}]`));
  [...keepExp]
    .sort((a, b) => a - b)
    .forEach((orig, i) => (back[`experience[${i}]`] = `experience[${orig}]`));
  const jd = jdId ? (await getJd(ctx.db, userId, jdId)).rawText : null;
  const want = refs.length;
  const { value } = await ctx.llm.json(
    {
      task: "qgen",
      modelClass: "evaluator",
      system: QGEN_SYSTEM,
      messages: [
        {
          role: "user",
          content: buildQgenPrompt({
            resume: slim,
            jd,
            type: input.type === "resume" ? "resume" : "project",
            count: want,
            level: input.level,
            company: input.company ?? null,
          }),
        },
      ],
      maxTokens: 3000,
      effort: "low",
      userId,
      promptVersion: PROMPT_VERSIONS.qgen,
    },
    qgenSchema,
    {
      check: (v) => {
        const issues: string[] = [];
        if (v.questions.length < want) issues.push(`produce exactly ${want} questions`);
        for (const q of v.questions) {
          if (!back[q.source_ref])
            issues.push(
              `question ${q.id}: source_ref "${q.source_ref}" is not one of the valid refs`,
            );
        }
        return issues;
      },
    },
  );
  return value.questions.slice(0, want).map((q, i) => ({
    kind: "project" as const,
    id: q.id,
    question: q.question,
    sourceRef: back[q.source_ref] ?? refs[i] ?? refs[0]!,
    followups: q.followups,
    rubricPoints: q.rubric_points,
    difficulty: q.difficulty,
    segmentKey: segKey(i),
  }));
}

function indexOf(ref: string): number {
  return Number(/\[(\d+)\]/.exec(ref)?.[1] ?? 0);
}

/** Re-picks the next problem after seeing how the first one went (adaptive mode, doc 13 §8). */
export async function repickProblem(
  ctx: AiContext,
  userId: string,
  plan: InterviewPlan,
  index: number,
  level: number,
): Promise<PlannedQuestion | null> {
  const current = plan.questions[index];
  if (!current || current.kind !== "problem") return null;
  const used = new Set(
    plan.questions.filter((q) => q.kind === "problem").map((q) => (q as { slug: string }).slug),
  );
  const pool = (await loadCandidates(ctx.db)).filter((c) => !used.has(c.slug));
  const recent = await recentRefs(ctx.db, userId, "problem");
  const [pick] = pickProblems(pool, {
    count: 1,
    level,
    recentSlugs: recent,
    random: Math.random,
    exploration: 1,
  });
  return pick ? toProblemQuestion(pick, current.segmentKey) : null;
}
