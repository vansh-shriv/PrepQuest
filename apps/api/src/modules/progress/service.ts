import { desc, eq, sql } from "drizzle-orm";
import { badges, badgesEarned, profiles, xpEvents, type Database } from "@prepquest/db";
import {
  addDays,
  BADGES,
  currentStreak,
  levelFor,
  localDay,
  recommendNext,
  topicMastery,
  weakAreas,
  type Candidate,
  type ProblemEvidence,
} from "@prepquest/analytics-core";
import {
  AppError,
  type BadgeDto,
  type DashboardDto,
  type DashboardRange,
  type XpResponse,
} from "@prepquest/shared";
import { listSheets } from "../problems/service.js";

const titleCase = (slug: string) =>
  slug
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");

const RANGE_DAYS: Record<Exclude<DashboardRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};
const HEATMAP_DAYS = 26 * 7;

export async function getXp(db: Database, userId: string): Promise<XpResponse> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!profile) throw new AppError("NOT_FOUND", 404, "Profile not found");
  const events = await db
    .select({ delta: xpEvents.delta, reason: xpEvents.reason, at: xpEvents.at })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId))
    .orderBy(desc(xpEvents.at), desc(xpEvents.id))
    .limit(50);
  return {
    xp: profile.xp,
    level: levelFor(profile.xp),
    events: events.map((e) => ({ delta: e.delta, reason: e.reason, at: e.at.toISOString() })),
  };
}

