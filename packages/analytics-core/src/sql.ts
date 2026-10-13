// SQL practice (C1): which statements a learner may run, and how a result is compared with the expected one.
// Pure: the runner executes, the API stores.

const FORBIDDEN = new Set([
  "insert",
  "update",
  "delete",
  "drop",
  "create",
  "alter",
  "replace",
  "attach",
  "detach",
  "pragma",
  "vacuum",
  "reindex",
  "analyze",
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "release",
]);

/** Removes comments and the contents of string literals and quoted identifiers, keeping their quotes. */
function skeleton(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) {
          if (sql[j + 1] === close && c !== "[") j += 2;
          else break;
        } else j++;
      }
      out += `${c}${close}`;
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export type GuardResult = { ok: true; query: string } | { ok: false; reason: string };

/** Accepts one read-only statement: SELECT, WITH ... SELECT, or EXPLAIN QUERY PLAN. */
export function guardQuery(raw: string): GuardResult {
  const query = raw.trim().replace(/;+\s*$/, "");
  if (query === "") return { ok: false, reason: "Write a query first." };
  const flat = skeleton(query);
  if (flat.includes(";")) return { ok: false, reason: "Run one statement at a time." };
  const words = flat.toLowerCase().match(/[a-z_]+/g) ?? [];
  const first = words[0];
  const explain = first === "explain" && words[1] === "query" && words[2] === "plan";
  if (first !== "select" && first !== "with" && !explain) {
    return { ok: false, reason: "Only SELECT queries can be run here." };
  }
  const bad = words.find((w) => FORBIDDEN.has(w));
  if (bad)
    return {
      ok: false,
      reason: `"${bad.toUpperCase()}" is not allowed: queries here only read data.`,
    };
  return { ok: true, query };
}

export type SqlCell = string | number | null;

export interface ResultSet {
  columns: string[];
  rows: SqlCell[][];
}

export type SqlVerdict = "AC" | "WA" | "ERROR";

export interface Comparison {
  verdict: "AC" | "WA";
  /** Short, learner-facing reason when wrong. */
  reason: string | null;
}

const canon = (v: SqlCell): string =>
  v === null
    ? "N"
    : typeof v === "number"
      ? // Numbers match to 9 decimal places, so 2.50 equals 2.5 and sums of floats are not penalised.
        `n${Number(v.toFixed(9))}`
      : `s${v}`;

const rowKey = (r: SqlCell[]) => r.map(canon).join("\u0001");

/**
 * Compares by position, not by column name (aliases are free). NULL equals NULL. Unless the problem is
 * order sensitive, rows are compared as a multiset.
 */
export function compareResults(
  got: ResultSet,
  want: ResultSet,
  opts: { orderSensitive: boolean },
): Comparison {
  if (got.columns.length !== want.columns.length) {
    return {
      verdict: "WA",
      reason: `Expected ${want.columns.length} column${want.columns.length === 1 ? "" : "s"}, got ${got.columns.length}.`,
    };
  }
  if (got.rows.length !== want.rows.length) {
    return {
      verdict: "WA",
      reason: `Expected ${want.rows.length} row${want.rows.length === 1 ? "" : "s"}, got ${got.rows.length}.`,
    };
  }
  const a = got.rows.map(rowKey);
  const b = want.rows.map(rowKey);
  if (opts.orderSensitive) {
    const at = a.findIndex((k, i) => k !== b[i]);
    return at === -1
      ? { verdict: "AC", reason: null }
      : { verdict: "WA", reason: `Row ${at + 1} differs (this problem checks the order).` };
  }
  const left = new Map<string, number>();
  for (const k of b) left.set(k, (left.get(k) ?? 0) + 1);
  for (const k of a) {
    const n = left.get(k) ?? 0;
    if (n === 0) return { verdict: "WA", reason: "The rows are not the same as expected." };
    left.set(k, n - 1);
  }
  return { verdict: "AC", reason: null };
}
