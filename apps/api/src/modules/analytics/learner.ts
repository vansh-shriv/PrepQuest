import { eq, sql } from "drizzle-orm";
import { companyPacks, profiles, type Database } from "@prepquest/db";
import {
  addDays,
  localDay,
  solveTiming,
  topicMastery,
  type InterviewSignal,
  type ProblemEvidence,
  type SolveTiming,
  type TimedEvent,
  type TopicMastery,
  type TrendSession,
} from "@prepquest/analytics-core";
import type { PackStyle } from "@prepquest/interview-core";
import { loadEvidence, type EvidenceRow } from "../progress/service.js";

// Everything the analytics, readiness and planning features need to know about one learner, loaded once.

export type ProfileRow = typeof profiles.$inferSelect;

export interface InterviewFact extends TrendSession {
  endedAt: Date;
  /** Topics of the coding problems asked in the session (empty for non-coding rounds). */
  topics: string[];
}

export interface Learner {
  userId: string;
  profile: ProfileRow;
  now: Date;
  today: string;
  rows: EvidenceRow[];
  topics: Map<string, string[]>;
  patterns: Map<string, string[]>;
  names: Map<string, string>;
  topicList: string[];
  /** Estimated active seconds to the first accept, per problem id. */
  solveSeconds: Map<string, number>;
  /** Full timing of every problem that has events, by problem id. */
  timings: Map<string, SolveTiming>;
  evidence: ProblemEvidence[];
  interviews: InterviewFact[];
  interviewSignal: InterviewSignal;
  /** Days with any practice in the last 14, ending today. */
  activeDays14: number;
  firstActivityDay: string | null;
}

export const titleCase = (slug: string) =>
  slug
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");

/** Topic importance for a target: 1 for no target, otherwise 0.5 (not in the pack) to 1.5 (the pack's top topic). */
export function importanceFor(pack: PackStyle | null): (topic: string) => number {
  if (!pack) return () => 1;
  const weights = pack.topic_weights ?? {};
  const max = Math.max(0, ...Object.values(weights));
  if (max <= 0) return () => 1;
  return (topic) => 0.5 + (weights[topic] ?? 0) / max;
}

export async function loadPack(db: Database, userId: string, slug: string | null) {
  if (!slug || slug === "general") return null;
  const [row] = await db.select().from(companyPacks).where(eq(companyPacks.slug, slug));
  if (!row || row.status !== "published") return null;
  if (row.provisional && row.createdBy !== userId) return null;
  return row;
}