export async function getBadges(db: Database, userId: string): Promise<BadgeDto[]> {
  const rows = await db
    .select({
      id: badges.id,
      name: badges.name,
      description: badges.description,
      sprite: badges.sprite,
      earnedAt: badgesEarned.earnedAt,
    })
    .from(badges)
    .leftJoin(
      badgesEarned,
      sql`${badgesEarned.badgeId} = ${badges.id} AND ${badgesEarned.userId} = ${userId}`,
    );
  const order = BADGES.map((b) => b.id);
  return rows
    .map((r) => ({ ...r, earnedAt: r.earnedAt?.toISOString() ?? null }))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

interface EvidenceRow {
  problem_id: string;
  slug: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  attempted: boolean;
  solved: boolean;
  first_try: boolean;
  hinted: boolean;
  last_at: Date | null;
  wa: number;
  tle: number;
  re: number;
  mle: number;
  ce: number;
}

/** One row per published problem with the user's history on it (problems never touched have attempted = false). */
async function loadEvidence(db: Database, userId: string) {
  const rows = (
    await db.execute(sql`
      SELECT p.id AS problem_id, p.slug, p.title, p.difficulty,
        COALESCE(ups.attempts, 0) > 0 AS attempted,
        COALESCE(ups.status = 'solved', false) AS solved,
        COALESCE(ups.first_try_ac, false) AS first_try,
        COALESCE(ups.hints_used > 0 OR ups.gave_up_at IS NOT NULL, false) AS hinted,
        ups.last_submission_at AS last_at,
        COALESCE(v.wa, 0)::int AS wa, COALESCE(v.tle, 0)::int AS tle, COALESCE(v.re, 0)::int AS re,
        COALESCE(v.mle, 0)::int AS mle, COALESCE(v.ce, 0)::int AS ce
      FROM problems p
      LEFT JOIN user_problem_state ups ON ups.problem_id = p.id AND ups.user_id = ${userId}
      LEFT JOIN (
        SELECT problem_id,
          count(*) FILTER (WHERE verdict = 'WA') AS wa, count(*) FILTER (WHERE verdict = 'TLE') AS tle,
          count(*) FILTER (WHERE verdict = 'RE') AS re, count(*) FILTER (WHERE verdict = 'MLE') AS mle,
          count(*) FILTER (WHERE verdict = 'CE') AS ce
        FROM submissions WHERE user_id = ${userId} AND kind = 'submit' GROUP BY problem_id
      ) v ON v.problem_id = p.id
      WHERE p.status = 'published'`)
  ).rows as unknown as EvidenceRow[];

  const tagRows = (
    await db.execute(sql`
      SELECT pt.problem_id, t.slug, t.kind, t.name
      FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id
      JOIN problems p ON p.id = pt.problem_id AND p.status = 'published'`)
  ).rows as unknown as Array<{ problem_id: string; slug: string; kind: string; name: string }>;

  const topics = new Map<string, string[]>();
  const patterns = new Map<string, string[]>();
  const names = new Map<string, string>();
  for (const t of tagRows) {
    const target = t.kind === "topic" ? topics : patterns;
    target.set(t.problem_id, [...(target.get(t.problem_id) ?? []), t.slug]);
    if (t.kind === "topic") names.set(t.slug, t.name);
  }
  return { rows, topics, patterns, names };
}

export async function getDashboard(
  db: Database,
  userId: string,
  range: DashboardRange,
  now = new Date(),
): Promise<DashboardDto> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!profile) throw new AppError("NOT_FOUND", 404, "Profile not found");
  const today = localDay(now, profile.timezone);
  const rangeStart = range === "all" ? null : addDays(today, -(RANGE_DAYS[range] - 1));

  const { rows, topics, patterns, names } = await loadEvidence(db, userId);

  // ---- solved and accuracy
  const solvedRows = rows.filter((r) => r.solved);
  const stats = (
    await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE s.verdict NOT IN ('IE','QUEUED','COMPILING','RUNNING'))::int AS submissions,
        count(*) FILTER (WHERE s.verdict = 'AC')::int AS accepted
      FROM submissions s
      WHERE s.user_id = ${userId} AND s.kind = 'submit'
        ${rangeStart ? sql`AND s.created_at >= (${rangeStart}::date::timestamp AT TIME ZONE ${profile.timezone})` : sql``}`)
  ).rows[0] as { submissions: number; accepted: number };

  const solvedInfo = (
    await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE ${
          rangeStart
            ? sql`(ups.first_ac_at AT TIME ZONE ${profile.timezone})::date >= ${rangeStart}::date`
            : sql`true`
        })::int AS in_range,
        count(*) FILTER (WHERE ups.first_try_ac)::int AS first_try,
        COALESCE(avg((SELECT count(*) FROM submissions s
          WHERE s.user_id = ups.user_id AND s.problem_id = ups.problem_id AND s.kind = 'submit'
            AND s.verdict NOT IN ('IE','QUEUED','COMPILING','RUNNING')
            AND s.created_at <= ups.first_ac_at)), 0)::float AS avg_attempts
      FROM user_problem_state ups
      JOIN problems p ON p.id = ups.problem_id
      WHERE ups.user_id = ${userId} AND ups.status = 'solved'`)
  ).rows[0] as { in_range: number; first_try: number; avg_attempts: number };

  // ---- daily activity
  const fromDay = addDays(today, -(HEATMAP_DAYS - 1));
  const activity = await db.execute(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, problems FROM activity_days
    WHERE user_id = ${userId} AND day >= ${fromDay}::date AND problems > 0 ORDER BY day`);
  const byDay = new Map(
    (activity.rows as Array<{ day: string; problems: number }>).map((r) => [r.day, r.problems]),
  );
  const daily = Array.from({ length: 30 }, (_, i) => byDay.get(addDays(today, i - 29)) ?? 0);

  // ---- skills and recommendations
  const topicList = [...new Set([...topics.values()].flat())].sort();
  const evidence: ProblemEvidence[] = rows.map((r) => ({
    slug: r.slug,
    difficulty: r.difficulty,
    topics: topics.get(r.problem_id) ?? [],
    patterns: patterns.get(r.problem_id) ?? [],
    attempted: r.attempted,
    solved: r.solved,
    firstTry: r.first_try,
    hinted: r.hinted,
    lastAt: r.last_at ? new Date(r.last_at) : null,
    verdicts: { WA: r.wa, TLE: r.tle, RE: r.re, MLE: r.mle, CE: r.ce },
  }));
  const masteries = topicMastery(evidence, topicList, now);
  const candidates: Candidate[] = rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty,
    topics: topics.get(r.problem_id) ?? [],
    patterns: patterns.get(r.problem_id) ?? [],
    solved: r.solved,
  }));
  const displayName = (slug: string) => names.get(slug) ?? titleCase(slug);

  // ---- the rest
  const recent = await db.execute(sql`
    SELECT s.id, s.verdict, s.language, s.created_at, p.slug, p.title
    FROM submissions s JOIN problems p ON p.id = s.problem_id
    WHERE s.user_id = ${userId} AND s.kind = 'submit'
    ORDER BY s.created_at DESC, s.id DESC LIMIT 5`);
  const sheetRows = await listSheets(db, userId);
  const badgeList = await getBadges(db, userId);

  const streakState = {
    current: profile.streakCurrent,
    best: profile.streakBest,
    lastActive: profile.streakLastActive,
    freezes: profile.streakFreezes,
  };
  const submissions = stats.submissions;
  return {
    range,
    player: {
      xp: profile.xp,
      level: levelFor(profile.xp),
      streak: {
        current: currentStreak(streakState, today),
        best: profile.streakBest,
        freezes: profile.streakFreezes,
      },
      today,
      timezone: profile.timezone,
    },
    solved: {
      total: solvedRows.length,
      easy: solvedRows.filter((r) => r.difficulty === "easy").length,
      medium: solvedRows.filter((r) => r.difficulty === "medium").length,
      hard: solvedRows.filter((r) => r.difficulty === "hard").length,
      inRange: solvedInfo.in_range,
      daily,
    },
    accuracy: {
      submissions,
      accepted: stats.accepted,
      acceptanceRate:
        submissions === 0 ? 0 : Math.round((stats.accepted / submissions) * 1000) / 10,
      firstTryRate:
        solvedRows.length === 0
          ? 0
          : Math.round((solvedInfo.first_try / solvedRows.length) * 1000) / 10,
      avgAttemptsToAc: Math.round(solvedInfo.avg_attempts * 10) / 10,
    },
    heatmap: [...byDay.entries()].map(([day, count]) => ({ day, count })),
    skills: masteries.map((m) => ({
      topic: m.topic,
      name: displayName(m.topic),
      stage: m.stage,
      mastery: Math.round(m.mastery * 100) / 100,
      attempted: m.attempted,
      solved: m.solved,
    })),
    weakAreas: weakAreas(masteries)
      .slice(0, 3)
      .map((m) => ({
        topic: m.topic,
        name: displayName(m.topic),
        mastery: Math.round(m.mastery * 100) / 100,
        diagnosis: m.diagnosis,
      })),
    next: recommendNext(masteries, candidates, 3),
    recent: (
      recent.rows as Array<{
        id: string;
        verdict: string;
        language: string;
        created_at: Date;
        slug: string;
        title: string;
      }>
    ).map((r) => ({
      id: r.id,
      problem: { slug: r.slug, title: r.title },
      verdict: r.verdict,
      language: r.language,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    sheets: sheetRows.map((s) => ({
      slug: s.slug,
      title: s.title,
      solved: s.solved ?? 0,
      total: s.total,
    })),
    badges: badgeList,
    countdown: profile.placementDate
      ? {
          placementDate: profile.placementDate,
          daysLeft: Math.round(
            (Date.parse(`${profile.placementDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
              86_400_000,
          ),
        }
      : null,
  };
}
