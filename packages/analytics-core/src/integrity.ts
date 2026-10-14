// Integrity signals (X2): code similarity by winnowing, behaviour counts and a weak style marker. Pure. These
// produce evidence for a human reviewer; nothing here decides a penalty.

export type CodeLanguage = "python" | "cpp" | "java";

const KEYWORDS: Record<CodeLanguage, ReadonlySet<string>> = {
  python: new Set(
    "and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None".split(
      " ",
    ),
  ),
  cpp: new Set(
    "auto bool break case catch char class const continue default delete do double else enum false float for if int long namespace new nullptr private public return short signed sizeof static struct switch template this throw true try typedef typename unsigned using virtual void while".split(
      " ",
    ),
  ),
  java: new Set(
    "abstract boolean break byte case catch char class continue default do double else enum extends false final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true try void while".split(
      " ",
    ),
  ),
};

/**
 * The code as a stream of normalised tokens: comments and whitespace gone, every name `I`, every number `N`,
 * every string `S`. Keywords, operators and punctuation stay, so renaming variables or changing comments does
 * not change the stream, but the shape of the program does.
 */
export function normalizeTokens(language: CodeLanguage, code: string): string[] {
  return lex(language, code).tokens;
}

/** The normalised tokens and the character offset each one starts at. */
export function lex(language: CodeLanguage, code: string): { tokens: string[]; starts: number[] } {
  const keywords = KEYWORDS[language];
  const tokens: string[] = [];
  const starts: number[] = [];
  let i = 0;
  const push = (t: string) => {
    tokens.push(t);
    starts.push(i);
  };
  const n = code.length;
  while (i < n) {
    const c = code[i]!;
    const next = code[i + 1];
    if (/\s/.test(c)) {
      i++;
    } else if ((language === "python" && c === "#") || (c === "/" && next === "/")) {
      while (i < n && code[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else if (language === "python" && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
      const quote = code.slice(i, i + 3);
      const end = code.indexOf(quote, i + 3);
      push("S");
      i = end < 0 ? n : end + 3;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      push("S");
      i = j + 1;
    } else if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9a-zA-Z_.]/.test(code[j]!)) j++;
      push("N");
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(code[j]!)) j++;
      const word = code.slice(i, j);
      push(keywords.has(word) ? word : "I");
      i = j;
    } else {
      // two-character operators count as one token (==, <=, +=, ->, ::, &&, ||)
      const two = code.slice(i, i + 2);
      if (/^(==|!=|<=|>=|\+=|-=|\*=|\/=|%=|->|::|&&|\|\||<<|>>|\+\+|--|\/\/|\*\*)$/.test(two)) {
        push(two);
        i += 2;
      } else {
        push(c);
        i++;
      }
    }
  }
  return { tokens, starts };
}

/** The 1-based lines of `code` covered by token ranges (as `similarity` reports them). */
export function linesOfRanges(
  language: CodeLanguage,
  code: string,
  ranges: ReadonlyArray<{ from: number; to: number }>,
): number[] {
  const { starts } = lex(language, code);
  const lineAt = (offset: number) => code.slice(0, offset).split("\n").length;
  const lines = new Set<number>();
  for (const r of ranges) {
    for (let t = r.from; t <= Math.min(r.to, starts.length - 1); t++) lines.add(lineAt(starts[t]!));
  }
  return [...lines].sort((a, b) => a - b);
}

const K = 5;
const WINDOW = 4;