export async function loadLearner(db: Database, userId: string, now: Date): Promise<Learner> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!profile) throw new Error("profile missing");
  const today = localDay(now, profile.timezone);
  const { rows, topics, patterns, names } = await loadEvidence(db, userId);
  const topicList = [...new Set([...topics.values()].flat())].sort();

  // ---- time to solve, from the moments the problem was opened, run and submitted
  const events = (
    await db.execute(sql`
      SELECT s.problem_id, s.kind, s.verdict, s.created_at
      FROM submissions s
      WHERE s.user_id = ${userId} AND s.interview_session_id IS NULL AND s.mode = 'practice'
        AND s.kind IN ('run', 'submit')
      ORDER BY s.created_at`)
  ).rows as unknown as Array<{
    problem_id: string;
    kind: "run" | "submit";
    verdict: string;
    created_at: Date;
  }>;
  const opens = (
    await db.execute(sql`
      SELECT problem_id, first_seen_at FROM user_problem_state
      WHERE user_id = ${userId} AND first_seen_at IS NOT NULL`)
  ).rows as unknown as Array<{ problem_id: string; first_seen_at: Date }>;
  const byProblem = new Map<string, TimedEvent[]>();
  for (const o of opens)
    byProblem.set(o.problem_id, [{ at: new Date(o.first_seen_at), kind: "open" }]);
  for (const e of events) {
    const list = byProblem.get(e.problem_id) ?? [];
    list.push({ at: new Date(e.created_at), kind: e.kind, accepted: e.verdict === "AC" });
    byProblem.set(e.problem_id, list);
  }
  const solveSeconds = new Map<string, number>();
  const timings = new Map<string, SolveTiming>();
  for (const [problemId, list] of byProblem) {
    const t = solveTiming(list);
    timings.set(problemId, t);
    if (t.toFirstAc !== null) solveSeconds.set(problemId, t.toFirstAc);
  }

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
    solveSeconds: solveSeconds.get(r.problem_id) ?? null,
    verdicts: { WA: r.wa, TLE: r.tle, RE: r.re, MLE: r.mle, CE: r.ce },
  }));

  // ---- finished, scored interviews
  const slugTopics = new Map(rows.map((r) => [r.slug, topics.get(r.problem_id) ?? []]));
  const sessions = (
    await db.execute(sql`
      SELECT s.id, s.type, s.persona, s.difficulty, s.company_name, s.ended_at, s.plan,
        c.overall, c.red_flags, c.coverage,
        COALESCE((SELECT jsonb_object_agg(sc.dimension, sc.score) FROM scorecard_scores sc
          WHERE sc.scorecard_id = c.id AND sc.score IS NOT NULL), '{}'::jsonb) AS dims,
        sm.filler_per_min, sm.wpm
      FROM interview_sessions s
      JOIN interview_scorecards c ON c.session_id = s.id AND c.status = 'ready'
      LEFT JOIN speech_metrics sm ON sm.session_id = s.id
      WHERE s.user_id = ${userId} AND s.ended_at IS NOT NULL
      ORDER BY s.ended_at`)
  ).rows as unknown as Array<{
    id: string;
    type: string;
    persona: string;
    difficulty: number;
    company_name: string | null;
    ended_at: Date;
    plan: { questions?: Array<{ kind: string; slug?: string }> } | null;
    overall: number | null;
    red_flags: Array<{ category?: string }> | null;
    coverage: { session?: number } | null;
    dims: Record<string, number>;
    filler_per_min: string | null;
    wpm: string | null;
  }>;
  const interviews: InterviewFact[] = sessions.map((s) => ({
    id: s.id,
    at: new Date(s.ended_at).toISOString(),
    endedAt: new Date(s.ended_at),
    type: s.type,
    persona: s.persona,
    difficulty: s.difficulty,
    company: s.company_name,
    overall: s.overall,
    dimensions: s.dims ?? {},
    completion: s.coverage?.session ?? 1,
    redFlags: (s.red_flags ?? []).map((f) => `Recurring ${f.category ?? "process"} red flag`),
    fillerPerMin: s.filler_per_min === null ? null : Number(s.filler_per_min),
    wpm: s.wpm === null ? null : Number(s.wpm),
    topics: [
      ...new Set(
        (s.plan?.questions ?? []).flatMap((q) =>
          q.kind === "problem" && q.slug ? (slugTopics.get(q.slug) ?? []) : [],
        ),
      ),
    ],
  }));

  // coding interviews: a topic's interview score is the recency-weighted mean of the sessions that asked it
  const acc = new Map<string, { w: number; s: number; n: number }>();
  for (const i of interviews) {
    if (i.type !== "dsa" || i.overall === null || i.completion < 0.3) continue;
    const w = Math.pow(0.5, Math.max(0, now.getTime() - i.endedAt.getTime()) / 86_400_000 / 30);
    for (const t of i.topics) {
      const a = acc.get(t) ?? { w: 0, s: 0, n: 0 };
      a.w += w;
      a.s += w * (i.overall / 100);
      a.n += 1;
      acc.set(t, a);
    }
  }
  const interviewSignal: InterviewSignal = {};
  for (const [t, a] of acc) interviewSignal[t] = { score: a.w > 0 ? a.s / a.w : 0, n: a.n };

  // ---- consistency
  const from = addDays(today, -13);
  const act = (
    await db.execute(sql`
      SELECT count(*) FILTER (WHERE day >= ${from}::date AND day <= ${today}::date
               AND (problems + quizzes + interviews) > 0)::int AS active,
             to_char(min(day) FILTER (WHERE (problems + quizzes + interviews) > 0), 'YYYY-MM-DD') AS first_day
      FROM activity_days WHERE user_id = ${userId}`)
  ).rows[0] as { active: number; first_day: string | null };

  return {
    userId,
    profile,
    now,
    today,
    rows,
    topics,
    patterns,
    names,
    topicList,
    solveSeconds,
    timings,
    evidence,
    interviews,
    interviewSignal,
    activeDays14: act.active,
    firstActivityDay: act.first_day,
  };
}

export function masteriesFor(l: Learner, importance: (topic: string) => number): TopicMastery[] {
  return topicMastery(l.evidence, l.topicList, l.now, importance, l.interviewSignal);
}

export const topicName = (l: Learner) => (topic: string) => l.names.get(topic) ?? titleCase(topic);
