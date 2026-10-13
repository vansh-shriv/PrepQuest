import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  SqlListResponse,
  SqlProblemDto,
  SqlRunResult,
  SqlSubmitResult,
} from "@prepquest/shared";
import { seedAssess } from "../../test/content.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";
import { resetLearning } from "../../test/solve.js";

let t: TestApp;
let ada: string;
let bob: string;

const NOW = new Date("2026-03-02T09:00:00Z");

beforeAll(async () => {
  t = await makeTestApp();
  await seedAssess(t);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetLearning(t);
  t.app.ai.now = () => NOW;
});

const call = <T>(method: "GET" | "POST", url: string, token: string | null, payload?: object) =>
  t.app
    .inject({
      method,
      url: `/v1${url}`,
      ...(token ? { headers: bearer(token) } : {}),
      ...(payload ? { payload } : {}),
    })
    .then((r) => ({ status: r.statusCode, body: r.json<T>() }));

const submit = (slug: string, query: string, token = ada) =>
  call<SqlSubmitResult>("POST", `/sql/problems/${slug}/submit`, token, { query });
const xp = async (email = "ada@example.com") =>
  Number(
    (
      await t.pool.query(
        `SELECT p.xp FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.email = $1`,
        [email],
      )
    ).rows[0].xp,
  );

describe("SQL practice", () => {
  it("lists the problems for signed-in users only", async () => {
    expect((await call("GET", "/sql/problems", null)).status).toBe(401);
    const r = await call<SqlListResponse>("GET", "/sql/problems", ada);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(26);
    expect(r.body.solved).toBe(0);
    expect(r.body.topics).toContain("windows");
    expect(r.body.problems[0]).toMatchObject({ solved: false, attempts: 0 });
  });

  it("shows the statement and the tables with a preview, but not the answer", async () => {
    const r = await call<SqlProblemDto>("GET", "/sql/problems/cheap-products", ada);
    expect(r.status).toBe(200);
    expect(r.body.statement).toMatch(/less than 100/);
    expect(r.body.tables.map((x) => x.name)).toEqual([
      "customers",
      "order_items",
      "orders",
      "products",
    ]);
    const products = r.body.tables.find((x) => x.name === "products")!;
    expect(products.rowCount).toBe(7);
    expect(products.preview).toHaveLength(5);
    expect(r.body.solution).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain("expected");
    expect((await call("GET", "/sql/problems/nope", ada)).status).toBe(404);
  });

  it("runs a query and returns columns and rows", async () => {
    const r = await call<SqlRunResult>("POST", "/sql/problems/cheap-products/run", ada, {
      query: "SELECT name, price FROM products ORDER BY price LIMIT 2;",
    });
    expect(r.body).toMatchObject({ ok: true, columns: ["name", "price"], truncated: false });
    expect(r.body.rows).toEqual([
      ["Pen", 10],
      ["Notebook", 50],
    ]);
  });

  it("refuses anything but one read-only statement", async () => {
    for (const query of [
      "DELETE FROM products",
      "DROP TABLE products",
      "SELECT 1; SELECT 2",
      "PRAGMA table_info(products)",
      "",
    ]) {
      const r = await call<SqlRunResult>("POST", "/sql/problems/cheap-products/run", ada, {
        query,
      });
      expect(r.body.ok, query).toBe(false);
      expect(r.body.error, query).toBeTruthy();
    }
    // nothing was changed for anyone: every run starts from a fresh copy
    const after = await call<SqlRunResult>("POST", "/sql/problems/cheap-products/run", bob, {
      query: "SELECT count(*) FROM products",
    });
    expect(after.body.rows).toEqual([[7]]);
  });

  it("accepts a correct answer, whatever the aliases and row order, and pays XP once", async () => {
    const before = await xp();
    const first = await submit(
      "cheap-products",
      "SELECT name AS n FROM products WHERE price < 100 ORDER BY name DESC",
    );
    expect(first.body).toMatchObject({ verdict: "AC", firstSolve: true, xpAwarded: 10 });
    expect(first.body.solution?.query).toMatch(/SELECT/);
    expect(await xp()).toBe(before + 10);

    const again = await submit("cheap-products", "SELECT name FROM products WHERE price < 100");
    expect(again.body).toMatchObject({ verdict: "AC", firstSolve: false, xpAwarded: 0 });
    expect(await xp()).toBe(before + 10);

    const list = await call<SqlListResponse>("GET", "/sql/problems", ada);
    expect(list.body.solved).toBe(1);
    expect(list.body.problems.find((p) => p.slug === "cheap-products")).toMatchObject({
      solved: true,
      attempts: 2,
    });
    const detail = await call<SqlProblemDto>("GET", "/sql/problems/cheap-products", ada);
    expect(detail.body.solved).toBe(true);
    expect(detail.body.solution).not.toBeNull();
    expect(detail.body.lastQuery).toMatch(/price < 100/);
  });

  it("says what is wrong without revealing the rows", async () => {
    const few = await submit("cheap-products", "SELECT name FROM products WHERE price < 20");
    expect(few.body.verdict).toBe("WA");
    expect(few.body.message).toMatch(/Expected 2 rows, got 1/);
    expect(few.body.expected).toEqual({ columns: ["name"], rows: 2 });
    expect(few.body.solution).toBeNull();
    expect(few.body.xpAwarded).toBe(0);

    const cols = await submit(
      "cheap-products",
      "SELECT name, price FROM products WHERE price < 100",
    );
    expect(cols.body.message).toMatch(/1 column/);
  });

  it("checks row order only when the problem asks for it", async () => {
    const unordered = await submit(
      "high-earners",
      "SELECT name, salary FROM employees WHERE salary > 120000 ORDER BY salary",
    );
    expect(unordered.body.verdict).toBe("WA");
    expect(unordered.body.message).toMatch(/order/);
    const ok = await submit(
      "high-earners",
      "SELECT name, salary FROM employees WHERE salary > 120000 ORDER BY salary DESC",
    );
    expect(ok.body.verdict).toBe("AC");
    expect(ok.body.xpAwarded).toBe(10);
  });

  it("reports SQL errors and stops a runaway query", async () => {
    const bad = await submit("cheap-products", "SELECT nope FROM products");
    expect(bad.body.verdict).toBe("ERROR");
    expect(bad.body.message).toMatch(/no such column/i);
    const slow = await submit(
      "cheap-products",
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n",
    );
    expect(slow.body.verdict).toBe("TLE");
    expect(slow.body.result.timedOut).toBe(true);
  }, 20_000);

  it("keeps one learner's attempts away from another's", async () => {
    await submit("cheap-products", "SELECT name FROM products WHERE price < 100");
    const bobs = await call<SqlProblemDto>("GET", "/sql/problems/cheap-products", bob);
    expect(bobs.body.solved).toBe(false);
    expect(bobs.body.lastQuery).toBeNull();
  });
});
