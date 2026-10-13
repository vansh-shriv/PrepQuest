// Complexity analyzer (X4): fit measured run times to growth curves and compare with what the learner
// claimed. Pure: the API supplies the samples the judge measured.
//
// What is measured is the whole run of the solution, which always reads its input. So the shortest class that
// can be told apart is O(n): "O(1)", "O(log n)" and "O(n)" all look like "O(n) or faster". The result is an
// empirical estimate, never a proof.

export const GROWTH_IDS = ["n", "nlogn", "n2", "n3", "2n"] as const;
export type GrowthId = (typeof GROWTH_IDS)[number];

/** Classes a learner may claim. Sublinear ones are accepted but cannot be separated from `n` by a timed run. */
export type ClaimId = "1" | "logn" | GrowthId;

export const GROWTH_LABEL: Record<ClaimId, string> = {
  "1": "O(1)",
  logn: "O(log n)",
  n: "O(n)",
  nlogn: "O(n log n)",
  n2: "O(n²)",
  n3: "O(n³)",
  "2n": "O(2ⁿ)",
};

const GROWTH_FN: Record<GrowthId, (n: number) => number> = {
  n: (n) => n,
  nlogn: (n) => n * Math.log2(Math.max(2, n)),
  n2: (n) => n * n,
  n3: (n) => n * n * n,
  // clamped: exponential growth over thousands of elements overflows a double
  "2n": (n) => 2 ** Math.min(n, 1000),
};

const RANK: Record<ClaimId, number> = { "1": 0, logn: 1, n: 2, nlogn: 3, n2: 4, n3: 5, "2n": 6 };

/** One measured size: the fastest CPU time over repeats, and whether it ran out of time. */
export interface ScaleSample {
  n: number;
  timeMs: number;
  memoryKb?: number | null;
  /** The run hit the time limit: `timeMs` is only a lower bound. */
  censored?: boolean;
}

export type Confidence = "high" | "medium" | "low";

export interface GrowthEstimate {
  /** The simplest class that fits about as well as any other. */
  best: GrowthId;
  /** Every class whose growth rate agrees with the measurement within noise (always contains `best`). */
  plausible: GrowthId[];
  /** Quality of the log-log line (1 is a perfect straight line). */
  r2: number;
  confidence: Confidence;
  /** Measured growth exponent (time ~ n^slope) and its standard error. */
  slope: number;
  slopeError: number;
}

/** "O(n²)" when one class fits, "O(n) to O(n log n)" when the run cannot tell neighbours apart. */
export function describeGrowth(e: Pick<GrowthEstimate, "best" | "plausible">): string {
  const sorted = [...e.plausible].sort((a, b) => RANK[a] - RANK[b]);
  if (sorted.length < 2) return GROWTH_LABEL[e.best];
  return `${GROWTH_LABEL[sorted[0]!]} to ${GROWTH_LABEL[sorted[sorted.length - 1]!]}`;
}

export type EstimateResult =
  | { status: "ok"; estimate: GrowthEstimate }
  | { status: "too_fast"; spreadMs: number }
  | { status: "not_enough_data"; points: number };

/** Below this growth above the fixed cost, the timer noise decides the answer. */
export const MIN_SPREAD_MS = 25;
/** The classes a timed run can tell apart. O(2^n) needs tiny sizes and is only ever claimed, not measured. */
const MEASURABLE: readonly GrowthId[] = ["n", "nlogn", "n2", "n3"];

const mean = (xs: readonly number[]) => xs.reduce((p, c) => p + c, 0) / xs.length;

/**
 * Which growth class do these measurements look like?
 *
 * Method: take the fixed cost (start-up) as the fastest run, then fit a straight line to log(time - fixed) against
 * log(n) with each point weighted by how far its signal is above the timer noise. The slope is the growth
 * exponent: about 1 for O(n), 2 for O(n²), 3 for O(n³). A class is plausible when its own slope over the same
 * range agrees with the measured one within the fit's error, so a noisy run answers with several classes and low
 * confidence instead of one confident wrong one.
 */
