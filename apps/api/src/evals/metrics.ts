// Statistics for the AI evaluation harness (doc 13 section 10, doc 16). Pure functions.

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

export function stdDev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/** Mean absolute error between predictions and labels (pairs with a null side are skipped). */
export function mae(pairs: readonly { predicted: number | null; label: number }[]): number {
  const used = pairs.filter((p) => p.predicted !== null) as { predicted: number; label: number }[];
  return mean(used.map((p) => Math.abs(p.predicted - p.label)));
}

/** Ranks with ties averaged (1 = smallest). */
export function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.x === order[i]!.x) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]!.i] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation, or null when it is undefined (fewer than 2 points or no variation). */
export function spearman(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export interface Threshold {
  name: string;
  value: number | null;
  /** The check passes when `value` is on the right side of `limit`. */
  limit: number;
  direction: "atMost" | "atLeast";
  /** A hard gate fails the run; a soft one is reported. */
  hard: boolean;
}

export function passes(t: Threshold): boolean {
  if (t.value === null) return false;
  return t.direction === "atMost" ? t.value <= t.limit : t.value >= t.limit;
}

export function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
