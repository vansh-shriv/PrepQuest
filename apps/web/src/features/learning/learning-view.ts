import type { QuizQuestionDto, RoadmapNodeDto, RoadmapNodeState } from "@prepquest/shared";

// Pure helpers for the reviews, quizzes, roadmaps and tracks screens (no I/O, unit tested).

/** "Due today", "1 day overdue", "5 days overdue". */
export function dueLabel(overdueDays: number): string {
  if (overdueDays <= 0) return "Due today";
  return `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`;
}

/** "1 day", "3 days", "2 weeks", "3 months". */
export function intervalLabel(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

export function retentionText(retention: number | null): string {
  return retention === null ? "No reviews yet" : `${Math.round(retention * 100)}%`;
}

/** Height of a bar (0 to 100) for a day's count, relative to the busiest day. */
export function barPercent(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.max(8, Math.round((count / max) * 100));
}

// ---------------------------------------------------------------- quiz

export type QuizResponse = string | boolean | string[];

/** Whether a response is complete enough to submit (a blank or an empty selection is not). */
export function isAnswerReady(type: QuizQuestionDto["type"], response: QuizResponse | undefined) {
  if (response === undefined) return false;
  if (type === "multi") return Array.isArray(response) && response.length > 0;
  if (type === "tf") return typeof response === "boolean";
  return typeof response === "string" && response.trim().length > 0;
}

/** Adds or removes an option id from a multi-select, keeping the ids sorted. */
export function toggleOption(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].sort();
}

/** Whole seconds left until a deadline, never negative. */
export function secondsLeft(deadlineIso: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadlineIso) - nowMs) / 1000));
}

/** "12:05" or "0:09". */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const MODE_LABELS = {
  practice: "Practice",
  timed: "Timed test",
  drill: "Topic drill",
  weak: "Weak-area quiz",
} as const;

export function accuracyText(correct: number, answered: number): string {
  return answered === 0
    ? "Not started"
    : `${Math.round((correct / answered) * 100)}% of ${answered}`;
}

// ---------------------------------------------------------------- roadmap

export const NODE_STATE_LABELS: Record<RoadmapNodeState, string> = {
  locked: "Locked",
  open: "In progress",
  cleared: "Cleared",
  mastered: "Mastered",
};

/** Nodes grouped by layer, layers in order, nodes in the order they were authored. */
export function byLayer(nodes: readonly RoadmapNodeDto[]): RoadmapNodeDto[][] {
  const out: RoadmapNodeDto[][] = [];
  for (const n of nodes) (out[n.layer] ??= []).push(n);
  return out.filter((l) => l && l.length > 0);
}

export function masteryText(mastery: number | null): string {
  return mastery === null ? "No evidence yet" : `${Math.round(mastery * 100)}%`;
}

export function coverageText(share: number): string {
  return `${Math.round(share * 100)}%`;
}
