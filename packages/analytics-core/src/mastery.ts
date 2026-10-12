// Weak-area detection (doc 04 A2). The signals that exist are used: solve success, speed, hint
// independence and interview scores. Each signal carries its doc weight and the weights are renormalised
// over the signals that have evidence, so a topic with only solves scores exactly as it did in v1.
// Quiz and SRS signals join the same formula when those features land.

import { speedScore } from "./timing.js";
import type { DifficultyName } from "./xp.js";

export interface ProblemEvidence {
  slug: string;
  difficulty: DifficultyName;
  topics: string[];
  patterns: string[];
  /** At least one real (non-infrastructure-error) submission. */
  attempted: boolean;
  solved: boolean;
  /** The first submission for the problem was accepted. */
  firstTry: boolean;
  /** Hints were viewed before solving (or the user gave up). */
  hinted: boolean;
  lastAt: Date | null;
  /** Estimated active seconds to the first accept (A5); null when unknown. */
  solveSeconds?: number | null;
  verdicts: { WA: number; TLE: number; RE: number; MLE: number; CE: number };
}

export type PlantStage = "seed" | "sprout" | "bud" | "bloom";

export interface TopicMastery {
  topic: string;
  /** 0 to 1. */
  mastery: number;
  /** 0 to 1: how much evidence backs `mastery` (8 attempted problems = full confidence). */
  confidence: number;
  weakness: number;
  stage: PlantStage;
  attempted: number;
  solved: number;
  diagnosis: string | null;
  /** Which signals fed `mastery` (for the breakdown view). */
  signals?: {
    solve: number;
    speed: number | null;
    independence: number;
    interview: number | null;
    /** How well solved problems of this topic are remembered in spaced-repetition reviews. */
    retention: number | null;
  };
}

/** Interview evidence for a topic: mean score 0 to 1 over `n` sessions (recency weighted by the caller). */
export type InterviewSignal = Record<string, { score: number; n: number }>;

/** Review evidence for a topic: mean review quality 0 to 1 over `n` reviews (spaced repetition, D6). */
export type RetentionSignal = Record<string, { score: number; n: number }>;

export const SIGNAL_WEIGHTS = {
  solve: 0.3,
  speed: 0.2,
  independence: 0.15,
  interview: 0.1,
  retention: 0.1,
} as const;

const HALF_LIFE_DAYS = 30;
const FULL_CONFIDENCE = 8;
/** Mastery below this is reported as a weak area. */
export const WEAK_BELOW = 0.75;

export const stageFor = (mastery: number, attempted: number): PlantStage =>
  attempted === 0 || mastery < 0.25
    ? "seed"
    : mastery < 0.5
      ? "sprout"
      : mastery < 0.75
        ? "bud"
        : "bloom";

const weightOf = (lastAt: Date | null, now: Date) =>
  lastAt
    ? Math.pow(0.5, Math.max(0, now.getTime() - lastAt.getTime()) / 86_400_000 / HALF_LIFE_DAYS)
    : 1;

function diagnose(topic: string, rows: ProblemEvidence[]): string | null {
  const total = { WA: 0, TLE: 0, RE: 0, MLE: 0, CE: 0 };
  for (const r of rows)
    for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += r.verdicts[k];
  const name = topic.replace(/-/g, " ");
  const failures = total.WA + total.TLE + total.RE + total.MLE;
  const hinted = rows.filter((r) => r.hinted).length;
  if (failures >= 2 && total.TLE >= total.WA && total.TLE >= 2) {
    return `Many ${name} attempts run out of time: look for a better algorithm or data structure before coding.`;
  }
  if (failures >= 2 && total.WA > total.TLE && total.WA >= total.RE) {
    return `Your ${name} solutions often give wrong answers: write down edge cases (empty, one element, duplicates) first.`;
  }
  if (total.RE >= 2)
    return `${name} attempts crash at runtime: check index bounds and empty inputs.`;
  if (rows.length > 0 && hinted / rows.length >= 0.5) {
    return `You lean on hints for ${name}: try a tier-1 nudge only, then re-read the statement.`;
  }
  return null;
}

