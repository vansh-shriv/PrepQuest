import { cleanWords, type SpokenWord } from "./speech.js";

// Speech analytics (doc 03 E4, doc 13 section 5.11): mostly code. Fillers, pace, long pauses and hedging
// from the transcript and, for voice, word timestamps. Indicative, never diagnostic.

export interface SpokenTurn {
  seq: number;
  offsetMs: number;
  text: string;
  words?: SpokenWord[] | null;
  modality: "text" | "voice";
}

export const FILLERS = [
  "um",
  "uh",
  "er",
  "ah",
  "you know",
  "basically",
  "actually",
  "sort of",
  "kind of",
  "i mean",
  "like",
] as const;
export const HEDGES = [
  "maybe",
  "i guess",
  "i think",
  "probably",
  "perhaps",
  "not sure",
  "i suppose",
  "might",
  "sort of",
  "kind of",
] as const;

export const LONG_PAUSE_MS = 4000;
export const FAST_WPM = 170;
export const SLOW_WPM = 110;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "like" as a filler, not as a verb, comparison or simile: heuristic, the model is not needed for counts. */
export function countLikeFillers(text: string): number {
  let n = 0;
  const re = /\b(\w+)?\s*\blike\b\s*(\w+)?/gi;
  for (const m of text.matchAll(re)) {
    const before = (m[1] ?? "").toLowerCase();
    const after = (m[2] ?? "").toLowerCase();
    if (
      /^(would|'d|looks?|looked|feels?|felt|seems?|sounds?|something|just|more|much|and|or|not|exactly|look|feel|was|is|are|things|anything|nothing|someone|somebody|people)$/.test(
        before,
      )
    )
      continue;
    if (/^(a|an|the|this|that|to|those|these|it|him|her|them)$/.test(after)) continue;
    n++;
  }
  return n;
}

export function countFillers(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const t = text.toLowerCase();
  for (const f of FILLERS) {
    if (f === "like") {
      const n = countLikeFillers(t);
      if (n > 0) out[f] = n;
      continue;
    }
    const n = (t.match(new RegExp(`(?<![\\w'])${escape(f)}(?![\\w'])`, "g")) ?? []).length;
    if (n > 0) out[f] = n;
  }
  return out;
}

export function countHedges(text: string): number {
  const t = text.toLowerCase();
  return HEDGES.reduce(
    (sum, h) => sum + (t.match(new RegExp(`(?<![\\w'])${escape(h)}(?![\\w'])`, "g")) ?? []).length,
    0,
  );
}

const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

export interface PauseInfo {
  seq: number;
  /** Interview time of the pause start (ms). */
  atMs: number;
  lengthMs: number;
  /** Quiet while the code was changing, or dead air. */
  kind: "thinking" | "dead_air";
}

export interface SpeechAnalysis {
  basis: "voice" | "text";
  words: number;
  wpm: number | null;
  fillerCounts: Record<string, number>;
  fillerPerMin: number | null;
  longPauses: PauseInfo[];
  hedgingRate: number;
  series: { seq: number; offsetMs: number; wpm: number | null; words: number }[];
  /** Plain-language flags: too fast, too slow, many fillers. */
  flags: string[];
}

/**
 * `codeActivityMs` are interview times at which the code changed or ran (for telling a thinking pause from
 * dead air); `durationMs` is the span the candidate was speaking in (default: from the first to the last turn).
 */
export function analyzeSpeech(
  turns: readonly SpokenTurn[],
  opts: { codeActivityMs?: readonly number[]; durationMs?: number } = {},
): SpeechAnalysis {
  const candidate = turns.filter((t) => t.text.trim().length > 0);
  const voice = candidate.some((t) => t.modality === "voice");
  const text = candidate.map((t) => t.text).join(" ");
  const words = wordsOf(text).length;
  const fillerCounts = countFillers(text);
  const fillers = Object.values(fillerCounts).reduce((a, b) => a + b, 0);

  const series: SpeechAnalysis["series"] = [];
  const pauses: PauseInfo[] = [];
  let spokenWords = 0;
  let spokenMs = 0;
  for (const t of candidate) {
    const w = t.words ? cleanWords(t.words) : [];
    if (t.modality === "voice" && w.length >= 5) {
      const span = w[w.length - 1]!.endMs - w[0]!.startMs;
      const wpm = span >= 3000 ? Math.round((w.length / span) * 60_000) : null;
      series.push({ seq: t.seq, offsetMs: t.offsetMs, wpm, words: w.length });
      spokenWords += w.length;
      spokenMs += span;
      for (let i = 1; i < w.length; i++) {
        const gap = w[i]!.startMs - w[i - 1]!.endMs;
        if (gap >= LONG_PAUSE_MS) {
          const at = t.offsetMs + w[i - 1]!.endMs;
          const near = (opts.codeActivityMs ?? []).some(
            (c) => c >= at - 2000 && c <= at + gap + 2000,
          );
          pauses.push({
            seq: t.seq,
            atMs: at,
            lengthMs: gap,
            kind: near ? "thinking" : "dead_air",
          });
        }
      }
    } else {
      series.push({ seq: t.seq, offsetMs: t.offsetMs, wpm: null, words: wordsOf(t.text).length });
    }
  }
  const wpm = voice && spokenMs >= 3000 ? Math.round((spokenWords / spokenMs) * 60_000) : null;
  const spanMs =
    opts.durationMs ??
    (candidate.length > 1 ? candidate[candidate.length - 1]!.offsetMs - candidate[0]!.offsetMs : 0);
  const minutes = spanMs / 60_000;
  const fillerPerMin =
    voice && spokenMs >= 30_000
      ? Math.round((fillers / (spokenMs / 60_000)) * 100) / 100
      : minutes >= 1
        ? Math.round((fillers / minutes) * 100) / 100
        : null;
  const hedgingRate = words > 0 ? Math.round((countHedges(text) / words) * 1000) / 1000 : 0;

  const flags: string[] = [];
  if (wpm !== null && wpm > FAST_WPM)
    flags.push("You spoke quickly on average. A slower pace helps the interviewer follow.");
  if (wpm !== null && wpm < SLOW_WPM)
    flags.push("You spoke slowly on average. Fine for thinking aloud, but watch long gaps.");
  if (words >= 150 && fillers / words > 0.04)
    flags.push("Filler words were frequent. A short pause usually reads better than a filler.");
  if (words >= 150 && hedgingRate > 0.03)
    flags.push(
      "Many hedges (maybe, I guess). State what you know, then name the uncertainty once.",
    );
  if (pauses.filter((p) => p.kind === "dead_air").length >= 2)
    flags.push(
      "Several long silences with no coding. Say what you are thinking while you work it out.",
    );

  return {
    basis: voice ? "voice" : "text",
    words,
    wpm,
    fillerCounts,
    fillerPerMin,
    longPauses: pauses,
    hedgingRate,
    series,
    flags,
  };
}
