import type { ProblemQuestion } from "./types.js";

// Question selection and adaptive difficulty (doc 13 §7-8). Pure: the caller injects the random source.

export type Tier = "easy" | "medium" | "hard";

/** Overall level 1-5 mapped to problem tiers, most wanted first. */
export function tiersForLevel(level: number): Tier[] {
  switch (Math.round(Math.min(5, Math.max(1, level)))) {
    case 1:
      return ["easy"];
    case 2:
      return ["easy", "medium"];
    case 3:
      return ["medium", "easy"];
    case 4:
      return ["medium", "hard"];
    default:
      return ["hard", "medium"];
  }
}

export interface Candidate {
  problemId: string;
  slug: string;
  title: string;
  difficulty: Tier;
  tags: string[];
}

export interface PickOptions {
  count: number;
  level: number;
  /** Slugs asked recently (question memory): excluded unless nothing else is left. */
  recentSlugs?: ReadonlySet<string>;
  /** Slugs the user has already solved cleanly: de-prioritised. */
  solvedCleanSlugs?: ReadonlySet<string>;
  /** Topics to favour (weak areas). */
  weakTags?: ReadonlySet<string>;
  /** Random source in [0, 1); injected for determinism. */
  random: () => number;
  /** Share of picks that ignore the weak-topic preference. */
  exploration?: number;
}

/** Picks distinct problems for the interview, preferring the level's tiers, weak topics and unseen problems. */
export function pickProblems(pool: readonly Candidate[], opts: PickOptions): Candidate[] {
  const picked: Candidate[] = [];
  const tiers = tiersForLevel(opts.level);
  const exploration = opts.exploration ?? 0.3;
  const remaining = [...pool];

  for (let n = 0; n < opts.count && remaining.length > 0; n++) {
    // the second pick is a step harder than the first when the level allows it
    const wanted = n === 0 ? tiers : [...tiers].reverse();
    const score = (c: Candidate): number => {
      let s = 0;
      const rank = wanted.indexOf(c.difficulty);
      s += rank === -1 ? 0 : 30 - rank * 10;
      if (opts.recentSlugs?.has(c.slug)) s -= 100;
      if (opts.solvedCleanSlugs?.has(c.slug)) s -= 25;
      if (opts.weakTags && opts.random() >= exploration) {
        s += c.tags.filter((t) => opts.weakTags?.has(t)).length * 6;
      }
      return s + opts.random(); // tie-break
    };
    let best = 0;
    let bestScore = -Infinity;
    remaining.forEach((c, i) => {
      const sc = score(c);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    });
    const [chosen] = remaining.splice(best, 1);
    if (chosen) picked.push(chosen);
  }
  return picked;
}

export function toProblemQuestion(c: Candidate, segmentKey: string): ProblemQuestion {
  return {
    kind: "problem",
    problemId: c.problemId,
    slug: c.slug,
    title: c.title,
    difficulty: c.difficulty,
    tags: c.tags,
    segmentKey,
  };
}

/** Outcome of one question on [0, 1]: correctness, hints and time (doc 13 §8). */
export function questionScore(o: {
  solved: boolean;
  hintsUsed: number;
  usedMs: number;
  budgetMs: number;
}): number {
  const base = o.solved ? 0.7 : 0.2;
  const hintPenalty = Math.min(0.3, o.hintsUsed * 0.1);
  const timeBonus = o.solved
    ? Math.max(0, Math.min(0.3, 0.3 * (1 - o.usedMs / Math.max(1, o.budgetMs))))
    : 0;
  return Math.max(0, Math.min(1, base - hintPenalty + timeBonus));
}

/** `d + 0.5 * (s - 0.6) * k`, clamped to the user's range (k = 2). */
export function nextDifficulty(d: number, s: number, range: { min: number; max: number }, k = 2) {
  const next = d + 0.5 * (s - 0.6) * k;
  return Math.max(range.min, Math.min(range.max, next));
}
