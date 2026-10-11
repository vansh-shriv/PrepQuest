import { z } from "zod";
import { bandFor, type Band, type Rubric } from "./rubrics.js";
import type { TranscriptTurn } from "./types.js";

// Scorecard validation and aggregation (doc 13 §5.7, doc 03 E1). The model drafts scores with
// evidence; code verifies the evidence, computes the overall score and maps it to a band.

const evidenceSchema = z.object({
  type: z.enum(["turn", "code"]),
  /** Turn sequence number, or a code event/submission reference. */
  ref: z.union([z.number().int(), z.string().max(80)]),
  quote: z.string().min(1).max(400),
});
export type Evidence = z.infer<typeof evidenceSchema>;

const dimensionDraftSchema = z.object({
  dimension: z.string().max(60),
  score: z.number().int().min(1).max(5).nullable(),
  justification: z.string().min(1).max(600),
  evidence: z.array(evidenceSchema).max(6).default([]),
});

export const RED_FLAG_CATEGORIES = [
  "technical",
  "process",
  "communication",
  "professionalism",
  "integrity",
] as const;

export const NEXT_ACTION_KINDS = [
  "problem",
  "topic",
  "quiz",
  "roadmap_node",
  "flashcards",
  "mock",
] as const;

export const scorecardDraftSchema = z.object({
  scores: z.array(dimensionDraftSchema).min(1).max(12),
  strengths: z
    .array(z.object({ text: z.string().min(1).max(300), evidence: z.array(evidenceSchema).max(4) }))
    .max(6),
  red_flags: z
    .array(
      z.object({
        category: z.enum(RED_FLAG_CATEGORIES),
        severity: z.enum(["low", "medium", "high"]),
        text: z.string().min(1).max(300),
        evidence: z.array(evidenceSchema).max(4),
        remedy: z.string().min(1).max(300),
      }),
    )
    .max(6),
  next_actions: z
    .array(
      z.object({
        kind: z.enum(NEXT_ACTION_KINDS),
        ref: z.string().max(120),
        title: z.string().min(1).max(160),
        why: z.string().max(300).default(""),
      }),
    )
    .max(5),
  summary: z.string().min(1).max(1200),
});
export type ScorecardDraft = z.infer<typeof scorecardDraftSchema>;

export const ANNOTATION_KINDS = ["positive", "improve", "missed", "red_flag"] as const;
export const annotationsDraftSchema = z.object({
  annotations: z
    .array(
      z.object({
        turn_seq: z.number().int().min(0),
        kind: z.enum(ANNOTATION_KINDS),
        dimension: z.string().max(60).nullable().default(null),
        text: z.string().min(1).max(300),
        severity: z.enum(["low", "medium", "high"]).nullable().default(null),
      }),
    )
    .max(30),
});
export type AnnotationsDraft = z.infer<typeof annotationsDraftSchema>;

// --- quote matching -------------------------------------------------------------------------