export function estimateGrowth(samples: readonly ScaleSample[]): EstimateResult {
  // a run that hit the time limit is only a lower bound, so it cannot sit on the line it would bend
  const pts = [...samples].filter((s) => s.n > 0 && !s.censored).sort((p, q) => p.n - q.n);
  if (pts.length < 4) return { status: "not_enough_data", points: pts.length };
  const base = Math.min(...pts.map((p) => p.timeMs));
  // the judge reports whole milliseconds and a run varies by a few percent of its fixed cost
  const noise = Math.max(2, 0.08 * base);
  const signal = Math.max(...pts.map((p) => p.timeMs)) - base;
  if (signal < Math.max(MIN_SPREAD_MS, 4 * noise)) return { status: "too_fast", spreadMs: signal };

  // points well above the noise carry the growth; the rest only carry the fixed cost
  let used = pts.filter((p) => p.timeMs - base >= Math.max(3 * noise, 8));
  if (used.length < 3) used = pts.filter((p) => p.timeMs - base > noise).slice(-3);
  if (used.length < 3) return { status: "not_enough_data", points: used.length };

  const xs = used.map((p) => Math.log(p.n));
  const ys = used.map((p) => Math.log(p.timeMs - base));
  // variance of log(y) is about (noise / y)^2, so the weight is (y / noise)^2
  const ws = used.map((p) => ((p.timeMs - base) / noise) ** 2);
  const sw = ws.reduce((p, c) => p + c, 0);
  const mx = ws.reduce((p, w, i) => p + w * xs[i]!, 0) / sw;
  const my = ws.reduce((p, w, i) => p + w * ys[i]!, 0) / sw;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < used.length; i++) {
    sxx += ws[i]! * (xs[i]! - mx) ** 2;
    sxy += ws[i]! * (xs[i]! - mx) * (ys[i]! - my);
  }
  if (sxx === 0) return { status: "not_enough_data", points: used.length };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let chi = 0;
  let sst = 0;
  for (let i = 0; i < used.length; i++) {
    chi += ws[i]! * (ys[i]! - (intercept + slope * xs[i]!)) ** 2;
    sst += ws[i]! * (ys[i]! - my) ** 2;
  }
  const dof = Math.max(1, used.length - 2);
  const slopeError = Math.sqrt(Math.max(1, chi / dof) / sxx);
  const r2 = sst === 0 ? 0 : Math.max(0, 1 - chi / sst);

  // what each class would show over the same range of sizes
  const first = used[0]!.n;
  const last = used[used.length - 1]!.n;
  const nominal = (id: GrowthId) =>
    Math.log(GROWTH_FN[id](last) / GROWTH_FN[id](first)) / Math.log(last / first);
  const tolerance = Math.max(0.2, 2 * slopeError);
  const plausible = MEASURABLE.filter((id) => Math.abs(nominal(id) - slope) <= tolerance);
  const closest = [...MEASURABLE].sort(
    (p, q) => Math.abs(nominal(p) - slope) - Math.abs(nominal(q) - slope),
  )[0]!;
  const candidates = plausible.length > 0 ? plausible : [closest];
  // prefer the simplest class that is not clearly too slow-growing for the measurement
  const best =
    candidates.find((id) => nominal(id) >= slope - 0.12) ??
    candidates.reduce((p, c) =>
      Math.abs(nominal(c) - slope) < Math.abs(nominal(p) - slope) ? c : p,
    );

  const strong = mean(used.map((p) => p.timeMs - base)) >= 10 * noise;
  const confidence: Confidence =
    slopeError < 0.12 && used.length >= 4 && strong
      ? "high"
      : slopeError < 0.25 && candidates.length <= 3
        ? "medium"
        : "low";
  return {
    status: "ok",
    estimate: { best, plausible: candidates, r2, confidence, slope, slopeError },
  };
}

// ---------------------------------------------------------------- claims

