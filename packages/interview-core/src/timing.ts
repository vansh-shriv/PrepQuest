import type { PlannedSegment } from "./types.js";

// Server-authoritative timing helpers (doc 03 I8, doc 13 §3). The caller supplies elapsed time
// (computed from the database clock minus paused time); nothing here reads a clock.

export const WARNING_THRESHOLDS = [
  { key: "10m", ms: 10 * 60_000 },
  { key: "5m", ms: 5 * 60_000 },
  { key: "1m", ms: 60_000 },
] as const;
export type TimerWarning = (typeof WARNING_THRESHOLDS)[number]["key"];

/** Share of the interview after which the engine forces the wrap-up (unless the candidate is in the last coding). */
export const FORCE_WRAPUP_AT = 0.85;
/** A segment running past this multiple of its planned length gets a "move on" instruction. */
export const SEGMENT_OVERRUN_FACTOR = 1.3;
/** Pause rules (practice mode only): one pause of at most three minutes. */
export const MAX_PAUSES = 1;
export const MAX_PAUSE_MS = 3 * 60_000;

export function remainingMs(plannedMs: number, elapsedMs: number): number {
  return Math.max(0, plannedMs - elapsedMs);
}

/** The segment the wall clock is in (the last one once time is up). */
export function segmentAtTime(segments: readonly PlannedSegment[], elapsedMs: number) {
  const index = segments.findIndex((s) => elapsedMs < s.endMs);
  const i = index === -1 ? segments.length - 1 : index;
  return { index: i, segment: segments[i] };
}

export function segmentOverrun(
  segment: PlannedSegment,
  enteredAtMs: number,
  elapsedMs: number,
): boolean {
  const planned = segment.endMs - segment.startMs;
  return elapsedMs - enteredAtMs > planned * SEGMENT_OVERRUN_FACTOR;
}

/** Warnings crossed when the remaining time dropped from `prevRemainingMs` to `remainingNowMs`. */
export function crossedWarnings(
  prevRemainingMs: number,
  remainingNowMs: number,
  plannedMs: number,
): TimerWarning[] {
  return WARNING_THRESHOLDS.filter(
    // a 15 minute interview never says "10 minutes left" at the very start
    (w) => w.ms < plannedMs && prevRemainingMs > w.ms && remainingNowMs <= w.ms,
  ).map((w) => w.key);
}

export type TimeGuard = "none" | "force_wrapup" | "end";

export function timeGuard(elapsedMs: number, plannedMs: number): TimeGuard {
  if (elapsedMs >= plannedMs) return "end";
  if (elapsedMs >= plannedMs * FORCE_WRAPUP_AT) return "force_wrapup";
  return "none";
}

/** Pause is allowed once, for up to three minutes, and only in practice (non-realistic) mode. */
export function canPause(opts: {
  realistic: boolean;
  pausesUsed: number;
  alreadyPaused: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (opts.realistic) return { ok: false, reason: "Pausing is off in realistic mode." };
  if (opts.alreadyPaused) return { ok: false, reason: "The interview is already paused." };
  if (opts.pausesUsed >= MAX_PAUSES) return { ok: false, reason: "You already used your pause." };
  return { ok: true };
}
