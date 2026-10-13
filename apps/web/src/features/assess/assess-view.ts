import type { OaSectionStatusDto, SqlCell, SqlSubmitResult } from "@prepquest/shared";

// Pure helpers for the SQL practice and online-assessment screens (no I/O, unit tested).

/** How a result cell is shown: NULL is spelled out so it is not mistaken for an empty string. */
export function cellText(cell: SqlCell): string {
  if (cell === null) return "NULL";
  if (typeof cell === "number") return String(cell);
  return cell === "" ? "''" : cell;
}

export function isNullCell(cell: SqlCell): boolean {
  return cell === null;
}

type VerdictCode = "AC" | "WA" | "TLE" | "RE";

/** SQL verdicts on the shared verdict banner: a query error shows as a runtime error. */
export function bannerVerdict(v: SqlSubmitResult["verdict"]): VerdictCode {
  return v === "ERROR" ? "RE" : v;
}

export function rowsText(rows: number, truncated: boolean): string {
  const n = `${rows} row${rows === 1 ? "" : "s"}`;
  return truncated ? `first ${n} (more were cut off)` : n;
}

export const DIFFICULTY_TONE = { easy: "easy", medium: "medium", hard: "hard" } as const;

/** Problems grouped by dataset in the order they arrive. */
export function groupByDataset<T extends { dataset: string; datasetTitle: string }>(
  problems: readonly T[],
): Array<{ dataset: string; title: string; problems: T[] }> {
  const out: Array<{ dataset: string; title: string; problems: T[] }> = [];
  for (const p of problems) {
    let g = out.find((x) => x.dataset === p.dataset);
    if (!g) {
      g = { dataset: p.dataset, title: p.datasetTitle, problems: [] };
      out.push(g);
    }
    g.problems.push(p);
  }
  return out;
}

export interface SqlFilters {
  topic: string;
  difficulty: string;
  status: "all" | "todo" | "solved";
}

export function filterProblems<T extends { topic: string; difficulty: string; solved: boolean }>(
  problems: readonly T[],
  f: SqlFilters,
): T[] {
  return problems.filter(
    (p) =>
      (!f.topic || p.topic === f.topic) &&
      (!f.difficulty || p.difficulty === f.difficulty) &&
      (f.status === "all" || (f.status === "solved") === p.solved),
  );
}

// ---------------------------------------------------------------- assessments

/** "47 min" or "1 h 5 min". */
export function minutesText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Marks as shown to a learner: whole numbers plain, otherwise two decimals trimmed. */
export function marksText(marks: number): string {
  return Number.isInteger(marks) ? String(marks) : String(Math.round(marks * 100) / 100);
}

export function negativeText(penalty: number): string {
  return penalty === 0
    ? "No negative marking"
    : `Each wrong answer costs ${marksText(penalty)} mark`;
}

export function percentileText(p: number | null): string {
  return p === null ? "Not enough other attempts yet" : `Better than ${p}% of other attempts`;
}

export function sectionLabel(s: Pick<OaSectionStatusDto, "status" | "endedBy">): string {
  if (s.status === "pending") return "Waiting";
  if (s.status === "active") return "Running";
  return s.endedBy === "time" ? "Time ran out" : "Handed in";
}

/** Pace advice from seconds per attempted question against the time the paper allows. */
export function paceText(secondsPerQuestion: number | null, allowedPerQuestion: number): string {
  if (secondsPerQuestion === null) return "You did not answer anything.";
  if (secondsPerQuestion > allowedPerQuestion * 1.1)
    return `About ${secondsPerQuestion} s per question: slower than the ${Math.round(allowedPerQuestion)} s the paper allows. Skip a hard one sooner.`;
  if (secondsPerQuestion < allowedPerQuestion * 0.5)
    return `About ${secondsPerQuestion} s per question: fast. Use the spare time to check.`;
  return `About ${secondsPerQuestion} s per question: a steady pace.`;
}
