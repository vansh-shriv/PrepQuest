// Scaling inputs for the complexity analyzer (X4): a small declarative description, written per problem in
// `content/problems/<slug>/scale.json`, that builds a canonical-format input of a chosen size. Pure and
// seeded, so the same size always gives the same bytes. The text format is the one in `packages/content/src/codec.ts`.

export type ScaleArg =
  /** A fixed value, or `scale` times the size. */
  | { kind: "int"; value: number }
  | { kind: "int"; scale: number; min?: number }
  /** Length is `scale` times the size (default 1). */
  | {
      kind: "ints";
      scale?: number;
      /** A fixed length instead of one that follows the size. */
      length?: number;
      min: number;
      max: number;
      order?: "random" | "sorted" | "descending" | "distinct" | "constant";
    }
  | {
      kind: "string";
      scale?: number;
      alphabet: string;
      /** `balanced` reads the alphabet as open/close pairs, e.g. "()[]". */
      shape?: "random" | "palindrome" | "balanced";
    }
  /** `count` strings (times the size) of a fixed length that share a prefix. */
  | { kind: "strings"; scale?: number; length: number; alphabet: string; shared?: number }
  /** A square grid of side sqrt(size) given as rows of characters. */
  | { kind: "grid"; chars: string; density?: number }
  /** `count` (times the size) intervals `[start, end]`. */
  | { kind: "intervals"; scale?: number; max: number };

export interface ScaleSpec {
  /** Sizes to run, ascending. */
  sizes: number[];
  /** One entry per parameter of the problem, by name. */
  args: Record<string, ScaleArg>;
}

/** The largest input the analyzer will build. */
export const MAX_SCALE_BYTES = 2 * 1024 * 1024;

const ARG_TYPES: Record<ScaleArg["kind"], readonly string[]> = {
  int: ["int", "long"],
  ints: ["int[]", "long[]"],
  string: ["string"],
  strings: ["string[]"],
  grid: ["string[]"],
  intervals: ["int[][]"],
};

export interface ScaleParam {
  name: string;
  type: string;
}

/** Problems with the spec, in plain words (empty when it fits the signature). */
export function scaleIssues(spec: ScaleSpec, params: readonly ScaleParam[]): string[] {
  const issues: string[] = [];
  if (spec.sizes.length < 5) issues.push("at least 5 sizes are needed to fit a growth curve");
  if (
    spec.sizes.some((n, i) => !Number.isInteger(n) || n < 1 || (i > 0 && n <= spec.sizes[i - 1]!))
  ) {
    issues.push("sizes must be positive whole numbers in ascending order");
  }
  const names = new Set(params.map((p) => p.name));
  for (const p of params) {
    const arg = spec.args[p.name];
    if (!arg) issues.push(`no generator for parameter "${p.name}"`);
    else if (!ARG_TYPES[arg.kind].includes(p.type)) {
      issues.push(`generator "${arg.kind}" cannot make "${p.name}" of type ${p.type}`);
    }
  }
  for (const k of Object.keys(spec.args)) {
    if (!names.has(k)) issues.push(`generator for unknown parameter "${k}"`);
  }
  for (const [k, a] of Object.entries(spec.args)) {
    if ((a.kind === "ints" && a.min > a.max) || (a.kind === "string" && a.alphabet.length === 0)) {
      issues.push(`generator "${k}" has an empty range`);
    }
  }
  return issues;
}

