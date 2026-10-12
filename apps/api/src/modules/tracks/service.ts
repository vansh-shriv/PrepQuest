import { and, eq, sql } from "drizzle-orm";
import { companyPacks, userTracks, type Database } from "@prepquest/db";
import { curatedList, heatmap, overlap, type CuratedInput } from "@prepquest/analytics-core";
import {
  AppError,
  type StartTrackResponse,
  type TrackCompareResponse,
  type TrackDto,
  type TrackProblemDto,
  type TrackSummaryDto,
  type TracksResponse,
} from "@prepquest/shared";
import { loadLearner, titleCase, type Learner } from "../analytics/learner.js";
import { getReadiness } from "../analytics/service.js";
import type { AiContext } from "../ai-context.js";
import { generateUserPlan } from "../planning/plan-service.js";

// Company tracks (P4): a pack's process, topic heatmap and a curated problem list, with progress, readiness
// for that company, and the overlap between two tracks. Practice style only, never inside information.

interface PackData {
  disclaimer?: string;
  process?: Array<{ round: string; type?: string; format?: string; minutes: number }>;
  topic_weights: Record<string, number>;
  difficulty_band: { easy: number; medium: number; hard: number };
  interview_style?: { bar?: string; notes?: string };
  behavioral_competencies?: string[];
  cs_topics?: string[];
  checklist?: string[];
  pitfalls?: string[];
}

type PackRow = typeof companyPacks.$inferSelect;

async function loadPack(db: Database, slug: string): Promise<PackRow> {
  const [p] = await db.select().from(companyPacks).where(eq(companyPacks.slug, slug));
  if (!p || p.status !== "published" || p.provisional)
    throw new AppError("NOT_FOUND", 404, "Track not found.");
  return p;
}

function curatedFor(l: Learner, pack: PackData): Array<CuratedInput & { weight: number }> {
  const problems: CuratedInput[] = l.rows.map((r) => ({
    slug: r.slug,
    difficulty: r.difficulty,
    topics: l.topics.get(r.problem_id) ?? [],
    patterns: l.patterns.get(r.problem_id) ?? [],
  }));
  return curatedList(problems, pack);
}

function problemDto(l: Learner, slug: string): TrackProblemDto {
  const r = l.rows.find((x) => x.slug === slug)!;
  return {
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty,
    topics: l.topics.get(r.problem_id) ?? [],
    solved: r.solved,
  };
}

const summarize = (
  p: PackRow,
  l: Learner,
  started: boolean,
  curated: Array<{ slug: string }>,
): TrackSummaryDto => {
  const solved = new Set(l.rows.filter((r) => r.solved).map((r) => r.slug));
  return {
    slug: p.slug,
    title: p.title,
    role: p.role,
    level: p.level,
    reviewedAt: p.reviewedAt,
    started,
    solved: curated.filter((c) => solved.has(c.slug)).length,
    total: curated.length,
  };
};

async function startedSlugs(db: Database, userId: string): Promise<Set<string>> {
  const rows = (
    await db.execute(sql`
      SELECT p.slug FROM user_tracks t JOIN company_packs p ON p.id = t.pack_id
      WHERE t.user_id = ${userId}`)
  ).rows as Array<{ slug: string }>;
  return new Set(rows.map((r) => r.slug));
}

export async function listTracks(db: Database, userId: string, now: Date): Promise<TracksResponse> {
  const packs = (
    await db
      .select()
      .from(companyPacks)
      .where(and(eq(companyPacks.status, "published"), eq(companyPacks.provisional, false)))
  ).sort((a, b) => a.title.localeCompare(b.title));
  const l = await loadLearner(db, userId, now);
  const started = await startedSlugs(db, userId);
  return {
    tracks: packs.map((p) =>
      summarize(p, l, started.has(p.slug), curatedFor(l, p.data as PackData)),
    ),
  };
}

async function buildTrack(
  db: Database,
  userId: string,
  p: PackRow,
  l: Learner,
  now: Date,
): Promise<TrackDto> {
  const data = p.data as PackData;
  const curated = curatedFor(l, data);
  const started = (await startedSlugs(db, userId)).has(p.slug);
  const readiness = await getReadiness(db, userId, p.slug, now);
  const types = [
    ...new Set((data.process ?? []).map((r) => r.type).filter((t): t is string => Boolean(t))),
  ];
  return {
    ...summarize(p, l, started, curated),
    disclaimer:
      data.disclaimer ?? "Practice style inspired by public patterns. Not an official process.",
    process: data.process ?? [],
    heatmap: heatmap(data).map((h) => ({ ...h, name: l.names.get(h.topic) ?? titleCase(h.topic) })),
    problems: curated.map((c) => problemDto(l, c.slug)),
    behavioralCompetencies: data.behavioral_competencies ?? [],
    checklist: data.checklist ?? [],
    pitfalls: data.pitfalls ?? [],
    interviewStyle: {
      bar: data.interview_style?.bar ?? "standard",
      notes: data.interview_style?.notes ?? "",
    },
    readiness: { score: readiness.score, band: readiness.band, label: readiness.label },
    interview: { href: `/interview/new?pack=${p.slug}`, types },
    planHref: `/plan?pack=${p.slug}`,
  };
}

export async function getTrack(
  db: Database,
  userId: string,
  slug: string,
  now: Date,
): Promise<TrackDto> {
  const p = await loadPack(db, slug);
  return buildTrack(db, userId, p, await loadLearner(db, userId, now), now);
}

/** Starting a track records it and builds the study plan around the company (P1), with a ready interview setup. */
export async function startTrack(
  ctx: AiContext,
  userId: string,
  slug: string,
): Promise<StartTrackResponse> {
  const p = await loadPack(ctx.db, slug);
  await ctx.db.insert(userTracks).values({ userId, packId: p.id }).onConflictDoNothing();
  let planCreated = false;
  try {
    await generateUserPlan(ctx, userId, { packSlug: p.slug });
    planCreated = true;
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message, userId, slug }, "track started without a plan");
  }
  const now = ctx.now();
  const l = await loadLearner(ctx.db, userId, now);
  return { track: await buildTrack(ctx.db, userId, p, l, now), planCreated };
}

export async function compareTracks(
  db: Database,
  userId: string,
  aSlug: string,
  bSlug: string,
  now: Date,
): Promise<TrackCompareResponse> {
  const a = await loadPack(db, aSlug);
  const b = await loadPack(db, bSlug);
  const l = await loadLearner(db, userId, now);
  const la = curatedFor(l, a.data as PackData).map((c) => c.slug);
  const lb = curatedFor(l, b.data as PackData).map((c) => c.slug);
  const o = overlap(la, lb);
  const dto = (slugs: string[]) => slugs.map((s) => problemDto(l, s));
  return {
    a: { slug: a.slug, title: a.title },
    b: { slug: b.slug, title: b.title },
    shared: dto(o.shared),
    onlyA: dto(o.onlyA),
    onlyB: dto(o.onlyB),
    coversB: o.coversB,
    coversA: o.coversA,
    addForB: dto(o.onlyB).filter((p) => !p.solved),
  };
}