function hashGram(tokens: readonly string[], from: number): number {
  // FNV-1a over the token texts
  let h = 0x811c9dc5;
  for (let t = from; t < from + K; t++) {
    const s = tokens[t]!;
    for (let c = 0; c < s.length; c++) {
      h ^= s.charCodeAt(c);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x7c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface Fingerprint {
  /** Selected hashes with the token position each came from. */
  marks: Array<{ hash: number; at: number }>;
  tokenCount: number;
}

/** Winnowing: of every window of `WINDOW` k-gram hashes keep the smallest (the rightmost on ties). */
export function fingerprint(language: CodeLanguage, code: string): Fingerprint {
  const tokens = normalizeTokens(language, code);
  const grams: number[] = [];
  for (let i = 0; i + K <= tokens.length; i++) grams.push(hashGram(tokens, i));
  const marks: Fingerprint["marks"] = [];
  let lastAt = -1;
  for (let w = 0; w + WINDOW <= grams.length; w++) {
    let min = w;
    for (let j = w + 1; j < w + WINDOW; j++) if (grams[j]! <= grams[min]!) min = j;
    if (min !== lastAt) {
      marks.push({ hash: grams[min]!, at: min });
      lastAt = min;
    }
  }
  if (marks.length === 0 && grams.length > 0) marks.push({ hash: Math.min(...grams), at: 0 });
  return { marks, tokenCount: tokens.length };
}

/** Programs shorter than this many tokens are too small to say anything: many honest answers look alike. */
export const MIN_TOKENS = 60;
/** Fewer selected hashes than this and a match is chance. */
export const MIN_MARKS = 15;

export interface SimilarityResult {
  /** Share of the smaller program's fingerprints found in the other (0 to 1). */
  score: number;
  shared: number;
  /** Too short to compare. */
  trivial: boolean;
  /** Token ranges of `a` that matched, merged. */
  ranges: Array<{ from: number; to: number }>;
}

/**
 * How much of the smaller program appears in the other. Hashes that come from the starter code are ignored
 * (everyone starts from it) via `boilerplate`.
 */
export function similarity(
  a: Fingerprint,
  b: Fingerprint,
  boilerplate: ReadonlySet<number> = new Set(),
): SimilarityResult {
  const keep = (f: Fingerprint) => f.marks.filter((m) => !boilerplate.has(m.hash));
  const ma = keep(a);
  const mb = keep(b);
  if (
    Math.min(a.tokenCount, b.tokenCount) < MIN_TOKENS ||
    Math.min(ma.length, mb.length) < MIN_MARKS
  ) {
    return { score: 0, shared: 0, trivial: true, ranges: [] };
  }
  const setB = new Set(mb.map((m) => m.hash));
  const hits = ma.filter((m) => setB.has(m.hash));
  const sharedHashes = new Set(hits.map((m) => m.hash));
  const setA = new Set(ma.map((m) => m.hash));
  const shared = [...setA].filter((h) => setB.has(h)).length;
  const score = shared / Math.min(setA.size, new Set(mb.map((m) => m.hash)).size);
  const ranges: SimilarityResult["ranges"] = [];
  for (const m of a.marks.filter((x) => sharedHashes.has(x.hash)).sort((p, q) => p.at - q.at)) {
    const last = ranges[ranges.length - 1];
    if (last && m.at <= last.to + 1) last.to = Math.max(last.to, m.at + K - 1);
    else ranges.push({ from: m.at, to: m.at + K - 1 });
  }
  return { score: Math.min(1, score), shared, trivial: false, ranges };
}

/** The set of hashes in a piece of code, e.g. the starter template. */
export function hashSet(language: CodeLanguage, code: string): Set<number> {
  return new Set(fingerprint(language, code).marks.map((m) => m.hash));
}

// ---------------------------------------------------------------- flags

export type FlagSeverity = "low" | "medium" | "high";
const ORDER: FlagSeverity[] = ["low", "medium", "high"];

/** A similarity score becomes a severity only when it is clearly beyond what honest answers share. */
export function similaritySeverity(score: number): FlagSeverity | null {
  if (score >= 0.95) return "high";
  if (score >= 0.85) return "medium";
  return null;
}

export interface BehaviorCounts {
  blur: number;
  paste: number;
}

/** Paste and focus-loss counts over a whole contest: weak signals, low or medium at most. */
export function behaviorSignals(counts: BehaviorCounts): {
  paste: FlagSeverity | null;
  focus: FlagSeverity | null;
} {
  const paste = counts.paste >= 10 ? "medium" : counts.paste >= 4 ? "low" : null;
  const focus = counts.blur >= 40 ? "medium" : counts.blur >= 15 ? "low" : null;
  return { paste, focus };
}

/** One level up when several independent signals agree. */
export function raise(severity: FlagSeverity, by = 1): FlagSeverity {
  return ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(severity) + by)]!;
}

/**
 * A weak marker of machine-written style: many full-sentence comments on short code. It is only ever shown
 * next to stronger evidence, never as a flag of its own.
 */
export function aiStyleMarker(
  language: CodeLanguage,
  code: string,
): { marked: boolean; comments: number } {
  const lines = code.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const comment =
    language === "python" ? /^\s*#\s*[A-Z].{25,}[.:]\s*$/ : /^\s*\/\/\s*[A-Z].{25,}[.:]\s*$/;
  const comments = lines.filter((l) => comment.test(l)).length;
  return { marked: lines.length > 0 && comments >= 4 && comments / lines.length >= 0.3, comments };
}