/** Mastery, confidence, weakness and plant stage for every topic in `topics` (topics without evidence stay seeds). */
export function topicMastery(
  evidence: readonly ProblemEvidence[],
  topics: readonly string[],
  now: Date,
  importance: (topic: string) => number = () => 1,
  interview: InterviewSignal = {},
  retention: RetentionSignal = {},
): TopicMastery[] {
  return topics.map((topic) => {
    const rows = evidence.filter((e) => e.attempted && e.topics.includes(topic));
    if (rows.length === 0) {
      return {
        topic,
        mastery: 0,
        confidence: 0,
        weakness: 0,
        stage: "seed",
        attempted: 0,
        solved: 0,
        diagnosis: null,
      };
    }
    let wSum = 0;
    let success = 0;
    let independent = 0;
    let speedW = 0;
    let speed = 0;
    for (const r of rows) {
      const w = weightOf(r.lastAt, now);
      wSum += w;
      success += w * (r.solved ? (r.firstTry ? 1 : 0.6) : 0);
      independent += w * (r.solved && !r.hinted ? 1 : 0); // credit only solves made without help
      if (r.solved && r.solveSeconds != null) {
        speedW += w;
        speed += w * speedScore(r.difficulty, r.solveSeconds);
      }
    }
    const signals = {
      solve: success / wSum,
      speed: speedW > 0 ? speed / speedW : null,
      independence: independent / wSum,
      interview: interview[topic] && interview[topic]!.n > 0 ? interview[topic]!.score : null,
      retention: retention[topic] && retention[topic]!.n > 0 ? retention[topic]!.score : null,
    };
    let num =
      SIGNAL_WEIGHTS.solve * signals.solve + SIGNAL_WEIGHTS.independence * signals.independence;
    let den = SIGNAL_WEIGHTS.solve + SIGNAL_WEIGHTS.independence;
    if (signals.speed !== null) {
      num += SIGNAL_WEIGHTS.speed * signals.speed;
      den += SIGNAL_WEIGHTS.speed;
    }
    if (signals.interview !== null) {
      num += SIGNAL_WEIGHTS.interview * signals.interview;
      den += SIGNAL_WEIGHTS.interview;
    }
    if (signals.retention !== null) {
      num += SIGNAL_WEIGHTS.retention * signals.retention;
      den += SIGNAL_WEIGHTS.retention;
    }
    const mastery = num / den;
    const evidenceCount = rows.length + (interview[topic]?.n ?? 0);
    const confidence = Math.min(1, evidenceCount / FULL_CONFIDENCE);
    return {
      topic,
      mastery,
      confidence,
      weakness: (1 - mastery) * importance(topic) * (0.5 + 0.5 * confidence),
      stage: stageFor(mastery, rows.length),
      attempted: rows.length,
      solved: rows.filter((r) => r.solved).length,
      diagnosis: mastery < WEAK_BELOW ? diagnose(topic, rows) : null,
      signals,
    };
  });
}

/** Attempted topics below the mastery bar, weakest first. */
export const weakAreas = (masteries: readonly TopicMastery[]): TopicMastery[] =>
  masteries
    .filter((m) => m.attempted > 0 && m.mastery < WEAK_BELOW)
    .sort((a, b) => b.weakness - a.weakness || a.topic.localeCompare(b.topic));

export interface Candidate {
  slug: string;
  title: string;
  difficulty: DifficultyName;
  topics: string[];
  patterns: string[];
  solved: boolean;
}

export interface Recommendation {
  slug: string;
  title: string;
  topic: string;
  difficulty: DifficultyName;
  reason: string;
}

const LADDER: DifficultyName[] = ["easy", "medium", "hard"];
const idealDifficulty = (mastery: number): number => (mastery < 0.4 ? 0 : mastery < 0.75 ? 1 : 2);

/**
 * Up to `count` unsolved problems, just above the user's level in their weakest topics, each from a
 * different pattern. With no evidence yet it starts the user on the first topics in `topics` at easy.
 */
export function recommendNext(
  masteries: readonly TopicMastery[],
  candidates: readonly Candidate[],
  count = 3,
): Recommendation[] {
  const weak = weakAreas(masteries);
  const fresh = masteries.filter((m) => m.attempted === 0);
  // weak topics first, then topics never tried, then topics that are already strong (to stay challenged)
  const order = [
    ...weak,
    ...fresh,
    ...masteries.filter((m) => m.attempted > 0 && m.mastery >= WEAK_BELOW),
  ];
  const picked: Recommendation[] = [];
  const usedPatterns = new Set<string>();
  const usedSlugs = new Set<string>();

  for (const round of [0, 1]) {
    for (const m of order) {
      if (picked.length >= count) return picked;
      if (round === 0 && picked.some((p) => p.topic === m.topic)) continue;
      const ideal = m.attempted === 0 ? 0 : idealDifficulty(m.mastery);
      const pool = candidates
        .filter((c) => !c.solved && !usedSlugs.has(c.slug) && c.topics.includes(m.topic))
        .filter((c) => round === 1 || !c.patterns.some((p) => usedPatterns.has(p)))
        .sort(
          (a, b) =>
            Math.abs(LADDER.indexOf(a.difficulty) - ideal) -
              Math.abs(LADDER.indexOf(b.difficulty) - ideal) || a.slug.localeCompare(b.slug),
        );
      const best = pool[0];
      if (!best) continue;
      usedSlugs.add(best.slug);
      for (const p of best.patterns) usedPatterns.add(p);
      picked.push({
        slug: best.slug,
        title: best.title,
        topic: m.topic,
        difficulty: best.difficulty,
        reason:
          m.attempted === 0
            ? `New topic: ${m.topic.replace(/-/g, " ")}`
            : m.mastery < WEAK_BELOW
              ? `Build up ${m.topic.replace(/-/g, " ")} (${Math.round(m.mastery * 100)}% so far)`
              : `Keep ${m.topic.replace(/-/g, " ")} sharp`,
      });
    }
  }
  return picked;
}
