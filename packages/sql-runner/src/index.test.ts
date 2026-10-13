import { describe, expect, it } from "vitest";
import { describeDataset, runQuery } from "./index.js";

const ds = {
  schema: "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL);",
  seed: "INSERT INTO t VALUES (1,'a',1.5),(2,'b',NULL),(3,'c',3);",
};

describe("sql runner", () => {
  it("returns columns, rows and NULLs", async () => {
    const r = await runQuery(ds, "SELECT id, score FROM t ORDER BY id");
    expect(r.ok).toBe(true);
    expect(r.columns).toEqual(["id", "score"]);
    expect(r.rows).toEqual([
      [1, 1.5],
      [2, null],
      [3, 3],
    ]);
  });

  it("reports SQL errors", async () => {
    const r = await runQuery(ds, "SELECT nope FROM t");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no such column/i);
  });

  it("caps rows and says so", async () => {
    const r = await runQuery(
      ds,
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 5000) SELECT i FROM n",
      { maxRows: 50 },
    );
    expect(r.rows).toHaveLength(50);
    expect(r.truncated).toBe(true);
  });

  it("stops a runaway query", async () => {
    const r = await runQuery(
      ds,
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n) SELECT count(*) FROM n",
      { timeoutMs: 400 },
    );
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("starts every run from a fresh dataset and refuses writes", async () => {
    const w = await runQuery(ds, "DELETE FROM t");
    expect(w.ok).toBe(false);
    const r = await runQuery(ds, "SELECT count(*) FROM t");
    expect(r.rows).toEqual([[3]]);
  });

  it("describes tables with a preview", async () => {
    const tables = await describeDataset(ds, 2);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.columns.map((c) => c.name)).toEqual(["id", "name", "score"]);
    expect(tables[0]!.rowCount).toBe(3);
    expect(tables[0]!.preview).toHaveLength(2);
  });
});
