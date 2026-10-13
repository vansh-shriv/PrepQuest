// Contest scoring and standings (D7). Pure: the API loads submissions and calls `computeStandings`.

export type ContestScoring = "icpc" | "points";

export interface ContestRules {
  scoring: ContestScoring;
  durationMs: number;
}

/** ICPC: minutes added for each wrong attempt before the accepted one. */
export const ICPC_WRONG_MINUTES = 20;
/** Points: an accepted answer at the very end is worth this share less than one at the start. */
export const POINTS_DECAY = 0.5;
/** Points lost for each wrong attempt before the accepted one. */
export const POINTS_PER_WRONG = 10;
/** A solved problem never scores below this share of its points. */
export const POINTS_FLOOR = 0.3;

export interface ContestProblemSpec {
  id: string;
  label: string;
  points: number;
}

export interface ContestAttempt {
  userId: string;
  problemId: string;
  /** Milliseconds since this participant's own start (the contest start for live participants). */
  elapsedMs: number;
  verdict: string;
}

/** Verdicts that count as a wrong attempt. Compile errors and infrastructure errors do not. */
const WRONG = new Set(["WA", "TLE", "MLE", "RE", "OLE"]);
const PENDING = new Set(["QUEUED", "COMPILING", "RUNNING"]);

export interface Cell {
  problemId: string;
  solved: boolean;
  /** Wrong attempts before the accepted one (or all wrong attempts while unsolved). */
  wrong: number;
  /** Whole minutes at which it was solved. */
  minute: number | null;
  /** Points scored (points scoring) or 0. */
  score: number;
  /** Attempts still being judged, or hidden by the freeze. */
  pending: number;
}

export interface StandingRow {
  userId: string;
  rank: number;
  solved: number;
  /** ICPC penalty in minutes (points scoring: the minute of the last solve). */
  penalty: number;
  score: number;
  cells: Cell[];
}

const minuteOf = (ms: number) => Math.floor(ms / 60_000);

function pointsFor(points: number, elapsedMs: number, durationMs: number, wrong: number): number {
  const frac = durationMs <= 0 ? 0 : Math.min(1, Math.max(0, elapsedMs / durationMs));
  const decayed = Math.round(points * (1 - POINTS_DECAY * frac)) - POINTS_PER_WRONG * wrong;
  return Math.max(Math.round(points * POINTS_FLOOR), decayed);
}

export interface StandingsOptions {
  /** Attempts at or after this many ms are hidden (shown only as pending): the freeze. */
  freezeFromMs?: number | null;
}

/**
 * Standings for the given participants. Attempts outside the contest window are ignored, only the first
 * accepted attempt per problem counts, and ties share a rank (1, 2, 2, 4).
 */
export function computeStandings(
  users: readonly string[],
  problems: readonly ContestProblemSpec[],
  attempts: readonly ContestAttempt[],
  rules: ContestRules,
  opts: StandingsOptions = {},
): StandingRow[] {
  const freeze = opts.freezeFromMs ?? null;
  const byUser = new Map<string, ContestAttempt[]>();
  for (const a of attempts) {
    if (a.elapsedMs < 0 || a.elapsedMs > rules.durationMs) continue;
    const list = byUser.get(a.userId) ?? [];
    list.push(a);
    byUser.set(a.userId, list);
  }

  const rows = users.map((userId) => {
    const mine = (byUser.get(userId) ?? []).sort((a, b) => a.elapsedMs - b.elapsedMs);
    let solved = 0;
    let penalty = 0;
    let score = 0;
    let last = 0;
    const cells = problems.map((p): Cell => {
      let wrong = 0;
      let pending = 0;
      let accepted: ContestAttempt | null = null;
      for (const a of mine) {
        if (a.problemId !== p.id) continue;
        if (freeze !== null && a.elapsedMs >= freeze) {
          pending++;
          continue;
        }
        if (accepted) break;
        if (a.verdict === "AC") accepted = a;
        else if (PENDING.has(a.verdict)) pending++;
        else if (WRONG.has(a.verdict)) wrong++;
      }
      if (!accepted)
        return { problemId: p.id, solved: false, wrong, minute: null, score: 0, pending };
      const minute = minuteOf(accepted.elapsedMs);
      const cellScore =
        rules.scoring === "points"
          ? pointsFor(p.points, accepted.elapsedMs, rules.durationMs, wrong)
          : 0;
      solved++;
      score += cellScore;
      last = Math.max(last, minute);
      penalty += rules.scoring === "icpc" ? minute + ICPC_WRONG_MINUTES * wrong : 0;
      return { problemId: p.id, solved: true, wrong, minute, score: cellScore, pending };
    });
    if (rules.scoring === "points") penalty = last;
    return { userId, solved, penalty, score, last, cells };
  });

  rows.sort((a, b) =>
    rules.scoring === "icpc"
      ? b.solved - a.solved || a.penalty - b.penalty || a.last - b.last
      : b.score - a.score || a.penalty - b.penalty,
  );

  const same = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    rules.scoring === "icpc"
      ? a.solved === b.solved && a.penalty === b.penalty
      : a.score === b.score && a.penalty === b.penalty;
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || !same(rows[i - 1]!, r)) rank = i + 1;
    return {
      userId: r.userId,
      rank,
      solved: r.solved,
      penalty: r.penalty,
      score: r.score,
      cells: r.cells,
    };
  });
}

/** Where a score would land among a finished contest's rows (virtual participation). */
export function placeAmong(
  mine: Pick<StandingRow, "solved" | "penalty" | "score">,
  field: readonly Pick<StandingRow, "solved" | "penalty" | "score">[],
  scoring: ContestScoring,
): number {
  const better = field.filter((o) =>
    scoring === "icpc"
      ? o.solved > mine.solved || (o.solved === mine.solved && o.penalty < mine.penalty)
      : o.score > mine.score || (o.score === mine.score && o.penalty < mine.penalty),
  ).length;
  return better + 1;
}

export type ContestPhase = "upcoming" | "running" | "past";

export function contestPhase(startsAt: Date, endsAt: Date, now: Date): ContestPhase {
  if (now < startsAt) return "upcoming";
  return now < endsAt ? "running" : "past";
}

/** The frozen window starts this many ms into the contest, or null without a freeze. */
export function freezeFromMs(durationMs: number, freezeMinutes: number): number | null {
  return freezeMinutes > 0 ? Math.max(0, durationMs - freezeMinutes * 60_000) : null;
}
