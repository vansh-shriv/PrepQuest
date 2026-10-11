import type { SpokenQuestion, VerbalQuestion } from "./types.js";

// Selection of questions from the bank (doc 13 section 7): variety by topic and competency, a cooldown
// on recently asked questions, semantic de-duplication, and weak questions that come back as a spiral.

export interface BankCandidate {
  slug: string;
  category: "cs" | "behavioral" | "hld" | "lld";
  topic: string;
  competency: string | null;
  difficulty: number;
  text: string;
  referenceAnswer: string | null;
  followups: string[];
  rubricPoints: string[];
}

export interface VerbalPickOptions {
  count: number;
  /** Overall level 1-5: questions near it are preferred. */
  level: number;
  /** Slugs asked inside the cooldown window. */
  recentSlugs?: ReadonlySet<string>;
  /** Slugs the user struggled with: some come back (spiral curriculum). */
  weakSlugs?: ReadonlySet<string>;
  /** Share of the picks that may be weak questions coming back. */
  retryWeakShare?: number;
  /** Topics (CS) or competencies (behavioural) to draw from, empty for any. */
  allowedTopics?: readonly string[];
  /** Competencies asked in the last few sessions: avoided when others are available. */
  recentCompetencies?: ReadonlySet<string>;
  /** True when the question is too similar to something the user was asked recently. */
  isSemanticDuplicate?: (c: BankCandidate) => boolean;
  /** Random source in [0, 1). */
  random: () => number;
}

/** Cosine similarity of two vectors (0 when either has no length). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Near-duplicates (a paraphrase of something asked recently) are at or above this similarity. */
export const DUPLICATE_SIMILARITY = 0.8;

export function pickVerbal(pool: readonly BankCandidate[], o: VerbalPickOptions): BankCandidate[] {
  const picked: BankCandidate[] = [];
  const remaining = pool.filter(
    (c) => !o.allowedTopics?.length || o.allowedTopics.includes(c.competency ?? c.topic),
  );
  const usedTopics = new Set<string>();
  const retryShare = o.retryWeakShare ?? 0.25;

  for (let n = 0; n < o.count && remaining.length > 0; n++) {
    const wantWeak = o.weakSlugs && o.weakSlugs.size > 0 && o.random() < retryShare;
    let best = -1;
    let bestScore = -Infinity;
    remaining.forEach((c, i) => {
      let s = 0;
      const key = c.competency ?? c.topic;
      if (o.recentSlugs?.has(c.slug)) s -= 100;
      if (o.isSemanticDuplicate?.(c)) s -= 80;
      if (usedTopics.has(key)) s -= 25; // variety inside the interview
      if (o.recentCompetencies?.has(key)) s -= 12; // and across the last sessions
      if (o.weakSlugs?.has(c.slug)) s += wantWeak ? 120 : -5;
      s -= Math.abs(c.difficulty - o.level) * 4;
      const total = s + o.random() * 3; // a little noise so equal candidates vary between sessions
      if (total > bestScore) {
        bestScore = total;
        best = i;
      }
    });
    const [chosen] = remaining.splice(best, 1);
    if (!chosen) break;
    picked.push(chosen);
    usedTopics.add(chosen.competency ?? chosen.topic);
  }
  return picked;
}

export function toVerbalQuestion(c: BankCandidate, segmentKey: string): VerbalQuestion {
  return {
    kind: "verbal",
    id: c.slug,
    question: c.text,
    sourceRef: `bank:${c.slug}`,
    category: c.category,
    topic: c.topic,
    competency: c.competency,
    followups: c.followups,
    rubricPoints: c.rubricPoints,
    reference: c.referenceAnswer ?? "",
    difficulty: c.difficulty,
    segmentKey,
  };
}

/** Short lines the interviewer may use to refer back to earlier sessions (X5). At most two. */
export function callbackLines(
  history: readonly {
    questionText: string;
    weak: boolean;
    daysAgo: number;
    topic: string | null;
  }[],
): string[] {
  return history
    .filter((h) => h.weak && h.daysAgo <= 90)
    .slice(0, 2)
    .map((h) => {
      const when = h.daysAgo <= 1 ? "last time" : h.daysAgo < 14 ? "recently" : "a while ago";
      const what = h.topic
        ? `the topic of ${h.topic}`
        : `this question: "${h.questionText.slice(0, 120)}"`;
      return `You struggled with ${what} ${when}. If it comes up naturally, you may revisit it.`;
    });
}

export const isVerbal = (q: SpokenQuestion): q is VerbalQuestion => q.kind === "verbal";
