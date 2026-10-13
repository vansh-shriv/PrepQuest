import { describe, expect, it } from "vitest";
import { compareResults, guardQuery } from "./sql.js";

describe("guardQuery", () => {
  it("accepts reads and trims a trailing semicolon", () => {
    expect(guardQuery("  SELECT 1;  ")).toEqual({ ok: true, query: "SELECT 1" });
    expect(guardQuery("with a as (select 1) select * from a").ok).toBe(true);
    expect(guardQuery("EXPLAIN QUERY PLAN SELECT 1").ok).toBe(true);
  });
  it("rejects writes, pragmas and several statements", () => {
    for (const q of [
      "DELETE FROM t",
      "pragma table_info(t)",
      "SELECT 1; DROP TABLE t",
      "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x",
      "ATTACH DATABASE 'a' AS b",
      "",
      "-- only a comment",
    ]) {
      expect(guardQuery(q).ok, q).toBe(false);
    }
  });
  it("ignores keywords inside strings, quoted names and comments", () => {
    expect(guardQuery("SELECT 'delete; drop' AS \"update\" -- insert\nFROM t").ok).toBe(true);
    expect(guardQuery("SELECT * FROM t /* ; delete */").ok).toBe(true);
  });
});

describe("compareResults", () => {
  const want = {
    columns: ["a", "b"],
    rows: [
      [1, "x"],
      [2, null],
    ],
  };
  it("ignores column names and, by default, row order", () => {
    const got = {
      columns: ["p", "q"],
      rows: [
        [2, null],
        [1, "x"],
      ],
    };
    expect(compareResults(got, want, { orderSensitive: false }).verdict).toBe("AC");
    expect(compareResults(got, want, { orderSensitive: true }).verdict).toBe("WA");
  });
  it("treats NULL as equal to NULL but not to empty text or zero", () => {
    const got = {
      columns: ["a", "b"],
      rows: [
        [1, "x"],
        [2, ""],
      ],
    };
    expect(compareResults(got, want, { orderSensitive: false }).verdict).toBe("WA");
  });
  it("compares numbers to nine places", () => {
    const a = { columns: ["v"], rows: [[0.1 + 0.2]] };
    const b = { columns: ["v"], rows: [[0.3]] };
    expect(compareResults(a, b, { orderSensitive: true }).verdict).toBe("AC");
  });
  it("says what is off", () => {
    expect(
      compareResults({ columns: ["a"], rows: [] }, want, { orderSensitive: false }).reason,
    ).toMatch(/2 columns/);
    expect(
      compareResults({ columns: ["a", "b"], rows: [[1, "x"]] }, want, { orderSensitive: false })
        .reason,
    ).toMatch(/Expected 2 rows, got 1/);
  });
  it("respects duplicates", () => {
    const d = { columns: ["a"], rows: [[1], [1], [2]] };
    const e = { columns: ["a"], rows: [[1], [2], [2]] };
    expect(compareResults(d, e, { orderSensitive: false }).verdict).toBe("WA");
  });
});
