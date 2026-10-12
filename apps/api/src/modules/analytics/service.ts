import { and, desc, eq, gte, sql } from "drizzle-orm";
import { diagnostics, newId, readinessSnapshots, type Database } from "@prepquest/db";
import {
  addDays,
  computeReadiness,
  daysBetween,
  interviewTrends,
  recommendNext,
  speedCoaching,
  speedScore,
  summarizeTimes,
  TOPIC_ORDER,
  weakAreas,
  type Candidate,
  type ComponentInputs,
  type TopicGap,
  type TopicMastery,
} from "@prepquest/analytics-core";
import type { PackStyle } from "@prepquest/interview-core";
import {
  AppError,
  type DiagnosticDto,
  type NextActionDto,
  type ReadinessDto,
  type ReadinessHistoryResponse,
  type TimeAnalyticsResponse,
  type TopicsResponse,
  type TrendsResponse,
} from "@prepquest/shared";
import {
  importanceFor,
  loadLearner,
  loadPack,
  masteriesFor,
  topicName,
  type InterviewFact,
  type Learner,
} from "./learner.js";

const round2 = (n: number) => Math.round(n * 100) / 100;
const HALF_LIFE_DAYS = 30;

const recency = (l: Learner, at: Date) =>
  Math.pow(0.5, Math.max(0, l.now.getTime() - at.getTime()) / 86_400_000 / HALF_LIFE_DAYS);

/** The target the caller asked for, as a pack and a key ("general" when none). */
export async function resolveTarget(
  db: Database,
  userId: string,
  target: string | undefined | null,
) {
  const key = target && target !== "general" ? target : "general";
  const row = await loadPack(db, userId, key);
  if (key !== "general" && !row) throw new AppError("NOT_FOUND", 404, "That target doesn't exist");
  return {
    key: row ? row.slug : "general",
    title: row ? row.title : "General readiness",
    pack: row ? (row.data as PackStyle) : null,
  };
}

// --- topics and recommendations (A2) ---------------------------------------------------------------

export function nextActions(l: Learner, masteries: TopicMastery[], count = 3): NextActionDto[] {
  const out: NextActionDto[] = [];
  const attemptedAny = l.evidence.some((e) => e.attempted);
  if (!attemptedAny) {
    out.push({
      kind: "diagnostic",
      title: "Take the 5-problem diagnostic",
      href: "/analytics#diagnostic",
      why: "There is no data to build a readiness score or a plan from yet. A short calibration fixes that.",
    });
  }
  const candidates: Candidate[] = l.rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty,
    topics: l.topics.get(r.problem_id) ?? [],
    patterns: l.patterns.get(r.problem_id) ?? [],
    solved: r.solved,
  }));
  for (const r of recommendNext(masteries, candidates, count)) {
    out.push({
      kind: "problem",
      title: r.title,
      href: `/problems/${r.slug}`,
      why: r.reason,
      difficulty: r.difficulty,
      topic: r.topic,
    });
  }
  const weak = weakAreas(masteries)[0];
  const solved = l.rows.filter((r) => r.solved).length;
  if (weak && weak.attempted >= 5) {
    out.push({
      kind: "interview",
      title: `Mock interview: ${topicName(l)(weak.topic)}`,
      href: "/interview/new?type=dsa",
      why: `${topicName(l)(weak.topic)} is at ${Math.round(weak.mastery * 100)}% after ${weak.attempted} problems: a mock interview tests it under pressure.`,
      topic: weak.topic,
    });
  } else if (solved >= 5 && l.interviews.length === 0) {
    out.push({
      kind: "interview",
      title: "Your first mock interview",
      href: "/interview/new",
      why: "You have solved enough problems to try one. The scorecard shows what practice alone cannot.",
    });
  }
  return out.slice(0, count + 1);
}

export async function getTopics(
  db: Database,
  userId: string,
  target: string | undefined,
  now: Date,
): Promise<TopicsResponse> {
  const t = await resolveTarget(db, userId, target);
  const l = await loadLearner(db, userId, now);
  const importance = importanceFor(t.pack);
  const masteries = masteriesFor(l, importance);
  return {
    target: t.key,
    topics: masteries
      .map((m) => ({
        topic: m.topic,
        name: topicName(l)(m.topic),
        mastery: round2(m.mastery),
        confidence: round2(m.confidence),
        weakness: round2(m.weakness),
        stage: m.stage,
        attempted: m.attempted,
        solved: m.solved,
        diagnosis: m.diagnosis,
        importance: round2(importance(m.topic)),
        signals: {
          solve: round2(m.signals?.solve ?? 0),
          speed: m.signals?.speed == null ? null : round2(m.signals.speed),
          independence: round2(m.signals?.independence ?? 0),
          interview: m.signals?.interview == null ? null : round2(m.signals.interview),
        },
      }))
      .sort((a, b) => b.weakness - a.weakness || a.topic.localeCompare(b.topic)),
    recommendations: nextActions(l, masteries),
  };
}

