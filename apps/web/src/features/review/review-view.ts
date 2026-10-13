import type {
  CodeReviewDto,
  ComplexityDto,
  ComplexitySampleDto,
  ReviewCategory,
  ReviewCommentDto,
  ReviewSeverity,
} from "@prepquest/shared";

// Pure helpers for the code review and complexity panels (no I/O, unit tested).

export const SEVERITY_LABEL: Record<ReviewSeverity, string> = {
  important: "Important",
  suggestion: "Suggestion",
  nit: "Nit",
};

export const CATEGORY_LABEL: Record<ReviewCategory, string> = {
  readability: "Readability",
  idioms: "Idioms",
  complexity: "Complexity",
  "edge-cases": "Edge cases",
  maintainability: "Maintainability",
  presentation: "Interview presentation",
};

const SEVERITY_RANK: Record<ReviewSeverity, number> = { important: 0, suggestion: 1, nit: 2 };

/** Comments grouped under the line they are about, most important first. */
export function commentsByLine(
  comments: readonly ReviewCommentDto[],
  shown: ReadonlySet<ReviewSeverity>,
): Map<number, ReviewCommentDto[]> {
  const out = new Map<number, ReviewCommentDto[]>();
  for (const c of comments) {
    if (!shown.has(c.severity)) continue;
    const list = out.get(c.line) ?? [];
    list.push(c);
    list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    out.set(c.line, list);
  }
  return out;
}

/** How many comments of each severity, for the filter labels. */
export function severityCounts(
  comments: readonly ReviewCommentDto[],
): Record<ReviewSeverity, number> {
  const counts: Record<ReviewSeverity, number> = { important: 0, suggestion: 0, nit: 0 };
  for (const c of comments) counts[c.severity]++;
  return counts;
}

/** "4 of 5" with filled and empty squares, so the score is readable without colour. */
export function ratingText(n: number | undefined): string {
  const v = Math.max(0, Math.min(5, Math.round(n ?? 0)));
  return `${"■".repeat(v)}${"□".repeat(5 - v)}`;
}

/** The code split into numbered lines, as the review refers to them. */
export function numberedLines(code: string): Array<{ n: number; text: string }> {
  return code
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((text, i) => ({ n: i + 1, text }));
}

/** Polling delay while a job runs in the background; `null` once it is finished. */
export function reviewPollMs(r: CodeReviewDto | null): number | null {
  if (!r) return null;
  return r.status === "pending" || r.refactor.status === "checking" ? 1500 : null;
}

export function complexityPollMs(c: ComplexityDto | null): number | null {
  return c?.status === "running" ? 2000 : null;
}

/** Classes offered in the claim form, written the way the analyzer reads them. */
export const CLAIM_OPTIONS = [
  { value: "O(1)", label: "O(1)" },
  { value: "O(log n)", label: "O(log n)" },
  { value: "O(n)", label: "O(n)" },
  { value: "O(n log n)", label: "O(n log n)" },
  { value: "O(n^2)", label: "O(n²)" },
  { value: "O(n^3)", label: "O(n³)" },
  { value: "O(2^n)", label: "O(2ⁿ)" },
] as const;

export interface ChartPoint {
  n: number;
  timeMs: number;
  x: number;
  y: number;
  limit: boolean;
}

export interface ChartGeometry {
  points: ChartPoint[];
  /** SVG path through the measured points. */
  path: string;
  maxN: number;
  maxMs: number;
}

/** Positions for the growth chart: sizes on x, time on y, inside a box with a margin for labels. */
export function chartGeometry(
  samples: readonly ComplexitySampleDto[],
  width: number,
  height: number,
  margin = { left: 44, right: 12, top: 12, bottom: 28 },
): ChartGeometry {
  const timed = samples.filter(
    (s): s is ComplexitySampleDto & { timeMs: number } => s.timeMs !== null,
  );
  const maxN = Math.max(1, ...timed.map((s) => s.n));
  const maxMs = Math.max(1, ...timed.map((s) => s.timeMs));
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const points = timed.map((s) => ({
    n: s.n,
    timeMs: s.timeMs,
    limit: s.limit,
    x: Math.round(margin.left + (s.n / maxN) * w),
    y: Math.round(margin.top + h - (s.timeMs / maxMs) * h),
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return { points, path, maxN, maxMs };
}

/** "128,000" for a size and "1.4 s" for a time, so the table reads easily. */
export const sizeText = (n: number) => n.toLocaleString("en-US");
export function msText(ms: number | null): string {
  if (ms === null) return "not run";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

export const CONFIDENCE_TEXT = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
} as const;