/** "O(n log n)", "n^2", "O(N²)", "o(2^n)" and so on; `null` when it is not a class we know. */
export function parseBigO(text: string): ClaimId | null {
  let t = text
    .toLowerCase()
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/ⁿ/g, "^n")
    .replace(/[\s*·×]/g, "")
    .replace(/log2?\(n\)/g, "logn")
    .replace(/log2n|lgn/g, "logn");
  const wrapped = /^o\((.*)\)$/.exec(t);
  if (wrapped) t = wrapped[1] ?? "";
  t = t.replace(/^\(|\)$/g, "");
  switch (t) {
    case "1":
      return "1";
    case "logn":
      return "logn";
    case "n":
      return "n";
    case "nlogn":
      return "nlogn";
    case "n^2":
    case "nn":
      return "n2";
    case "n^3":
      return "n3";
    case "2^n":
      return "2n";
    default:
      return null;
  }
}

export type ClaimVerdict =
  /** The measurement agrees with the claim. */
  | "matches"
  /** The code grows more slowly than claimed. */
  | "better"
  /** The code grows faster than claimed. */
  | "worse"
  /** A timed run cannot tell (claimed sublinear, or too little signal). */
  | "inconclusive";

export interface ClaimComparison {
  verdict: ClaimVerdict;
  claimed: ClaimId | null;
  measured: GrowthId | null;
  message: string;
}

export function compareClaim(
  claimedText: string,
  result: EstimateResult,
  hint?: { line: number; depth: number } | null,
): ClaimComparison {
  const claimed = parseBigO(claimedText);
  const claimedLabel = claimed ? GROWTH_LABEL[claimed] : claimedText.trim() || "no claim";
  if (result.status === "too_fast") {
    return {
      verdict: "inconclusive",
      claimed,
      measured: null,
      message: `Every run finished within ${result.spreadMs} ms of the others, which is too fast to tell growth classes apart. The solution is fast on the sizes tried; this is not a proof of ${claimedLabel}.`,
    };
  }
  if (result.status === "not_enough_data") {
    return {
      verdict: "inconclusive",
      claimed,
      measured: null,
      message: "Too few sizes finished to estimate the growth (some may have run out of time).",
    };
  }
  const { best, plausible, r2 } = result.estimate;
  const measuredLabel = describeGrowth(result.estimate);
  const r2Text = `R² = ${r2.toFixed(2)}`;
  if (!claimed) {
    return {
      verdict: "inconclusive",
      claimed,
      measured: best,
      message: `Measured growth looks like ${measuredLabel} (${r2Text}). Your claim "${claimedText.trim()}" is not a class this tool compares; try forms like O(n log n) or O(n^2).`,
    };
  }
  if (RANK[claimed] < RANK.n) {
    return {
      verdict: "inconclusive",
      claimed,
      measured: best,
      message: `You claimed ${claimedLabel}. A timed run includes reading the input, so it can only tell O(n) or faster apart from slower classes. Measured growth looks like ${measuredLabel} (${r2Text}).`,
    };
  }
  const claimedRank = RANK[claimed];
  if (plausible.includes(claimed as GrowthId)) {
    return {
      verdict: "matches",
      claimed,
      measured: best,
      message: `You claimed ${claimedLabel}. Measured growth looks like ${measuredLabel} (${r2Text}), which is consistent with your claim.`,
    };
  }
  const highest = Math.max(...plausible.map((p) => RANK[p]));
  if (highest < claimedRank) {
    return {
      verdict: "better",
      claimed,
      measured: best,
      message: `You claimed ${claimedLabel}. Measured growth looks like ${measuredLabel} (${r2Text}), better than claimed. Check that your claim is the tightest bound you can prove.`,
    };
  }
  const where =
    hint && hint.depth >= 2
      ? ` The loop on line ${hint.line} sits inside another loop, which likely causes this.`
      : "";
  return {
    verdict: "worse",
    claimed,
    measured: best,
    message: `You claimed ${claimedLabel}. Measured growth looks like ${measuredLabel} (${r2Text}).${where}`,
  };
}

// ---------------------------------------------------------------- static hints