// --- interview trends (A3) -------------------------------------------------------------------------

export async function getTrends(
  db: Database,
  userId: string,
  q: { type?: string; company?: string; persona?: string; includeAbandoned?: boolean },
  now: Date,
): Promise<TrendsResponse> {
  const l = await loadLearner(db, userId, now);
  const sessions: InterviewFact[] = l.interviews.filter(
    (s) =>
      (!q.type || s.type === q.type) &&
      (!q.persona || s.persona === q.persona) &&
      (!q.company || (s.company ?? "").toLowerCase() === q.company.toLowerCase()),
  );
  const t = interviewTrends(sessions, { includeAbandoned: q.includeAbandoned });
  return { ...t, sessions: sessions.length };
}

// --- time analysis (A5) ----------------------------------------------------------------------------

export async function getTimeAnalytics(
  db: Database,
  userId: string,
  difficulty: string | undefined,
  now: Date,
): Promise<TimeAnalyticsResponse> {
  const l = await loadLearner(db, userId, now);
  const solved = l.rows.filter(
    (r) =>
      r.solved && l.solveSeconds.has(r.problem_id) && (!difficulty || r.difficulty === difficulty),
  );
  const samples = solved.map((r) => ({
    difficulty: r.difficulty,
    seconds: l.solveSeconds.get(r.problem_id)!,
  }));
  const debugShares = solved
    .map((r) => l.timings.get(r.problem_id)?.debugShare)
    .filter((x): x is number => typeof x === "number");
  const debug = debugShares.length
    ? debugShares.reduce((a, b) => a + b, 0) / debugShares.length
    : null;
  const slow = solved
    .map((r) => ({
      slug: r.slug,
      title: r.title,
      difficulty: r.difficulty,
      seconds: l.solveSeconds.get(r.problem_id)!,
      ratio: 1 / speedScore(r.difficulty, l.solveSeconds.get(r.problem_id)!),
    }))
    .sort((a, b) => b.ratio - a.ratio || a.slug.localeCompare(b.slug));
  const slowCount = slow.filter((s) => s.ratio >= 2).length;
  const phases =
    debug === null
      ? null
      : { think: round2(1 - debug), debug: round2(debug), solves: debugShares.length };
  return {
    summaries: summarizeTimes(samples),
    phases,
    slowest: slow.slice(0, 5).map(({ ratio: _ratio, ...rest }) => rest),
    coaching: speedCoaching(phases, slowCount),
    note: "Estimated from when you opened, ran and submitted each problem. A gap longer than 20 minutes counts as a break. It is not a keystroke measurement.",
  };
}

// --- readiness (A4) --------------------------------------------------------------------------------

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function sessionScore(l: Learner, types: string[], last = 5) {
  const items = l.interviews
    .filter((s) => types.includes(s.type) && s.overall !== null && s.completion >= 0.3)
    .slice(-last);
  if (items.length === 0) return { score: null, confidence: 0 };
  let w = 0;
  let sum = 0;
  for (const s of items) {
    const r = recency(l, s.endedAt);
    w += r;
    sum += r * (s.overall! / 100);
  }
  return { score: sum / w, confidence: clamp01(items.length / 3) };
}

