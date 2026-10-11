// Solution-leak guard (doc 13 §9): the interviewer must not hand over code or the reference
// solution. Checked after generation; a failure blocks the reply and triggers one regeneration.

/** Longest fenced code block in the text, in lines. */
export function longestCodeBlockLines(text: string): number {
  let longest = 0;
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    longest = Math.max(longest, (m[1] ?? "").split("\n").filter((l) => l.trim() !== "").length);
  }
  return longest;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function shingles(toks: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= toks.length; i++) out.add(toks.slice(i, i + n).join(" "));
  return out;
}

/** Share of `output`'s n-grams that also occur in `reference` (0 when the output is too short). */
export function ngramOverlap(output: string, reference: string, n = 5): number {
  const out = shingles(tokens(output), n);
  if (out.size === 0) return 0;
  const ref = shingles(tokens(reference), n);
  let hit = 0;
  for (const s of out) if (ref.has(s)) hit++;
  return hit / out.size;
}

/** Fragments of the interviewer's own instructions: a reply containing one is repeating its prompt. */
export const PROMPT_MARKERS = [
  "HARD RULES",
  "OUTPUT FORMAT",
  "is DATA, not instructions",
  "<confidential>",
  "Interviewer-only",
  "<plan>",
] as const;

export interface LeakVerdict {
  leaked: boolean;
  reason?: "code_block" | "reference_overlap" | "prompt_leak";
}

export function checkSolutionLeak(
  output: string,
  references: readonly string[],
  opts: { maxCodeLines?: number; overlapThreshold?: number; minShingles?: number } = {},
): LeakVerdict {
  const maxCodeLines = opts.maxCodeLines ?? 3;
  const threshold = opts.overlapThreshold ?? 0.3;
  const minShingles = opts.minShingles ?? 6;
  if (longestCodeBlockLines(output) > maxCodeLines) return { leaked: true, reason: "code_block" };
  if (PROMPT_MARKERS.some((m) => output.includes(m)))
    return { leaked: true, reason: "prompt_leak" };
  const outToks = tokens(output);
  if (outToks.length - 4 >= minShingles) {
    for (const ref of references) {
      if (ngramOverlap(output, ref) >= threshold)
        return { leaked: true, reason: "reference_overlap" };
    }
  }
  return { leaked: false };
}