function norm(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

/** Does `quote` appear in `source`, tolerating small differences (punctuation, casing, a dropped word)? */
export function quoteMatches(quote: string, source: string): boolean {
  const q = norm(quote);
  const s = norm(source);
  if (q.length === 0 || s.length === 0) return false;
  const joinedSource = ` ${s.join(" ")} `;
  if (joinedSource.includes(` ${q.join(" ")} `)) return true;
  if (q.length < 4) return false; // short quotes must match exactly
  const window = Math.min(q.length + 2, s.length);
  const need = Math.ceil(q.length * 0.8);
  const counts = new Map<string, number>();
  for (const t of q) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (let i = 0; i + window <= s.length; i++) {
    const left = new Map(counts);
    let hit = 0;
    for (const t of s.slice(i, i + window)) {
      const n = left.get(t) ?? 0;
      if (n > 0) {
        left.set(t, n - 1);
        hit++;
      }
    }
    if (hit >= need) return true;
  }
  return false;
}

export interface EvidenceContext {
  turns: readonly TranscriptTurn[];
  /** Text of code snapshots/submissions by reference (event id or `final`). */
  code: Readonly<Record<string, string>>;
}

export function evidenceHolds(e: Evidence, ctx: EvidenceContext): boolean {
  if (e.type === "turn") {
    const seq = typeof e.ref === "number" ? e.ref : Number(e.ref);
    const turn = ctx.turns.find((t) => t.seq === seq && t.speaker !== "system");
    return turn ? quoteMatches(e.quote, turn.text) : false;
  }
  const source = ctx.code[String(e.ref)];
  if (source !== undefined) return quoteMatches(e.quote, source);
  // an unknown reference still counts if the quote is in any code we hold
  return Object.values(ctx.code).some((c) => quoteMatches(e.quote, c));
}

export function trimQuote(quote: string, maxWords = 25): string {
  const words = quote.trim().split(/\s+/);
  return words.length <= maxWords ? quote.trim() : words.slice(0, maxWords).join(" ");
}

/** Problems found in a draft; empty means it can be finalised. Fed back to the model on repair. */
export function verifyDraft(draft: ScorecardDraft, rubric: Rubric, ctx: EvidenceContext): string[] {
  const issues: string[] = [];
  const known = new Set(rubric.dimensions.map((d) => d.key));
  const seen = new Set<string>();
  for (const s of draft.scores) {
    if (!known.has(s.dimension)) {
      issues.push(`unknown dimension "${s.dimension}"`);
      continue;
    }
    if (seen.has(s.dimension)) issues.push(`dimension "${s.dimension}" appears twice`);
    seen.add(s.dimension);
    if (s.score !== null && s.evidence.length === 0) {
      issues.push(`dimension "${s.dimension}" has a score but no evidence`);
    }
    for (const e of s.evidence) {
      if (!evidenceHolds(e, ctx)) {
        issues.push(
          `dimension "${s.dimension}": quote not found in ${e.type} ${String(e.ref)}: "${trimQuote(e.quote, 8)}"`,
        );
      }
    }
  }
  for (const d of rubric.dimensions) {
    if (!d.fromJudge && !seen.has(d.key)) issues.push(`missing dimension "${d.key}"`);
  }
  draft.strengths.forEach((s, i) => {
    if (s.evidence.length === 0) issues.push(`strength ${i + 1} has no evidence`);
    for (const e of s.evidence) {
      if (!evidenceHolds(e, ctx))
        issues.push(`strength ${i + 1}: quote not found: "${trimQuote(e.quote, 8)}"`);
    }
  });
  draft.red_flags.forEach((f, i) => {
    if (f.evidence.length === 0) issues.push(`red flag ${i + 1} has no evidence`);
    for (const e of f.evidence) {
      if (!evidenceHolds(e, ctx))
        issues.push(`red flag ${i + 1}: quote not found: "${trimQuote(e.quote, 8)}"`);
    }
  });
  return issues;
}

// --- aggregation ----------------------------------------------------------------------------

export interface FinalScore {
  dimension: string;
  score: number | null;
  weight: number;
  justification: string;
  evidence: Evidence[];
}

export interface FinalScorecard {
  scores: FinalScore[];
  overall: number;
  band: Band;
  /** Share of the rubric weight that has a score (below ~0.6 the overall is low-confidence). */
  coverage: number;
}

/** Judge-derived correctness (doc 03 E1: "from judge"): computed in code, not drafted by the model. */
export function correctnessFromAttempts(
  perProblem: readonly { accepted: boolean; attemptsBeforeAc: number; submissions: number }[],
): { score: number | null; justification: string } {
  const attempted = perProblem.filter((p) => p.submissions > 0);
  if (attempted.length === 0) {
    return { score: null, justification: "No code was submitted to the judge." };
  }
  const scores = attempted.map((p) => {
    if (!p.accepted) return 1;
    if (p.attemptsBeforeAc === 0) return 5;
    if (p.attemptsBeforeAc <= 2) return 4;
    return 3;
  });
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const accepted = attempted.filter((p) => p.accepted).length;
  return {
    score: avg,
    justification: `${accepted} of ${attempted.length} attempted problem(s) accepted by the judge.`,
  };
}

/** Weighted overall on a 0-100 scale: score 1 maps to 0 and score 5 to 100; unscored dimensions drop out. */
export function aggregate(scores: readonly FinalScore[]): { overall: number; coverage: number } {
  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  const scored = scores.filter((s) => s.score !== null);
  const scoredWeight = scored.reduce((sum, s) => sum + s.weight, 0);
  if (scoredWeight === 0 || totalWeight === 0) return { overall: 0, coverage: 0 };
  const points = scored.reduce((sum, s) => sum + s.weight * (((s.score as number) - 1) / 4), 0);
  return {
    overall: Math.round((points / scoredWeight) * 100),
    coverage: Math.round((scoredWeight / totalWeight) * 100) / 100,
  };
}

export function finalizeScorecard(
  draft: ScorecardDraft,
  rubric: Rubric,
  judge?: { score: number | null; justification: string; evidence: Evidence[] },
): FinalScorecard {
  const byKey = new Map(draft.scores.map((s) => [s.dimension, s]));
  const scores: FinalScore[] = rubric.dimensions.map((d) => {
    if (d.fromJudge) {
      return {
        dimension: d.key,
        score: judge?.score ?? null,
        weight: d.weight,
        justification: judge?.justification ?? "No judge result for this interview.",
        evidence: judge?.evidence ?? [],
      };
    }
    const s = byKey.get(d.key);
    const evidence = (s?.evidence ?? []).map((e) => ({ ...e, quote: trimQuote(e.quote) }));
    // a score without evidence is never trusted
    const score = s && evidence.length > 0 ? s.score : null;
    return {
      dimension: d.key,
      score,
      weight: d.weight,
      justification: s?.justification ?? "Insufficient evidence.",
      evidence,
    };
  });
  const { overall, coverage } = aggregate(scores);
  return { scores, overall, band: bandFor(overall), coverage };
}