export function readinessInputs(
  l: Learner,
  masteries: TopicMastery[],
  importance: (t: string) => number,
) {
  const totalImp = masteries.reduce((a, m) => a + importance(m.topic), 0);
  const anyAttempt = masteries.some((m) => m.attempted > 0);
  const breadth =
    !anyAttempt || totalImp === 0
      ? { score: null, confidence: 0 }
      : {
          score: masteries.reduce((a, m) => a + importance(m.topic) * m.mastery, 0) / totalImp,
          confidence:
            masteries.reduce((a, m) => a + importance(m.topic) * m.confidence, 0) / totalImp,
        };
  const topicGaps: TopicGap[] = masteries.map((m) => ({
    topic: m.topic,
    name: topicName(l)(m.topic),
    mastery: m.mastery,
    share: totalImp === 0 ? 0 : importance(m.topic) / totalImp,
  }));

  const solvedRows = l.rows.filter((r) => r.solved);
  let speed: { score: number | null; confidence: number } = { score: null, confidence: 0 };
  if (solvedRows.length > 0) {
    const independent = solvedRows.filter((r) => !r.hinted).length / solvedRows.length;
    const timed = solvedRows.filter((r) => l.solveSeconds.has(r.problem_id));
    const s = timed.length
      ? timed.reduce((a, r) => a + speedScore(r.difficulty, l.solveSeconds.get(r.problem_id)!), 0) /
        timed.length
      : null;
    speed = {
      score: s === null ? independent : 0.6 * s + 0.4 * independent,
      confidence: clamp01(solvedRows.length / 8),
    };
  }

  const comm = l.interviews
    .filter((s) => s.dimensions.communication !== undefined && s.completion >= 0.3)
    .slice(-8);
  const communication =
    comm.length === 0
      ? { score: null, confidence: 0 }
      : {
          score: clamp01(
            comm.reduce((a, s) => a + (s.dimensions.communication! - 1) / 4, 0) / comm.length,
          ),
          confidence: clamp01(comm.length / 3),
        };

  const consistency =
    l.firstActivityDay === null
      ? { score: null, confidence: 0 }
      : {
          score: clamp01(l.activeDays14 / 10),
          confidence: clamp01((daysBetween(l.firstActivityDay, l.today) + 1) / 14),
        };

  const inputs: ComponentInputs = {
    dsa_breadth: breadth,
    dsa_speed: speed,
    interview: sessionScore(l, ["dsa"]),
    communication,
    cs: sessionScore(l, ["cs"]),
    project: sessionScore(l, ["project", "resume"]),
    aptitude: { score: null, confidence: 0 },
    design: sessionScore(l, ["hld", "lld"]),
    consistency,
  };
  return { inputs, topicGaps };
}

export async function getReadiness(
  db: Database,
  userId: string,
  target: string | undefined,
  now: Date,
): Promise<ReadinessDto> {
  const t = await resolveTarget(db, userId, target);
  const l = await loadLearner(db, userId, now);
  const importance = importanceFor(t.pack);
  const masteries = masteriesFor(l, importance);
  const { inputs, topicGaps } = readinessInputs(l, masteries, importance);
  const since = addDays(l.today, -30);
  const history = (
    await db
      .select({ date: readinessSnapshots.snapDate, score: readinessSnapshots.score })
      .from(readinessSnapshots)
      .where(
        and(
          eq(readinessSnapshots.userId, userId),
          eq(readinessSnapshots.targetKey, t.key),
          gte(readinessSnapshots.snapDate, since),
        ),
      )
  )
    .filter((h) => h.score !== null)
    .map((h) => ({ date: h.date, score: Number(h.score) }));

  const r = computeReadiness(inputs, {
    topicGaps,
    history,
    today: l.today,
    placementDate: l.profile.placementDate,
  });

  // one snapshot per local day, refreshed whenever the number is looked at
  await db
    .insert(readinessSnapshots)
    .values({
      userId,
      targetKey: t.key,
      snapDate: l.today,
      score: r.score === null ? null : String(r.score),
      band: r.band === null ? null : String(r.band),
      components: r.components,
    })
    .onConflictDoUpdate({
      target: [
        readinessSnapshots.userId,
        readinessSnapshots.targetKey,
        readinessSnapshots.snapDate,
      ],
      set: {
        score: r.score === null ? null : String(r.score),
        band: r.band === null ? null : String(r.band),
        components: r.components,
      },
    });

  return {
    target: t.key,
    targetTitle: t.title,
    score: r.score,
    band: r.band,
    label: r.label,
    coverage: r.coverage,
    components: r.components,
    limiting: r.limiting,
    levers: r.levers,
    eta: r.eta,
    placementDate: l.profile.placementDate,
    needsDiagnostic: r.score === null,
    note: "Readiness is an estimate from your practice on this platform. It moves as evidence grows, and the band shows how sure it is.",
  };
}

/** The daily snapshot without the full report (the nightly job). */
export async function snapshotReadiness(
  db: Database,
  userId: string,
  target: string | null,
  now: Date,
) {
  await getReadiness(db, userId, target ?? undefined, now);
}

export async function getReadinessHistory(
  db: Database,
  userId: string,
  target: string | undefined,
  now: Date,
): Promise<ReadinessHistoryResponse> {
  const t = await resolveTarget(db, userId, target);
  const rows = await db
    .select({
      date: readinessSnapshots.snapDate,
      score: readinessSnapshots.score,
      band: readinessSnapshots.band,
    })
    .from(readinessSnapshots)
    .where(and(eq(readinessSnapshots.userId, userId), eq(readinessSnapshots.targetKey, t.key)))
    .orderBy(desc(readinessSnapshots.snapDate))
    .limit(180);
  void now;
  return {
    target: t.key,
    items: rows.reverse().map((r) => ({
      date: r.date,
      score: r.score === null ? null : Number(r.score),
      band: r.band === null ? null : Number(r.band),
    })),
  };
}

// --- diagnostic (A4 calibration) ---------------------------------------------------------------------