export interface StaticHints {
  /** Deepest nesting of loops. */
  maxLoopDepth: number;
  /** 1-based line of the innermost loop at that depth (0 when there is no loop). */
  deepestLine: number;
  /** A function that calls itself. */
  recursion: boolean;
  /** What the loop nesting alone would suggest, as a growth class. */
  loopClass: GrowthId;
}

const PY_LOOP = /^(for|while)\b/;
const C_LOOP = /\b(for|while)\s*\(/;

function stripLine(line: string): string {
  return line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/\/\/.*$|#.*$/, "");
}

function pythonHints(
  code: string,
): Pick<StaticHints, "maxLoopDepth" | "deepestLine" | "recursion"> {
  const lines = code.split(/\r?\n/);
  const stack: Array<{ indent: number }> = [];
  let max = 0;
  let at = 0;
  const defs: Array<{ name: string; indent: number; recursive: boolean }> = [];
  const finished: boolean[] = [];
  lines.forEach((raw, i) => {
    const line = stripLine(raw);
    if (!line.trim()) return;
    const indent = line.length - line.trimStart().length;
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    while (defs.length > 0 && defs[defs.length - 1]!.indent >= indent) {
      finished.push(defs.pop()!.recursive);
    }
    const text = line.trim();
    const def = /^def\s+([A-Za-z_]\w*)\s*\(/.exec(text);
    if (def) defs.push({ name: def[1]!, indent, recursive: false });
    for (const d of defs) {
      if (new RegExp(`\\b${d.name}\\s*\\(`).test(text) && !(def && def[1] === d.name)) {
        d.recursive = true;
      }
    }
    if (PY_LOOP.test(text)) {
      stack.push({ indent });
      if (stack.length > max) {
        max = stack.length;
        at = i + 1;
      }
    }
  });
  for (const d of defs) finished.push(d.recursive);
  return { maxLoopDepth: max, deepestLine: at, recursion: finished.some(Boolean) };
}

function braceHints(code: string): Pick<StaticHints, "maxLoopDepth" | "deepestLine" | "recursion"> {
  const lines = code.split(/\r?\n/);
  let depth = 0;
  // brace depth at which each open loop body started
  const loops: number[] = [];
  let max = 0;
  let at = 0;
  const methods: Array<{ name: string; depth: number; recursive: boolean }> = [];
  const finished: boolean[] = [];
  lines.forEach((raw, i) => {
    const line = stripLine(raw);
    const method =
      /^\s*(?:[\w:<>,&*[\]\s]+?)\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const)?\s*(?:\{|$)/.exec(line);
    const isLoop = C_LOOP.test(line);
    if (method && !isLoop && !/^\s*(if|else|switch|return|catch)\b/.test(line)) {
      methods.push({ name: method[1]!, depth, recursive: false });
    }
    for (const m of methods) {
      const calls = [...line.matchAll(new RegExp(`\\b${m.name}\\s*\\(`, "g"))].length;
      const declared = method && method[1] === m.name ? 1 : 0;
      if (calls > declared) m.recursive = true;
    }
    if (isLoop) {
      loops.push(depth);
      if (loops.length > max) {
        max = loops.length;
        at = i + 1;
      }
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        while (loops.length > 0 && loops[loops.length - 1]! >= depth) loops.pop();
        while (methods.length > 0 && methods[methods.length - 1]!.depth >= depth) {
          finished.push(methods.pop()!.recursive);
        }
      }
    }
  });
  for (const m of methods) finished.push(m.recursive);
  return { maxLoopDepth: max, deepestLine: at, recursion: finished.some(Boolean) };
}

/** A rough, syntax-level cross-check of the measurement (loop nesting and self calls). */
export function staticHints(language: "python" | "cpp" | "java", code: string): StaticHints {
  const base = language === "python" ? pythonHints(code) : braceHints(code);
  const loopClass: GrowthId = base.maxLoopDepth >= 3 ? "n3" : base.maxLoopDepth === 2 ? "n2" : "n";
  return { ...base, loopClass };
}
