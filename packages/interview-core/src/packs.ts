// Company packs (doc 03 I2, doc 17 section 6): a curated or provisional interview style that shapes the
// plan. Pure functions; the API loads packs from the database and applies them here. Packs describe
// practice styles inspired by public patterns, never an official process.

export type HintPolicy = "sparse" | "balanced" | "generous";

export interface PackStyle {
  slug: string;
  title: string;
  level: string;
  topic_weights: Record<string, number>;
  difficulty_band: { easy: number; medium: number; hard: number };
  interview_style: {
    bar: string;
    follow_up_depth: number;
    hint_policy: HintPolicy;
    behavioral_weight: number;
    notes: string;
  };
  rubric_weights: Record<string, number>;
  behavioral_competencies: string[];
  cs_topics?: string[];
  checklist?: string[];
  pitfalls?: string[];
  disclaimer?: string;
}

const HINT_CAP: Record<HintPolicy, number> = { sparse: 1, balanced: 2, generous: 3 };

/** A pack's hint policy caps what the user asked for (a sparse company gives at most one hint). */
export function hintBudgetFor(requested: number, pack: PackStyle | null): number {
  if (!pack) return requested;
  return Math.min(requested, HINT_CAP[pack.interview_style.hint_policy]);
}

/** Overall level 1-5 implied by the pack's difficulty band (share of hard problems pulls it up). */
export function levelFromBand(band: PackStyle["difficulty_band"]): number {
  const v = 1 * band.easy + 3 * band.medium + 5 * band.hard;
  return Math.min(5, Math.max(1, Math.ceil(v - 1e-9)));
}

/** The level to plan at: a pack with a high bar nudges the user's choice up by one step, never down. */
export function planLevel(userLevel: number, pack: PackStyle | null): number {
  if (!pack) return userLevel;
  const target = levelFromBand(pack.difficulty_band);
  const delta = Math.max(0, Math.min(1, target - userLevel));
  return Math.min(5, Math.max(1, userLevel + delta));
}

/** Follow-up depth for the prompt: how many probing rounds the style expects. */
export function followUpDepth(pack: PackStyle | null): number {
  return pack?.interview_style.follow_up_depth ?? 2;
}

/** What the pack changes, in plain words, for the plan preview (doc 03 I2: the change must be visible). */
export function describePack(pack: PackStyle, type: string): string[] {
  const out: string[] = [];
  const top = Object.entries(pack.topic_weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k);
  if (type === "dsa") {
    out.push(`Problems lean toward ${top.join(", ")}.`);
    const b = pack.difficulty_band;
    out.push(
      `Difficulty mix about ${Math.round(b.easy * 100)}% easy, ${Math.round(b.medium * 100)}% medium, ${Math.round(b.hard * 100)}% hard.`,
    );
    out.push(
      `Hints: ${pack.interview_style.hint_policy} (at most ${HINT_CAP[pack.interview_style.hint_policy]}).`,
    );
  }
  if (type === "behavioral") {
    out.push(`Competencies: ${pack.behavioral_competencies.join(", ")}.`);
  }
  if (type === "cs" && pack.cs_topics?.length) {
    out.push(`Fundamentals: ${pack.cs_topics.join(", ")}.`);
  }
  const heavy = Object.entries(pack.rubric_weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${Math.round(v * 100)}%`);
  out.push(`The scorecard weighs ${heavy.join(" and ")} most.`);
  out.push(
    `Follow-up depth ${pack.interview_style.follow_up_depth} of 5. ${pack.interview_style.notes}`,
  );
  return out;
}

/** Pack pitfalls worth showing before the interview starts. */
export function packWarnings(pack: PackStyle): string[] {
  return (pack.pitfalls ?? []).slice(0, 3);
}
