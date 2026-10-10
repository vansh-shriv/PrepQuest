import type { CheckerConfig } from "./types.js";

export interface CheckResult {
  ok: boolean;
  /** Human-readable reason. May quote the expected output, so only show it for visible tests. */
  message?: string;
}

const DEFAULT_EPSILON = 1e-6;

/** Doc 12 §6: `\r\n` -> `\n`, trailing whitespace per line and trailing blank lines are ignored. */
export function normalizeExact(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const tokens = (text: string): string[] => text.split(/\s+/).filter((t) => t !== "");

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}...` : s);

function checkExact(expected: string, actual: string): CheckResult {
  const e = normalizeExact(expected);
  const a = normalizeExact(actual);
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if (e[i] !== a[i]) {
      if (i >= a.length)
        return { ok: false, message: `Output ends early: line ${i + 1} is missing.` };
      if (i >= e.length) return { ok: false, message: `Extra output starting at line ${i + 1}.` };
      return {
        ok: false,
        message: `Line ${i + 1}: expected "${clip(e[i] ?? "")}" but got "${clip(a[i] ?? "")}".`,
      };
    }
  }
  return { ok: true };
}

function checkTokens(
  expected: string,
  actual: string,
  same: (e: string, a: string) => boolean,
): CheckResult {
  const e = tokens(expected);
  const a = tokens(actual);
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if (i >= a.length)
      return {
        ok: false,
        message: `Output ends early: expected ${e.length} values, got ${a.length}.`,
      };
    if (i >= e.length)
      return { ok: false, message: `Extra output: expected ${e.length} values, got ${a.length}.` };
    if (!same(e[i] as string, a[i] as string)) {
      return {
        ok: false,
        message: `Value ${i + 1}: expected "${clip(e[i] as string)}" but got "${clip(a[i] as string)}".`,
      };
    }
  }
  return { ok: true };
}

function floatEqual(epsilon: number) {
  return (e: string, a: string) => {
    if (e === a) return true;
    const x = Number(e);
    const y = Number(a);
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    const diff = Math.abs(x - y);
    return diff <= epsilon || diff <= epsilon * Math.abs(x);
  };
}

function checkUnordered(expected: string, actual: string): CheckResult {
  const e = tokens(expected).sort();
  const a = tokens(actual).sort();
  return checkTokens(e.join(" "), a.join(" "), (x, y) => x === y);
}

/** Compares a contestant's output with the jury's. `special` checkers need a sandboxed program (later). */
export function check(config: CheckerConfig, expected: string, actual: string): CheckResult {
  switch (config.type) {
    case "exact":
      return checkExact(expected, actual);
    case "tokens":
      return checkTokens(expected, actual, (e, a) => e === a);
    case "float":
      return checkTokens(expected, actual, floatEqual(config.epsilon ?? DEFAULT_EPSILON));
    case "unordered":
      return checkUnordered(expected, actual);
    case "special":
      throw new Error("special checkers are not supported yet");
  }
}
