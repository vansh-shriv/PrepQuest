import { createHash } from "node:crypto";
import { and, asc, eq, or } from "drizzle-orm";
import { z } from "zod";
import {
  companyPacks,
  newId,
  PATTERN_TAGS,
  questionBank,
  TOPIC_TAGS,
  type Database,
} from "@prepquest/db";
import type { PackStyle } from "@prepquest/interview-core";
import { PROMPT_VERSIONS, PACK_SYSTEM, buildPackPrompt } from "@prepquest/prompts";
import { AppError, type CompanyPackDto } from "@prepquest/shared";
import type { AiContext } from "../ai-context.js";

// Company packs (I2): curated packs from content/company-packs, and provisional packs inferred from a
// free-text target. Both describe a practice style inspired by public patterns; neither is official.

type PackRow = typeof companyPacks.$inferSelect;

const RUBRIC_KEYS = [
  "problem_solving",
  "code_quality",
  "communication",
  "optimization",
  "edge_cases",
  "testing",
  "correctness",
] as const;
const CS_TOPICS = ["os", "dbms", "cn", "oop"] as const;
const ALLOWED_TOPICS: readonly string[] = [...TOPIC_TAGS, ...PATTERN_TAGS];

export const PROVISIONAL_DISCLAIMER =
  "Inferred by an AI model from public patterns. Unverified: adjust anything that does not match what you were told.";

export function toPackStyle(row: PackRow): PackStyle {
  return row.data as PackStyle;
}

export function toPackDto(row: PackRow): CompanyPackDto {
  const d = row.data as PackStyle & {
    process?: CompanyPackDto["process"];
    disclaimer?: string;
    checklist?: string[];
    pitfalls?: string[];
  };
  return {
    slug: row.slug,
    title: row.title,
    role: row.role,
    level: row.level,
    disclaimer:
      d.disclaimer ?? "Practice style inspired by public patterns. Not an official process.",
    provisional: row.provisional,
    reviewedAt: row.reviewedAt ?? null,
    process: d.process ?? [],
    topWeights: Object.entries(d.topic_weights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([topic, weight]) => ({ topic, weight })),
    difficultyBand: d.difficulty_band,
    style: {
      bar: d.interview_style.bar,
      followUpDepth: d.interview_style.follow_up_depth,
      hintPolicy: d.interview_style.hint_policy,
      notes: d.interview_style.notes,
    },
    competencies: d.behavioral_competencies,
    checklist: d.checklist ?? [],
    pitfalls: d.pitfalls ?? [],
  };
}

/** Curated packs plus the user's own provisional ones. */
export async function listPacks(db: Database, userId: string): Promise<CompanyPackDto[]> {
  const rows = await db
    .select()
    .from(companyPacks)
    .where(
      and(
        eq(companyPacks.status, "published"),
        or(eq(companyPacks.provisional, false), eq(companyPacks.createdBy, userId)),
      ),
    )
    .orderBy(asc(companyPacks.provisional), asc(companyPacks.title));
  return rows.map(toPackDto);
}

export async function findPack(
  db: Database,
  userId: string,
  slug: string,
): Promise<PackRow | null> {
  const [row] = await db
    .select()
    .from(companyPacks)
    .where(
      and(
        eq(companyPacks.slug, slug),
        eq(companyPacks.status, "published"),
        or(eq(companyPacks.provisional, false), eq(companyPacks.createdBy, userId)),
      ),
    );
  return row ?? null;
}

// --- provisional packs --------------------------------------------------------------------------

const draftSchema = z.object({
  topic_weights: z.record(z.string(), z.number()).default({}),
  difficulty_band: z.object({ easy: z.number(), medium: z.number(), hard: z.number() }),
  interview_style: z.object({
    bar: z.string().max(30).default("medium"),
    follow_up_depth: z.number().default(2),
    hint_policy: z.string().default("balanced"),
    behavioral_weight: z.number().default(0.3),
    notes: z.string().max(400).default(""),
  }),
  rubric_weights: z.record(z.string(), z.number()).default({}),
  behavioral_competencies: z.array(z.string()).default([]),
  cs_topics: z.array(z.string()).default([]),
  checklist: z.array(z.string().max(160)).default([]),
  pitfalls: z.array(z.string().max(160)).default([]),
});

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const normalize = (m: Record<string, number>): Record<string, number> => {
  const sum = Object.values(m).reduce((a, b) => a + b, 0);
  if (sum <= 0) return m;
  return Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, Math.round((v / sum) * 1000) / 1000]),
  );
};

/**
 * Turns a model draft into a pack that satisfies the same rules as curated ones: known topics and
 * competencies only, weights that add up, bounded numbers. Anything unusable falls back to a neutral default.
 */
