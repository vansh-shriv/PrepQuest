// Voice helpers (doc 03 I5, doc 13 section 11). Pure text functions shared by the server and the
// browser: what the speech engine may say, and how spoken answers are assembled.

/** Said instead of a code block: the code is on screen, never read aloud. */
export const CODE_OMITTED = "code omitted, see the editor";

/**
 * Text for text-to-speech: the control block and markdown are removed, fenced code is replaced by a
 * short phrase, links are read as their label, and whitespace is normalised.
 */
export function speakableText(text: string): string {
  return text
    .replace(/<control>[\s\S]*?(<\/control>|$)/gi, " ")
    .replace(/```[\s\S]*?(```|$)/g, ` ${CODE_OMITTED}. `)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SpokenWord {
  w: string;
  startMs: number;
  endMs: number;
}

/** Word list for a spoken answer from timestamps, dropping malformed entries (the client is untrusted). */
export function cleanWords(words: readonly SpokenWord[], maxEndMs = 4 * 3600_000): SpokenWord[] {
  const out: SpokenWord[] = [];
  let prevEnd = 0;
  for (const word of words) {
    const w = String(word.w ?? "").trim();
    const startMs = Number(word.startMs);
    const endMs = Number(word.endMs);
    if (!w || !Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (startMs < 0 || endMs < startMs || endMs > maxEndMs) continue;
    if (startMs + 50 < prevEnd) continue; // overlapping stamps: keep the earlier word
    out.push({ w: w.slice(0, 60), startMs, endMs });
    prevEnd = endMs;
  }
  return out;
}

/** Words per minute over the span of the spoken words (null when there is too little to say). */
export function wordsPerMinute(words: readonly SpokenWord[]): number | null {
  if (words.length < 5) return null;
  const span = words[words.length - 1]!.endMs - words[0]!.startMs;
  if (span < 3000) return null;
  return Math.round((words.length / span) * 60_000);
}

/**
 * How much of an interviewer reply was heard before the candidate cut in, from the speech engine's
 * character index. Clamped to the text, and moved back to the start of a word.
 */
export function spokenPrefix(text: string, charIndex: number): string {
  const n = Math.max(0, Math.min(text.length, Math.floor(charIndex)));
  if (n >= text.length) return text;
  const cut = text.lastIndexOf(" ", n);
  return text.slice(0, n === 0 || /\s/.test(text[n] ?? "") ? n : Math.max(0, cut)).trim();
}

/** Extra rules for the interviewer prompt when the candidate listens instead of reading. */
export const VOICE_PROMPT_RULES = `VOICE MODE
- The candidate hears your reply spoken aloud. Use plain sentences: no markdown, lists, headings, emoji or code blocks.
- Say symbols as words when it matters ("order of n squared"). Keep numbers short.
- Their words arrive as a transcript and may contain recognition errors; if something sounds odd, ask them to repeat it instead of guessing.
- An earlier reply of yours may be marked as interrupted: the candidate heard only the first part of it.`;