const DIAGNOSTIC_SLOTS = ["easy", "easy", "medium", "medium", "hard"] as const;

async function diagnosticDto(
  db: Database,
  row: typeof diagnostics.$inferSelect,
  userId: string,
): Promise<DiagnosticDto> {
  const slugs = row.problemSlugs as string[];
  const states = (
    await db.execute(sql`
      SELECT p.slug, p.title, p.difficulty, COALESCE(ups.status, 'unseen') AS status, COALESCE(ups.attempts, 0)::int AS attempts
      FROM problems p LEFT JOIN user_problem_state ups ON ups.problem_id = p.id AND ups.user_id = ${userId}
      WHERE p.slug IN (${sql.join(
        slugs.map((s) => sql`${s}`),
        sql`, `,
      )})`)
  ).rows as unknown as Array<{
    slug: string;
    title: string;
    difficulty: "easy" | "medium" | "hard";
    status: string;
    attempts: number;
  }>;
  const tagRows = (
    await db.execute(sql`
      SELECT p.slug, t.slug AS topic FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id AND t.kind = 'topic'
      JOIN problems p ON p.id = pt.problem_id
      WHERE p.slug IN (${sql.join(
        slugs.map((s) => sql`${s}`),
        sql`, `,
      )})`)
  ).rows as unknown as Array<{ slug: string; topic: string }>;
  const problems = slugs.flatMap((slug) => {
    const s = states.find((x) => x.slug === slug);
    if (!s) return [];
    return [
      {
        slug,
        title: s.title,
        difficulty: s.difficulty,
        topic: tagRows.find((t) => t.slug === slug)?.topic ?? "",
        status: (s.status === "solved" ? "solved" : s.attempts > 0 ? "attempted" : "todo") as
          "solved" | "attempted" | "todo",
      },
    ];
  });
  const answered = problems.filter((p) => p.status !== "todo").length;
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    problems,
    answered,
    total: problems.length,
  };
}

/** Starts (or returns the open) diagnostic: five problems across topics and difficulties. */
export async function startDiagnostic(
  db: Database,
  userId: string,
  now: Date,
): Promise<DiagnosticDto> {
  const [open] = await db
    .select()
    .from(diagnostics)
    .where(and(eq(diagnostics.userId, userId), sql`${diagnostics.completedAt} IS NULL`))
    .orderBy(desc(diagnostics.startedAt))
    .limit(1);
  if (open) return refreshDiagnostic(db, userId, open);

  const l = await loadLearner(db, userId, now);
  const topics = [...l.topicList].sort(
    (a, b) =>
      (TOPIC_ORDER.indexOf(a) === -1 ? 99 : TOPIC_ORDER.indexOf(a)) -
        (TOPIC_ORDER.indexOf(b) === -1 ? 99 : TOPIC_ORDER.indexOf(b)) || a.localeCompare(b),
  );
  const chosen: string[] = [];
  const pool = l.rows.filter((r) => !r.solved);
  DIAGNOSTIC_SLOTS.forEach((diff, i) => {
    const ofTopic = (t: string) =>
      pool.filter(
        (r) => (l.topics.get(r.problem_id) ?? []).includes(t) && !chosen.includes(r.slug),
      );
    for (let k = 0; k < topics.length && chosen.length <= i; k++) {
      const t = topics[(i + k) % topics.length]!;
      const c = ofTopic(t).find((r) => r.difficulty === diff) ?? ofTopic(t)[0];
      if (c) chosen.push(c.slug);
    }
  });
  if (chosen.length === 0) {
    throw new AppError(
      "NOT_FOUND",
      404,
      "There are no unsolved problems to build a diagnostic from",
    );
  }
  const [row] = await db
    .insert(diagnostics)
    .values({ id: newId(), userId, problemSlugs: chosen, startedAt: now })
    .returning();
  return diagnosticDto(db, row!, userId);
}

async function refreshDiagnostic(
  db: Database,
  userId: string,
  row: typeof diagnostics.$inferSelect,
) {
  const dto = await diagnosticDto(db, row, userId);
  if (!row.completedAt && dto.total > 0 && dto.answered === dto.total) {
    const [done] = await db
      .update(diagnostics)
      .set({ completedAt: new Date() })
      .where(eq(diagnostics.id, row.id))
      .returning();
    return diagnosticDto(db, done!, userId);
  }
  return dto;
}

export async function getDiagnostic(
  db: Database,
  userId: string,
  id: string,
): Promise<DiagnosticDto> {
  const [row] = await db
    .select()
    .from(diagnostics)
    .where(and(eq(diagnostics.id, id), eq(diagnostics.userId, userId)));
  if (!row) throw new AppError("NOT_FOUND", 404, "That diagnostic doesn't exist");
  return refreshDiagnostic(db, userId, row);
}
