import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestApp, signupAndLogin, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.close());

describe("database schema guards", () => {
  it("every table with updated_at has the set_updated_at trigger (new tables must add one)", async () => {
    const res = await t.pool.query(`
      SELECT c.table_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger tg
          JOIN pg_class cl ON cl.oid = tg.tgrelid
          JOIN pg_proc pr ON pr.oid = tg.tgfoid
          WHERE cl.relname = c.table_name AND pr.proname = 'set_updated_at' AND NOT tg.tgisinternal
        )`);
    expect(res.rows.map((r) => r.table_name)).toEqual([]);
  });

  it("every table has created_at and updated_at", async () => {
    const res = await t.pool.query(`
      SELECT table_name FROM information_schema.tables t
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND (SELECT count(*) FROM information_schema.columns c
             WHERE c.table_schema = 'public' AND c.table_name = t.table_name
               AND c.column_name IN ('created_at', 'updated_at')) < 2`);
    expect(res.rows.map((r) => r.table_name)).toEqual([]);
  });

  it("updated_at moves forward on update", async () => {
    await signupAndLogin(t);
    const before = (await t.pool.query("SELECT updated_at FROM profiles")).rows[0]
      .updated_at as Date;
    await new Promise((r) => setTimeout(r, 15));
    await t.pool.query("UPDATE profiles SET bio = 'hello'");
    const after = (await t.pool.query("SELECT updated_at FROM profiles")).rows[0]
      .updated_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it("emails and handles are case-insensitive unique (citext)", async () => {
    await expect(
      t.pool.query(
        "INSERT INTO users (id, email) VALUES ('0192f3a0-0000-7000-8000-0000000000aa', 'ADA@EXAMPLE.COM')",
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("problems get a weighted full-text vector from title and statement", async () => {
    await t.pool.query(
      `INSERT INTO problems (id, slug, title, statement_md, difficulty, examples)
       VALUES ('0192f3a0-0000-7000-8000-000000000002', 'rotate', 'Rotate Array', 'Shift elements right by k places', 'medium', '[]')`,
    );
    const byTitle = await t.pool.query(
      "SELECT slug FROM problems WHERE search @@ websearch_to_tsquery('english', 'rotate')",
    );
    const byBody = await t.pool.query(
      "SELECT slug FROM problems WHERE search @@ websearch_to_tsquery('english', 'elements')",
    );
    expect(byTitle.rows).toEqual([{ slug: "rotate" }]);
    expect(byBody.rows).toEqual([{ slug: "rotate" }]);
    await t.pool.query("UPDATE problems SET title = 'Cyclic Shift' WHERE slug = 'rotate'");
    const renamed = await t.pool.query(
      "SELECT slug FROM problems WHERE search @@ websearch_to_tsquery('english', 'cyclic')",
    );
    expect(renamed.rows).toEqual([{ slug: "rotate" }]); // trigger refreshes on update
  });

  it("test_cases enforce unique ordinals per problem version", async () => {
    await t.pool.query(
      `INSERT INTO test_cases (id, problem_id, version, ordinal, kind, input_key, output_key) VALUES
       ('0192f3a0-0000-7000-8000-000000000011', '0192f3a0-0000-7000-8000-000000000002', 1, 1, 'sample', 'i', 'o')`,
    );
    await expect(
      t.pool.query(
        `INSERT INTO test_cases (id, problem_id, version, ordinal, kind, input_key, output_key) VALUES
         ('0192f3a0-0000-7000-8000-000000000012', '0192f3a0-0000-7000-8000-000000000002', 1, 1, 'hidden', 'i', 'o')`,
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
