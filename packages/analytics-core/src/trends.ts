// Interview performance trends (doc 04 A3). Pure: the API loads finished scorecards and passes them in.

export interface TrendSession {
  id: string;
  /** ISO instant the interview ended. */
  at: string;
  type: string;
  persona: string;
  difficulty: number;
  company: string | null;
  /** 0 to 100, or null when the interview could not be scored. */
  overall: number | null;
  /** Dimension key to score 1 to 5 (unscored dimensions are left out). */
  dimensions: Record<string, number>;
  /** Share of the planned time that was used, 0 to 1. */
  completion: number;
  /** Short labels of the red flags raised in this interview. */
  redFlags: string[];
  /** Filler words per minute, when speech analytics exist. */
  fillerPerMin?: number | null;
  wpm?: number | null;
}

export interface TrendPoint {
  id: string;
  at: string;
  type: string;
  overall: number;
  /** Mean of the last `window` overall scores up to and including this one. */
  moving: number;
  /** The persona or difficulty changed since the previous session: a dip may come from that. */
  settingsChanged: boolean;
}

export interface DeltaCard {
  dimension: string;
  /** Mean score (1 to 5) over the last `n` sessions minus the `n` before them. */
  delta: number;
  recent: number;
  previous: number;
}

export interface Habit {
  flag: string;
  count: number;
  of: number;
  message: string;
}

export interface Trends {
  points: TrendPoint[];
  best: string | null;
  worst: string | null;
  deltas: DeltaCard[];
  habits: Habit[];
  speech: { id: string; at: string; fillerPerMin: number | null; wpm: number | null }[];
  /** How many sessions were left out because they were abandoned early. */
  excluded: number;
}

export const MIN_COMPLETION = 0.3;

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function interviewTrends(
  all: readonly TrendSession[],
  options: { includeAbandoned?: boolean; window?: number; habitWindow?: number } = {},
): Trends {
  const window = options.window ?? 3;
  const n = 5;
  const sorted = [...all].sort((a, b) => a.at.localeCompare(b.at));
  const kept = sorted.filter((s) => options.includeAbandoned || s.completion >= MIN_COMPLETION);
  const scored = kept.filter((s) => s.overall !== null);

  const points: TrendPoint[] = scored.map((s, i) => {
    const slice = scored.slice(Math.max(0, i - window + 1), i + 1).map((x) => x.overall!);
    const prev = scored[i - 1];
    return {
      id: s.id,
      at: s.at,
      type: s.type,
      overall: s.overall!,
      moving: round1(mean(slice)),
      settingsChanged: !!prev && (prev.persona !== s.persona || prev.difficulty !== s.difficulty),
    };
  });
  const best = points.reduce<TrendPoint | null>(
    (a, p) => (!a || p.overall > a.overall ? p : a),
    null,
  );
  const worst = points.reduce<TrendPoint | null>(
    (a, p) => (!a || p.overall < a.overall ? p : a),
    null,
  );

  const dims = new Set(kept.flatMap((s) => Object.keys(s.dimensions)));
  const deltas: DeltaCard[] = [];
  for (const dimension of [...dims].sort()) {
    const withDim = kept.filter((s) => s.dimensions[dimension] !== undefined);
    if (withDim.length < 2) continue;
    const recent = withDim.slice(-n).map((s) => s.dimensions[dimension]!);
    const before = withDim.slice(-2 * n, -n).map((s) => s.dimensions[dimension]!);
    if (before.length === 0) continue;
    deltas.push({
      dimension,
      delta: round1(mean(recent) - mean(before)),
      recent: round1(mean(recent)),
      previous: round1(mean(before)),
    });
  }

  const habitWindow = options.habitWindow ?? 5;
  const lastSessions = kept.slice(-habitWindow);
  const flagCount = new Map<string, number>();
  for (const s of lastSessions)
    for (const f of new Set(s.redFlags)) flagCount.set(f, (flagCount.get(f) ?? 0) + 1);
  const habits: Habit[] = [...flagCount.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([flag, count]) => ({
      flag,
      count,
      of: lastSessions.length,
      message: `${flag}: in ${count} of your last ${lastSessions.length} interviews. This is a habit to work on.`,
    }));

  return {
    points,
    best: best?.id ?? null,
    worst: worst?.id ?? null,
    deltas,
    habits,
    speech: kept
      .filter((s) => s.fillerPerMin != null || s.wpm != null)
      .map((s) => ({
        id: s.id,
        at: s.at,
        fillerPerMin: s.fillerPerMin ?? null,
        wpm: s.wpm ?? null,
      })),
    excluded: sorted.length - kept.length,
  };
}
