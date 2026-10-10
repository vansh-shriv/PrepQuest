// Weak-area detection v1 (doc 04 A2). Only the signals that exist today are used (solve success and hint
// independence); quiz, interview, speed and SRS signals join the same formula when those features land.

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
}

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
    for (const r of rows) {
      const w = weightOf(r.lastAt, now);
      wSum += w;
      success += w * (r.solved ? (r.firstTry ? 1 : 0.6) : 0);
      independent += w * (r.solved && !r.hinted ? 1 : 0); // credit only solves made without help
    }
    // weights 0.30 and 0.15 renormalised over the two signals available today
    const mastery = (2 * (success / wSum) + independent / wSum) / 3;
    const confidence = Math.min(1, rows.length / FULL_CONFIDENCE);
    return {
      topic,
      mastery,
      confidence,
      weakness: (1 - mastery) * importance(topic) * (0.5 + 0.5 * confidence),
      stage: stageFor(mastery, rows.length),
      attempted: rows.length,
      solved: rows.filter((r) => r.solved).length,
      diagnosis: mastery < WEAK_BELOW ? diagnose(topic, rows) : null,
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
