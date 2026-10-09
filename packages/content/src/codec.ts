import type { ParamType, Signature } from "./types.js";

/**
 * Canonical text format for test inputs and outputs (doc 12 driver contract). Every function-style
 * problem reads its arguments from stdin and prints its return value to stdout in this format:
 *
 *   int / long / double / bool   one line: `42`, `-7`, `0.5`, `true`
 *   string                        one line holding the raw text (no newline characters allowed)
 *   T[]  (T a number or bool)     line 1: n; line 2: the n values separated by single spaces (empty line when n = 0)
 *   string[]                      line 1: n; then n lines, one string each
 *   T[][]                         line 1: r; then r lines of `k v1 .. vk`
 *
 * The input file is the arguments concatenated in signature order; the output file is the return value.
 * Drivers in every language implement exactly this, and `packages/content/python/harness.py` is the
 * reference implementation used to build and verify expected outputs.
 */

export class CodecError extends Error {}

const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;
const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

type Scalar = "int" | "long" | "double" | "bool" | "string";

function split(type: ParamType): { base: Scalar; dims: 0 | 1 | 2 } {
  const dims = (type.match(/\[\]/g) ?? []).length as 0 | 1 | 2;
  return { base: type.replace(/\[\]/g, "") as Scalar, dims };
}

// ---------------------------------------------------------------- scalars

function encodeScalar(base: Scalar, value: unknown, what: string): string {
  switch (base) {
    case "int":
    case "long": {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new CodecError(`${what}: expected an integer (JSON numbers are exact up to 2^53)`);
      }
      if (base === "int" && (value < INT_MIN || value > INT_MAX)) {
        throw new CodecError(`${what}: ${value} is outside the int range`);
      }
      return String(value);
    }
    case "double":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new CodecError(`${what}: expected a finite number`);
      }
      return String(value);
    case "bool":
      if (typeof value !== "boolean") throw new CodecError(`${what}: expected a boolean`);
      return value ? "true" : "false";
    case "string":
      if (typeof value !== "string") throw new CodecError(`${what}: expected a string`);
      if (/[\r\n]/.test(value)) throw new CodecError(`${what}: strings cannot contain line breaks`);
      return value;
  }
}

function parseScalar(base: Scalar, token: string, what: string): number | boolean | string {
  switch (base) {
    case "int":
    case "long": {
      if (!/^-?\d+$/.test(token)) throw new CodecError(`${what}: "${token}" is not an integer`);
      const big = BigInt(token);
      if (
        base === "int"
          ? big < BigInt(INT_MIN) || big > BigInt(INT_MAX)
          : big < LONG_MIN || big > LONG_MAX
      ) {
        throw new CodecError(`${what}: ${token} is out of range for ${base}`);
      }
      return Number(big);
    }
    case "double": {
      const n = Number(token);
      if (token.trim() === "" || !Number.isFinite(n))
        throw new CodecError(`${what}: "${token}" is not a number`);
      return n;
    }
    case "bool":
      if (token !== "true" && token !== "false")
        throw new CodecError(`${what}: "${token}" is not true/false`);
      return token === "true";
    case "string":
      return token;
  }
}

// ---------------------------------------------------------------- encode

/** Encodes one value to canonical lines (each ending with a newline). */
export function encodeValue(type: ParamType, value: unknown, what = "value"): string {
  const { base, dims } = split(type);
  if (dims === 0) return `${encodeScalar(base, value, what)}\n`;

  if (!Array.isArray(value)) throw new CodecError(`${what}: expected an array`);
  if (dims === 1) {
    const items = value.map((v, i) => encodeScalar(base, v, `${what}[${i}]`));
    return base === "string"
      ? `${items.length}\n${items.map((s) => `${s}\n`).join("")}`
      : `${items.length}\n${items.join(" ")}\n`;
  }

  const rows = value.map((row, r) => {
    if (!Array.isArray(row)) throw new CodecError(`${what}[${r}]: expected an array`);
    const items = row.map((v, i) => encodeScalar(base, v, `${what}[${r}][${i}]`));
    return [row.length, ...items].join(" ");
  });
  return `${rows.length}\n${rows.map((l) => `${l}\n`).join("")}`;
}

/** The `.in` file for a call: arguments in signature order. */
export function encodeInput(signature: Signature, args: unknown[]): string {
  if (args.length !== signature.params.length) {
    throw new CodecError(`expected ${signature.params.length} argument(s), got ${args.length}`);
  }
  return signature.params.map((p, i) => encodeValue(p.type, args[i], p.name)).join("");
}

export function encodeOutput(signature: Signature, value: unknown): string {
  return encodeValue(signature.returns, value, "return value");
}

// ---------------------------------------------------------------- parse (strict)

class Reader {
  private pos = 0;
  constructor(private readonly lines: string[]) {}

  next(what: string): string {
    const line = this.lines[this.pos];
    if (line === undefined) throw new CodecError(`${what}: unexpected end of input`);
    this.pos++;
    return line;
  }

  finish(): void {
    const rest = this.lines.slice(this.pos).findIndex((l) => l !== "");
    if (rest !== -1) throw new CodecError(`unexpected extra data at line ${this.pos + rest + 1}`);
  }
}

function toLines(text: string): string[] {
  if (text.includes("\r"))
    throw new CodecError("carriage returns are not allowed (use \\n line endings)");
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function readCount(reader: Reader, what: string): number {
  const line = reader.next(`${what} length`);
  if (!/^\d+$/.test(line))
    throw new CodecError(`${what}: length "${line}" is not a non-negative integer`);
  return Number(line);
}

function readValue(reader: Reader, type: ParamType, what: string): unknown {
  const { base, dims } = split(type);
  if (dims === 0) return parseScalar(base, reader.next(what), what);

  const n = readCount(reader, what);
  if (dims === 1) {
    if (base === "string") return Array.from({ length: n }, (_, i) => reader.next(`${what}[${i}]`));
    const line = reader.next(`${what} values`);
    const tokens = line === "" ? [] : line.split(" ");
    if (tokens.length !== n)
      throw new CodecError(`${what}: expected ${n} value(s), found ${tokens.length}`);
    return tokens.map((t, i) => parseScalar(base, t, `${what}[${i}]`));
  }

  return Array.from({ length: n }, (_, r) => {
    const tokens = reader.next(`${what}[${r}]`).split(" ");
    const k = Number(tokens[0]);
    if (!/^\d+$/.test(tokens[0] ?? "") || tokens.length !== k + 1) {
      throw new CodecError(`${what}[${r}]: row must be "k v1 .. vk" with k values`);
    }
    return tokens.slice(1).map((t, i) => parseScalar(base, t, `${what}[${r}][${i}]`));
  });
}

/** Parses and validates a `.in` file against the signature. Throws CodecError with a precise message. */
export function parseInput(signature: Signature, text: string): unknown[] {
  const reader = new Reader(toLines(text));
  const args = signature.params.map((p) => readValue(reader, p.type, p.name));
  reader.finish();
  return args;
}

/** Parses and validates a `.out` file against the return type. */
export function parseOutput(signature: Signature, text: string): unknown {
  const reader = new Reader(toLines(text));
  const value = readValue(reader, signature.returns, "return value");
  reader.finish();
  return value;
}