/** Deterministic pseudo-random numbers in [0, 1). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lengthOf = (scale: number | undefined, n: number) =>
  Math.max(1, Math.floor(n * (scale ?? 1)));

function makeInts(
  arg: Extract<ScaleArg, { kind: "ints" }>,
  n: number,
  rand: () => number,
): number[] {
  const len = arg.length ?? lengthOf(arg.scale, n);
  const span = arg.max - arg.min + 1;
  const pick = () => arg.min + Math.floor(rand() * span);
  const order = arg.order ?? "random";
  if (order === "constant") return Array.from({ length: len }, () => arg.min);
  if (order === "distinct") {
    // a shuffled run of consecutive values (needs the range to hold `len` of them)
    const count = Math.min(len, span);
    const values = Array.from({ length: count }, (_, i) => arg.min + i);
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [values[i], values[j]] = [values[j]!, values[i]!];
    }
    return values;
  }
  const values = Array.from({ length: len }, pick);
  if (order === "sorted") values.sort((p, q) => p - q);
  if (order === "descending") values.sort((p, q) => q - p);
  return values;
}

function pickChar(alphabet: string, rand: () => number) {
  return alphabet[Math.floor(rand() * alphabet.length)] ?? "a";
}

/** The argument text for one parameter, in the canonical input format. */
function argText(arg: ScaleArg, n: number, rand: () => number): string {
  switch (arg.kind) {
    case "int":
      return String("value" in arg ? arg.value : Math.max(arg.min ?? 1, Math.floor(n * arg.scale)));
    case "ints": {
      const v = makeInts(arg, n, rand);
      return `${v.length}\n${v.join(" ")}`;
    }
    case "string": {
      const len = lengthOf(arg.scale, n);
      if (arg.shape === "balanced") {
        const pairs = Math.floor(arg.alphabet.length / 2);
        const open: string[] = [];
        let out = "";
        for (let i = 0; i < len; i++) {
          const remaining = len - i;
          if (open.length > 0 && (open.length >= remaining || rand() < 0.5)) {
            out += open.pop()!;
          } else {
            const k = Math.floor(rand() * pairs);
            out += arg.alphabet[2 * k];
            open.push(arg.alphabet[2 * k + 1] ?? "");
          }
        }
        return out;
      }
      if (arg.shape === "palindrome") {
        const half = Array.from({ length: Math.ceil(len / 2) }, () => pickChar(arg.alphabet, rand));
        const s = half.join("");
        return (
          s +
          [...s]
            .slice(0, Math.floor(len / 2))
            .reverse()
            .join("")
        );
      }
      return Array.from({ length: len }, () => pickChar(arg.alphabet, rand)).join("");
    }
    case "strings": {
      const count = lengthOf(arg.scale, n);
      const shared = Math.min(arg.shared ?? 0, arg.length);
      const prefix = Array.from({ length: shared }, () => pickChar(arg.alphabet, rand)).join("");
      const rows = Array.from(
        { length: count },
        () =>
          prefix +
          Array.from({ length: arg.length - shared }, () => pickChar(arg.alphabet, rand)).join(""),
      );
      return `${count}\n${rows.join("\n")}`;
    }
    case "grid": {
      const side = Math.max(1, Math.floor(Math.sqrt(n)));
      const density = arg.density ?? 0.5;
      const rows = Array.from({ length: side }, () =>
        Array.from({ length: side }, () =>
          rand() < density ? (arg.chars[1] ?? "1") : (arg.chars[0] ?? "0"),
        ).join(""),
      );
      return `${side}\n${rows.join("\n")}`;
    }
    case "intervals": {
      const count = lengthOf(arg.scale, n);
      const rows = Array.from({ length: count }, () => {
        const a = Math.floor(rand() * arg.max);
        const b = a + Math.floor(rand() * Math.max(1, arg.max / 20));
        return `2 ${a} ${Math.min(arg.max, b)}`;
      });
      return `${count}\n${rows.join("\n")}`;
    }
  }
}

/** The whole input for one size: arguments in signature order, one after another. */
export function buildScaledInput(
  spec: ScaleSpec,
  params: readonly ScaleParam[],
  n: number,
  seed = 1,
): string {
  const rand = mulberry32(seed + n);
  const parts = params.map((p) => {
    const arg = spec.args[p.name];
    if (!arg) throw new Error(`no generator for parameter "${p.name}"`);
    return argText(arg, n, rand);
  });
  const text = `${parts.join("\n")}\n`;
  if (text.length > MAX_SCALE_BYTES) {
    throw new Error(`the input for size ${n} is larger than ${MAX_SCALE_BYTES} bytes`);
  }
  return text;
}
