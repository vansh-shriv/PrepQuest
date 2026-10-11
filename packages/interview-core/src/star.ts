import { z } from "zod";

// STAR analysis of behavioural answers (doc 03 E4, doc 13 sections 5.9 and 5.10). The model judges which
// parts of the story are present; code computes what can be counted (ownership words, numbers) and
// checks that a rewritten story adds no facts.

const part = z.number().int().min(0).max(2);
export const starAnswerSchema = z.object({
  turn_seq: z.number().int().min(0),
  s: part,
  t: part,
  a: part,
  r: part,
  specificity: part,
  impact: part,
  reflection: part,
  justification: z.string().min(1).max(400),
  rewrite_md: z.string().max(2000).nullable().default(null),
});
export type StarAnswer = z.infer<typeof starAnswerSchema>;

export const starResultSchema = z.object({ answers: z.array(starAnswerSchema).max(8) });

const SINGULAR = /\b(i|i'm|i've|i'd|i'll|me|my|mine|myself)\b/gi;
const PLURAL = /\b(we|we're|we've|we'd|we'll|us|our|ours|ourselves|the team|my team)\b/gi;

/** Share of "I" among "I" and "we" words: 1 is all personal, 0 is all team (null when neither appears). */
export function ownershipRatio(text: string): number | null {
  const i = (text.match(SINGULAR) ?? []).length;
  const we = (text.match(PLURAL) ?? []).length;
  return i + we === 0 ? null : Math.round((i / (i + we)) * 1000) / 1000;
}

/** Numbers, percentages and sizes mentioned: a rough count of how concrete the answer is. */
export function countNumbers(text: string): number {
  return (
    text.match(/\b\d[\d,.]*\s?(%|x|ms|s|k|m|users|requests|days|weeks|months|hours|people)?\b/gi) ??
    []
  ).length;
}

/** STAR completeness 0-100 from the four parts (each 0-2). */
export function starCompleteness(a: Pick<StarAnswer, "s" | "t" | "a" | "r">): number {
  return Math.round(((a.s + a.t + a.a + a.r) / 8) * 100);
}

// --- facts in a rewrite ---------------------------------------------------------------------

/** A suggestion the rewrite adds is allowed only inside square brackets: "[added suggestion: ...]". */
function stripSuggestions(text: string): string {
  return text.replace(/\[[^\]]*\]/g, " ");
}

const ignorable = new Set([
  "i",
  "we",
  "the",
  "a",
  "an",
  "my",
  "our",
  "situation",
  "task",
  "action",
  "result",
  "s",
  "t",
  "a",
  "r",
  "in",
  "at",
  "on",
  "it",
  "this",
  "that",
  "so",
  "as",
  "when",
  "then",
  "after",
  "before",
  "and",
  "but",
]);

/** Concrete facts in a text: numbers with units and capitalised names that do not start a sentence. */
export function extractFacts(text: string): string[] {
  const clean = stripSuggestions(text);
  const facts = new Set<string>();
  for (const m of clean.matchAll(
    /\b\d[\d,.]*\s?(?:%|x|ms|k|m|users|requests|days|weeks|months|hours|people)?/gi,
  )) {
    facts.add(m[0].trim().toLowerCase().replace(/[,.]$/, ""));
  }
  for (const m of clean.matchAll(
    /(?<![.!?]\s)(?<!^)(?<!\n)\b([A-Z][a-zA-Z0-9]{2,}(?:\s[A-Z][a-zA-Z0-9]{2,})*)\b/g,
  )) {
    const name = m[1]!.trim();
    if (!ignorable.has(name.toLowerCase())) facts.add(name.toLowerCase());
  }
  return [...facts];
}

/** Facts the rewrite contains that the candidate never said (case-insensitive substring match). */
export function inventedFacts(rewrite: string, sources: readonly string[]): string[] {
  const haystack = sources.join("\n").toLowerCase();
  return extractFacts(rewrite).filter((f) => !haystack.includes(f));
}
