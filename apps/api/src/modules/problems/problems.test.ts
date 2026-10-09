import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type {
  ProblemDetail,
  ProblemListResponse,
  SheetDetail,
  SheetSummary,
} from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import { bearer, makeTestApp, signupAndLogin, type TestApp } from "../../test/helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t);
});
afterAll(() => t.close());

const get = (url: string, token?: string) =>
  t.app.inject({ method: "GET", url, ...(token ? { headers: bearer(token) } : {}) });

const list = async (query = "", token?: string) => {
  const res = await get(`/v1/problems${query}`, token);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ProblemListResponse>();
};
const slugs = (r: ProblemListResponse) => r.items.map((i) => i.slug);

let userSeq = 0;
const newUser = () => {
  userSeq++;
  return signupAndLogin(t, { email: `p${userSeq}@example.com`, handle: `p_user_${userSeq}` });
};

describe("GET /problems", () => {
  it("lists published problems with tags, in curriculum order, for anonymous visitors", async () => {
    const r = await list();
    expect(r.total).toBe(6);
    expect(r.nextCursor).toBeNull();
    // easy before medium before hard
    expect(r.items.map((i) => i.difficulty)).toEqual([
      "easy",
      "easy",
      "easy",
      "medium",
      "medium",
      "hard",
    ]);
    const twoSum = r.items.find((i) => i.slug === "two-sum")!;
    expect(twoSum).toMatchObject({
      title: "Two Sum",
      difficulty: "easy",
      topics: ["arrays", "hashing"],
      status: null,
    });
    expect(JSON.stringify(r)).not.toMatch(/statement|inputKey|test_cases/i);
  });

  it("hides drafts, in-review and archived problems from lists", async () => {
    await t.db.execute(sql`UPDATE problems SET status = 'draft' WHERE slug = 'three-sum'`);
    await t.db.execute(sql`UPDATE problems SET status = 'archived' WHERE slug = 'merge-intervals'`);
    expect(slugs(await list())).not.toContain("three-sum");
    expect(slugs(await list())).not.toContain("merge-intervals");
    expect((await list()).total).toBe(4);
    await t.db.execute(
      sql`UPDATE problems SET status = 'published' WHERE slug IN ('three-sum', 'merge-intervals')`,
    );
  });

  it("filters by difficulty, accepting repeated and CSV parameters", async () => {
    expect(slugs(await list("?difficulty=hard"))).toEqual(["edit-distance"]);
    expect((await list("?difficulty=easy&difficulty=hard")).total).toBe(4);
    expect((await list("?difficulty=easy,hard")).total).toBe(4);
    expect((await get("/v1/problems?difficulty=impossible")).statusCode).toBe(422);
  });

  it("filters by topic with any/all semantics, and by pattern", async () => {
    expect((await list("?topic=dynamic-programming")).items.map((i) => i.slug).sort()).toEqual([
      "climbing-stairs",
      "edit-distance",
    ]);
    // any: strings OR dynamic-programming
    expect((await list("?topic=strings,dynamic-programming&topicMode=any")).total).toBe(3);
    // all: both topics -> only edit-distance
    expect(slugs(await list("?topic=strings&topic=dynamic-programming&topicMode=all"))).toEqual([
      "edit-distance",
    ]);
    expect(slugs(await list("?pattern=interval-merging"))).toEqual(["merge-intervals"]);
    expect((await list("?topic=no-such-topic")).total).toBe(0);
  });

  it("filters by time estimate and acceptance rate", async () => {
    expect((await list("?maxMinutes=10")).items.every((i) => (i.estMinutes ?? 99) <= 10)).toBe(
      true,
    );
    expect((await list("?minAcc=50")).total).toBe(0); // nobody has submitted yet
    expect((await list("?maxAcc=0")).total).toBe(6);
    await t.db.execute(sql`UPDATE problems SET acceptance_rate = 61.5 WHERE slug = 'two-sum'`);
    expect(slugs(await list("?minAcc=50"))).toEqual(["two-sum"]);
    expect(slugs(await list("?sort=acceptance"))[0]).toBe("two-sum");
    await t.db.execute(sql`UPDATE problems SET acceptance_rate = 0 WHERE slug = 'two-sum'`);
  });

  it("filters by sheet and orders by the sheet's own order", async () => {
    expect(slugs(await list("?sheet=mini"))).toEqual([
      "valid-parentheses",
      "two-sum",
      "edit-distance",
    ]);
    expect((await list("?sheet=no-such-sheet")).total).toBe(0);
  });

  it("composes filters", async () => {
    const r = await list("?sheet=mini&difficulty=easy&topic=hashing");
    expect(slugs(r)).toEqual(["two-sum"]);
  });

  it("searches full text, with stemming and typo tolerance, most relevant first", async () => {
    expect(slugs(await list("?q=two%20sum"))[0]).toBe("two-sum");
    expect(slugs(await list("?q=parentheses"))).toContain("valid-parentheses");
    expect(slugs(await list("?q=parenthesis"))[0]).toBe("valid-parentheses"); // stemmed
    expect(slugs(await list("?q=edt%20distnce"))[0]).toBe("edit-distance"); // typos
    expect(slugs(await list("?q=zzzzqqqq"))).toEqual([]);
    expect(slugs(await list("?q=climb"))).toContain("climbing-stairs"); // prefix-ish via similarity
  });

  it("matches statement text, not only titles", async () => {
    // "staircase" appears only in the climbing-stairs statement
    expect(slugs(await list("?q=staircase"))).toEqual(["climbing-stairs"]);
  });

  it("ignores injection attempts in the search string", async () => {
    const res = await get("/v1/problems?q=" + encodeURIComponent("'; DROP TABLE problems; --"));
    expect(res.statusCode).toBe(200);
    expect((await list()).total).toBe(6);
  });

  it("paginates with opaque cursors, without gaps or repeats", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: ProblemListResponse = await list(`?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(r.total).toBe(6);
      expect(r.items.length).toBeLessThanOrEqual(2);
      seen.push(...slugs(r));
      cursor = r.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(slugs(await list("?limit=50")));
    expect(new Set(seen).size).toBe(6);
    expect((await get("/v1/problems?cursor=garbage")).statusCode).toBe(422);
    expect((await get("/v1/problems?limit=500")).statusCode).toBe(422);
  });

  it("personalises status for signed-in users and supports status filters", async () => {
    const { accessToken } = await newUser();
    const me = (
      await t.pool.query("SELECT id FROM users WHERE email = $1", [`p${userSeq}@example.com`])
    ).rows[0].id;
    await t.pool.query(
      `INSERT INTO user_problem_state (user_id, problem_id, status, attempts)
       SELECT $1, id, 'solved', 2 FROM problems WHERE slug = 'two-sum'`,
      [me],
    );
    await t.pool.query(
      `INSERT INTO user_problem_state (user_id, problem_id, status, attempts)
       SELECT $1, id, 'attempted', 1 FROM problems WHERE slug = 'edit-distance'`,
      [me],
    );

    const all = await list("", accessToken);
    expect(Object.fromEntries(all.items.map((i) => [i.slug, i.status]))).toMatchObject({
      "two-sum": "solved",
      "edit-distance": "attempted",
      "valid-parentheses": "unseen",
    });
    expect(slugs(await list("?status=solved", accessToken))).toEqual(["two-sum"]);
    expect(slugs(await list("?status=attempted", accessToken))).toEqual(["edit-distance"]);
    expect((await list("?status=unsolved", accessToken)).total).toBe(4);
    expect((await list("?status=solved,attempted", accessToken)).total).toBe(2);

    // another user's progress is independent
    const other = await newUser();
    expect((await list("?status=solved", other.accessToken)).total).toBe(0);
    // anonymous callers can't filter by progress
    expect((await get("/v1/problems?status=solved")).statusCode).toBe(401);
  });

  it("rejects an invalid token instead of silently treating the caller as anonymous", async () => {
    expect((await get("/v1/problems", "garbage")).statusCode).toBe(401);
  });
});

describe("GET /problems/:slug", () => {
  it("returns the statement, examples, limits per language and starter code", async () => {
    const res = await get("/v1/problems/two-sum");
    expect(res.statusCode).toBe(200);
    const p = res.json<ProblemDetail>();
    expect(p).toMatchObject({
      slug: "two-sum",
      title: "Two Sum",
      difficulty: "easy",
      version: 1,
      archived: false,
      topics: ["arrays", "hashing"],
      state: null,
    });
    expect(p.statementMd).toMatch(/indices/);
    expect(p.constraintsMd).toMatch(/nums\.length/);
    expect(p.examples[0]).toEqual({
      input: "nums = [2, 7, 11, 15]\ntarget = 9",
      output: "[0, 1]",
      explanation: "`nums[0] + nums[1] = 2 + 7 = 9`.",
    });
    expect(p.languages.map((l) => l.language)).toEqual(["cpp", "java", "python"]);
    const [cpp, java, python] = p.languages;
    expect(cpp).toMatchObject({ timeLimitMs: 1000, memoryLimitKb: 262144 });
    expect(java).toMatchObject({ timeLimitMs: 2300, memoryLimitKb: 524288 }); // 2x + 0.3 s, 2x memory
    expect(python).toMatchObject({ timeLimitMs: 5000, memoryLimitKb: 262144 }); // 5x
    expect(cpp?.starterCode).toContain("vector<int> twoSum(vector<int>& nums, int target)");
    expect(python?.starterCode).toContain(
      "def twoSum(self, nums: list[int], target: int) -> list[int]:",
    );
  });

  it("never leaks hidden test data, drivers or storage keys", async () => {
    const body = (await get("/v1/problems/two-sum")).body;
    expect(body).not.toMatch(
      /driver|inputKey|outputKey|input_key|problems\/two-sum\/v1|test_cases|\.in\b/i,
    );
  });

  it("includes the caller's own state", async () => {
    const { accessToken } = await newUser();
    const p = (await get("/v1/problems/two-sum", accessToken)).json<ProblemDetail>();
    expect(p.state).toEqual({ status: "unseen", attempts: 0 });
  });

  it("404s for unknown, draft and in-review problems; serves archived ones with a flag", async () => {
    expect((await get("/v1/problems/does-not-exist")).statusCode).toBe(404);
    await t.db.execute(sql`UPDATE problems SET status = 'draft' WHERE slug = 'three-sum'`);
    expect((await get("/v1/problems/three-sum")).statusCode).toBe(404);
    await t.db.execute(sql`UPDATE problems SET status = 'in_review' WHERE slug = 'three-sum'`);
    expect((await get("/v1/problems/three-sum")).statusCode).toBe(404);
    await t.db.execute(sql`UPDATE problems SET status = 'archived' WHERE slug = 'three-sum'`);
    const archived = (await get("/v1/problems/three-sum")).json<ProblemDetail>();
    expect(archived.archived).toBe(true);
    await t.db.execute(sql`UPDATE problems SET status = 'published' WHERE slug = 'three-sum'`);
  });

  it("validates the slug", async () => {
    expect((await get("/v1/problems/Bad_Slug!")).statusCode).toBe(422);
  });
});

describe("facets", () => {
  it("counts published problems per topic and pattern, hiding empty tags", async () => {
    const res = await get("/v1/tags");
    const { topics, patterns } = res.json<{
      topics: Array<{ slug: string; count: number }>;
      patterns: Array<{ slug: string; count: number }>;
    }>();
    expect(topics.find((x) => x.slug === "arrays")?.count).toBe(3); // two-sum, three-sum, merge-intervals
    expect(topics.find((x) => x.slug === "dynamic-programming")?.count).toBe(2);
    expect(topics.some((x) => x.slug === "trie")).toBe(false);
    expect(patterns).toEqual([expect.objectContaining({ slug: "interval-merging", count: 1 })]);
    expect((await get("/v1/companies")).json()).toEqual({ items: [] });

    // the full taxonomy (for admin forms) also lists tags nothing uses yet
    const full = (await get("/v1/tags?all=1")).json<{
      topics: Array<{ slug: string; count: number }>;
    }>();
    expect(full.topics.find((x) => x.slug === "trie")).toMatchObject({ count: 0 });
    expect(full.topics.length).toBeGreaterThan(topics.length);
    expect((await get("/v1/tags?all=nope")).statusCode).toBe(422);
  });
});

describe("sheets", () => {
  it("lists public sheets with totals; solved is null when signed out", async () => {
    const items = (await get("/v1/sheets")).json<{ items: SheetSummary[] }>().items;
    expect(items).toEqual([
      expect.objectContaining({ slug: "mini", title: "Mini Sheet", total: 3, solved: null }),
    ]);
  });

  it("returns sections in order with per-user progress", async () => {
    const { accessToken } = await newUser();
    const me = (
      await t.pool.query("SELECT id FROM users WHERE email = $1", [`p${userSeq}@example.com`])
    ).rows[0].id;
    await t.pool.query(
      `INSERT INTO user_problem_state (user_id, problem_id, status)
       SELECT $1, id, 'solved' FROM problems WHERE slug IN ('two-sum', 'edit-distance')`,
      [me],
    );
    const sheet = (await get("/v1/sheets/mini", accessToken)).json<SheetDetail>();
    expect(sheet.sections.map((s) => [s.name, s.problems.map((p) => p.slug)])).toEqual([
      ["Warm-up", ["valid-parentheses", "two-sum"]],
      ["Harder", ["edit-distance"]],
    ]);
    expect(sheet).toMatchObject({ total: 3, solved: 2 });
    expect(
      (await get("/v1/sheets", accessToken)).json<{ items: SheetSummary[] }>().items[0]?.solved,
    ).toBe(2);
    expect((await get("/v1/sheets/mini")).json<SheetDetail>().solved).toBeNull();
  });

  it("counts a problem once per sheet and skips unpublished problems", async () => {
    await t.db.execute(sql`UPDATE problems SET status = 'draft' WHERE slug = 'edit-distance'`);
    const sheet = (await get("/v1/sheets/mini")).json<SheetDetail>();
    expect(sheet.total).toBe(2);
    await t.db.execute(sql`UPDATE problems SET status = 'published' WHERE slug = 'edit-distance'`);
  });

  it("404s for unknown and private sheets", async () => {
    expect((await get("/v1/sheets/nope")).statusCode).toBe(404);
    await t.pool.query(
      `INSERT INTO sheets (id, slug, title, visibility) VALUES ('0192f3a0-0000-7000-8000-0000000000b1', 'secret', 'Secret', 'private')`,
    );
    expect((await get("/v1/sheets/secret")).statusCode).toBe(404);
    expect(
      (await get("/v1/sheets")).json<{ items: SheetSummary[] }>().items.map((s) => s.slug),
    ).not.toContain("secret");
  });
});
