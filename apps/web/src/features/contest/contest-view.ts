import type { ContestPhaseValue, StandingCell } from "@prepquest/shared";

// Pure helpers for the contest screens (no I/O, unit tested).

/** "1:05:09", "12:05" or "0:09". */
export function countdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export const PHASE_LABEL: Record<ContestPhaseValue, string> = {
  upcoming: "Starts soon",
  running: "Running",
  past: "Finished",
};

export function phaseHeadline(phase: ContestPhaseValue, secondsLeft: number): string {
  if (phase === "past") return "This contest has ended.";
  return phase === "upcoming"
    ? `Starts in ${countdown(secondsLeft)}`
    : `${countdown(secondsLeft)} left`;
}

export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** One cell of the standings table: "+" or "+2" when solved, "-3" for wrong attempts, "?" while judging. */
export function cellText(cell: StandingCell, scoring: "icpc" | "points"): string {
  if (cell.solved) {
    const base =
      scoring === "points" ? String(cell.score) : cell.wrong > 0 ? `+${cell.wrong}` : "+";
    return cell.minute === null ? base : `${base} (${cell.minute}')`;
  }
  if (cell.pending > 0) return "?";
  return cell.wrong > 0 ? `-${cell.wrong}` : "";
}

export function summaryText(
  row: { solved: number; penalty: number; score: number },
  scoring: "icpc" | "points",
) {
  return scoring === "points"
    ? `${row.score} points`
    : `${row.solved} solved, ${row.penalty} min penalty`;
}

export const VERDICT_TEXT: Record<string, string> = {
  AC: "Accepted",
  WA: "Wrong answer",
  TLE: "Time limit",
  MLE: "Memory limit",
  RE: "Runtime error",
  CE: "Compile error",
  OLE: "Output limit",
  IE: "Judge error",
  QUEUED: "Judging",
  COMPILING: "Judging",
  RUNNING: "Judging",
};

/** The datetime-local value for "now plus N minutes" in the browser's own time zone. */
export function localInputValue(from: Date, plusMinutes = 0): string {
  const d = new Date(from.getTime() + plusMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