export function sanitizeDraft(
  raw: z.infer<typeof draftSchema>,
  meta: { slug: string; title: string; level: string; competencies: readonly string[] },
): PackStyle & { disclaimer: string; checklist: string[]; pitfalls: string[] } {
  const topics = Object.fromEntries(
    Object.entries(raw.topic_weights)
      .filter(([k]) => ALLOWED_TOPICS.includes(k))
      .slice(0, 8)
      .map(([k, v]) => [k, Math.round(clamp01(v) * 100) / 100]),
  );
  const band = normalize({
    easy: clamp01(raw.difficulty_band.easy),
    medium: clamp01(raw.difficulty_band.medium),
    hard: clamp01(raw.difficulty_band.hard),
  });
  const bandOk = Object.values(band).reduce((a, b) => a + b, 0) > 0.99;
  const rubric = normalize(
    Object.fromEntries(
      Object.entries(raw.rubric_weights)
        .filter(([k]) => (RUBRIC_KEYS as readonly string[]).includes(k))
        .map(([k, v]) => [k, clamp01(v)]),
    ),
  );
  const rubricOk = Object.keys(rubric).length >= 4;
  const comps = raw.behavioral_competencies
    .filter((c) => meta.competencies.includes(c))
    .slice(0, 5);
  const style = raw.interview_style;
  return {
    slug: meta.slug,
    title: meta.title,
    level: meta.level,
    topic_weights: topics,
    difficulty_band: bandOk
      ? (band as { easy: number; medium: number; hard: number })
      : { easy: 0.3, medium: 0.5, hard: 0.2 },
    interview_style: {
      bar: style.bar,
      follow_up_depth: Math.max(0, Math.min(5, Math.round(style.follow_up_depth))),
      hint_policy: (["sparse", "balanced", "generous"] as const).includes(
        style.hint_policy as "sparse",
      )
        ? (style.hint_policy as "sparse" | "balanced" | "generous")
        : "balanced",
      behavioral_weight: clamp01(style.behavioral_weight),
      notes: `Typical patterns, not facts. ${style.notes}`.slice(0, 300),
    },
    rubric_weights: rubricOk
      ? rubric
      : {
          problem_solving: 0.3,
          code_quality: 0.15,
          communication: 0.2,
          optimization: 0.15,
          edge_cases: 0.1,
          testing: 0.05,
          correctness: 0.05,
        },
    behavioral_competencies: comps.length >= 2 ? comps : meta.competencies.slice(0, 3),
    cs_topics: raw.cs_topics.filter((t) => (CS_TOPICS as readonly string[]).includes(t)),
    checklist: raw.checklist.slice(0, 4),
    pitfalls: raw.pitfalls.slice(0, 3),
    disclaimer: PROVISIONAL_DISCLAIMER,
  };
}

export const provisionalSlug = (
  userId: string,
  company: string,
  role: string | null,
  level: string,
) =>
  `custom-${createHash("sha256")
    .update(
      `${userId}|${company.toLowerCase().trim()}|${(role ?? "").toLowerCase().trim()}|${level}`,
    )
    .digest("hex")
    .slice(0, 12)}`;

/** The user's provisional pack for this target, created (once) from the model when it does not exist. */
export async function provisionalPackFor(
  ctx: AiContext,
  userId: string,
  target: { company: string; role: string | null; level: string },
): Promise<PackRow> {
  const slug = provisionalSlug(userId, target.company, target.role, target.level);
  const [existing] = await ctx.db.select().from(companyPacks).where(eq(companyPacks.slug, slug));
  if (existing) return existing;

  const comps = await ctx.db
    .selectDistinct({ c: questionBank.competency })
    .from(questionBank)
    .where(eq(questionBank.category, "behavioral"));
  const competencies = comps.map((r) => r.c).filter((c): c is string => Boolean(c));
  const { value } = await ctx.llm.json(
    {
      task: "pack",
      modelClass: "light",
      system: PACK_SYSTEM,
      messages: [
        {
          role: "user",
          content: buildPackPrompt({ ...target, topics: ALLOWED_TOPICS, competencies }),
        },
      ],
      maxTokens: 1500,
      effort: "low",
      userId,
      promptVersion: PROMPT_VERSIONS.pack,
    },
    draftSchema,
  );
  const title = `${target.company.slice(0, 80)} (inferred)`;
  const data = sanitizeDraft(value, { slug, title, level: target.level, competencies });
  const [row] = await ctx.db
    .insert(companyPacks)
    .values({
      id: newId(),
      slug,
      title,
      role: target.role ?? "SDE",
      level: target.level,
      version: 1,
      data,
      status: "published",
      provisional: true,
      createdBy: userId,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [again] = await ctx.db.select().from(companyPacks).where(eq(companyPacks.slug, slug));
  if (!again) throw new AppError("INTERNAL", 500, "Could not create the profile");
  return again;
}
