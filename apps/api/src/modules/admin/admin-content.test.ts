import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { AdminProblemDetail, AuditEntry, UserRole, ValidationReport } from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import { bearer, makeTestApp, signup, type TestApp } from "../../test/helpers.js";

let t: TestApp;
let editor: string;
let otherEditor: string;
let reviewer: string;
let player: string;
let problemId: string;
let draftId: string;

async function actingAs(role: UserRole, n: string): Promise<string> {
  const email = `${n}@example.com`;
  await signup(t, { email, handle: `h_${n}`.slice(0, 20), displayName: n });
  await t.db.execute(
    sql`UPDATE users SET role = ${role}, email_verified_at = now() WHERE email = ${email}`,
  );
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password: "correct-horse-battery" },
  });
  return res.json().accessToken as string;
}

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses"]);
  editor = await actingAs("content_editor", "ed1");
  otherEditor = await actingAs("content_editor", "ed2");
  reviewer = await actingAs("reviewer", "rev1");
  player = await actingAs("user", "plain");
  problemId = (await t.pool.query("SELECT id FROM problems WHERE slug = 'two-sum'")).rows[0].id;
  // the editor's own draft, to test the "own draft" rule
  const created = await t.app.inject({
    method: "POST",
    url: "/v1/admin/problems",
    headers: bearer(editor),
    payload: {
      slug: "draft-for-hints",
      title: "Draft for hints",
      difficulty: "easy",
      statementMd:
        "Given an array of integers, return the sum of all of its elements as one integer.",
      constraintsMd: "- `1 <= n <= 100`",
      topics: ["arrays"],
      patterns: [],
      estMinutes: 10,
      signature: { function: "total", params: [{ name: "nums", type: "int[]" }], returns: "int" },
    },
  });
  draftId = created.json<AdminProblemDetail>().id;
});
afterAll(() => t.close());

const call = (
  method: "GET" | "PUT" | "DELETE",
  url: string,
  token: string | null,
  payload?: object,
) =>
  t.app.inject({
    method,
    url,
    ...(token ? { headers: bearer(token) } : {}),
    ...(payload ? { payload } : {}),
  });

const HINTS = {
  hints: [
    { tier: 1, bodyMd: "Think about what you have already seen." },
    { tier: 2, bodyMd: "A hash map remembers values and positions." },
    { tier: 3, bodyMd: "For each x, look for target - x in the map, then store x." },
  ],
};
const EDITORIAL = {
  approaches: [
    {
      name: "Brute force",
      intuition: "Try every pair of positions.",
      steps: ["loop i", "loop j > i", "check the sum"],
      code: { python: "class Solution: ..." },
      time: "O(n^2)",
      space: "O(1)",
      pitfalls: ["Reusing the same index"],
    },
    {
      name: "Hash map",
      intuition: "Remember each value's position; look up the complement.",
      steps: ["scan once", "look up target - x", "store x"],
      code: { cpp: "class Solution {};", java: "class Solution {}", python: "class Solution: ..." },
      time: "O(n)",
      space: "O(n)",
    },
  ],
  talkTrackMd: "Start brute force, then trade memory for time.",
  relatedSlugs: ["valid-parentheses"],
};

describe("hint editor", () => {
  it("saves three ordered tiers, replacing earlier ones, and records the change", async () => {
    const res = await call("PUT", `/v1/admin/problems/${problemId}/hints`, reviewer, HINTS);
    expect(res.statusCode).toBe(200);
    expect(res.json<AdminProblemDetail>().hints).toEqual(HINTS.hints);

    const fewer = await call("PUT", `/v1/admin/problems/${problemId}/hints`, reviewer, {
      hints: HINTS.hints.slice(0, 1),
    });
    expect(fewer.json<AdminProblemDetail>().hints).toHaveLength(1);
    await call("PUT", `/v1/admin/problems/${problemId}/hints`, reviewer, HINTS);

    const audit = (await call("GET", `/v1/admin/audit?entityId=${problemId}`, reviewer)).json<{
      items: AuditEntry[];
    }>().items;
    expect(audit.map((a) => a.action)).toContain("problem.hints.save");
  });

  it("rejects gaps, repeats, other tiers and short or huge text", async () => {
    const put = (hints: object[]) =>
      call("PUT", `/v1/admin/problems/${problemId}/hints`, reviewer, { hints });
    expect((await put([{ tier: 2, bodyMd: "A second hint without a first one" }])).statusCode).toBe(
      422,
    );
    expect(
      (
        await put([
          { tier: 1, bodyMd: "First hint long enough" },
          { tier: 1, bodyMd: "Again the same tier" },
        ])
      ).statusCode,
    ).toBe(422);
    expect((await put([{ tier: 4, bodyMd: "Not a real tier at all" }])).statusCode).toBe(422);
    expect((await put([{ tier: 1, bodyMd: "short" }])).statusCode).toBe(422);
    expect((await put([{ tier: 1, bodyMd: "x".repeat(3001) }])).statusCode).toBe(422);
    expect(
      (
        await call("PUT", `/v1/admin/problems/${problemId}/hints`, reviewer, {
          hints: [],
          extra: 1,
        })
      ).statusCode,
    ).toBe(422);
  });

  it("follows the same permissions as editing a problem", async () => {
    // a reviewer may edit published problems; a plain player may not use the admin API at all
    expect(
      (await call("PUT", `/v1/admin/problems/${problemId}/hints`, player, HINTS)).statusCode,
    ).toBe(403);
    expect(
      (await call("PUT", `/v1/admin/problems/${problemId}/hints`, null, HINTS)).statusCode,
    ).toBe(401);
    // an editor may not touch a published problem or someone else's draft...
    expect(
      (await call("PUT", `/v1/admin/problems/${problemId}/hints`, editor, HINTS)).statusCode,
    ).toBe(403);
    expect(
      (await call("PUT", `/v1/admin/problems/${draftId}/hints`, otherEditor, HINTS)).statusCode,
    ).toBe(403);
    // ...but may edit their own draft
    expect(
      (await call("PUT", `/v1/admin/problems/${draftId}/hints`, editor, HINTS)).statusCode,
    ).toBe(200);
    expect(
      (
        await call("PUT", `/v1/admin/problems/${draftId}/hints`, editor, { hints: [] })
      ).json<AdminProblemDetail>().hints,
    ).toEqual([]);
  });

  it("do not bump the problem's version (they are not part of the tests)", async () => {
    const before = (
      await call("GET", `/v1/admin/problems/${problemId}`, reviewer)
    ).json<AdminProblemDetail>().version;
    await call("PUT", `/v1/admin/problems/${problemId}/hints`, reviewer, HINTS);
    expect(
      (await call("GET", `/v1/admin/problems/${problemId}`, reviewer)).json<AdminProblemDetail>()
        .version,
    ).toBe(before);
  });
});

describe("editorial editor", () => {
  it("saves approaches, a talk track and related problems", async () => {
    const res = await call("PUT", `/v1/admin/problems/${problemId}/editorial`, reviewer, EDITORIAL);
    expect(res.statusCode).toBe(200);
    expect(res.json<AdminProblemDetail>().editorial).toMatchObject({
      talkTrackMd: EDITORIAL.talkTrackMd,
      relatedSlugs: ["valid-parentheses"],
      approaches: [
        { name: "Brute force" },
        { name: "Hash map", code: { cpp: expect.any(String) } },
      ],
    });
    // players see it through the public endpoint once unlocked
    await t.pool.query(
      `INSERT INTO user_problem_state (user_id, problem_id, status) SELECT id, $1, 'solved' FROM users WHERE email = 'plain@example.com'`,
      [problemId],
    );
    const seen = await call("GET", "/v1/problems/two-sum/editorial", player);
    expect(seen.statusCode).toBe(200);
    expect(seen.json().related).toEqual([
      { slug: "valid-parentheses", title: "Valid Parentheses" },
    ]);
  });

  it("replaces the previous editorial and can remove it", async () => {
    await call("PUT", `/v1/admin/problems/${problemId}/editorial`, reviewer, {
      approaches: [EDITORIAL.approaches[1]],
    });
    expect(
      (await call("GET", `/v1/admin/problems/${problemId}`, reviewer)).json<AdminProblemDetail>()
        .editorial?.approaches,
    ).toHaveLength(1);
    const removed = await call("DELETE", `/v1/admin/problems/${problemId}/editorial`, reviewer);
    expect(removed.json<AdminProblemDetail>().editorial).toBeNull();
    const audit = (await call("GET", `/v1/admin/audit?entityId=${problemId}`, reviewer)).json<{
      items: AuditEntry[];
    }>().items;
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["problem.editorial.save", "problem.editorial.delete"]),
    );
    await call("PUT", `/v1/admin/problems/${problemId}/editorial`, reviewer, EDITORIAL);
  });

  it("validates its content", async () => {
    const put = (body: object) =>
      call("PUT", `/v1/admin/problems/${problemId}/editorial`, reviewer, body);
    expect((await put({ approaches: [] })).statusCode).toBe(422);
    expect(
      (await put({ approaches: [{ ...EDITORIAL.approaches[0], steps: [] }] })).statusCode,
    ).toBe(422);
    expect(
      (await put({ approaches: [{ ...EDITORIAL.approaches[0], code: { ruby: "puts 1" } }] }))
        .statusCode,
    ).toBe(422);
    expect((await put({ ...EDITORIAL, relatedSlugs: ["no-such-problem"] })).statusCode).toBe(422);
    expect((await put({ ...EDITORIAL, relatedSlugs: ["two-sum"] })).statusCode).toBe(422); // itself
    expect((await put({ ...EDITORIAL, unknownField: true })).statusCode).toBe(422);
    expect(
      (await call("PUT", `/v1/admin/problems/${draftId}/editorial`, otherEditor, EDITORIAL))
        .statusCode,
    ).toBe(403);
  });
});

describe("validation panel", () => {
  const checks = async (id: string) =>
    (await call("GET", `/v1/admin/problems/${id}/validation`, reviewer)).json<ValidationReport>()
      .checks;

  it("warns about missing hints and editorial, and passes them once written", async () => {
    await call("PUT", `/v1/admin/problems/${problemId}/hints`, reviewer, { hints: [] });
    await call("DELETE", `/v1/admin/problems/${problemId}/editorial`, reviewer);
    const before = await checks(problemId);
    expect(before.find((c) => c.id === "hints")).toMatchObject({
      status: "warn",
      detail: "0 of 3 written",
    });
    expect(before.find((c) => c.id === "editorial")?.status).toBe("warn");

    await call("PUT", `/v1/admin/problems/${problemId}/hints`, reviewer, HINTS);
    await call("PUT", `/v1/admin/problems/${problemId}/editorial`, reviewer, EDITORIAL);
    const after = await checks(problemId);
    expect(after.find((c) => c.id === "hints")?.status).toBe("pass");
    expect(after.find((c) => c.id === "editorial")?.status).toBe("pass");
  });

  it("is honest about the judge-based checks that run in CI", async () => {
    const list = await checks(problemId);
    for (const id of ["reference", "mutants"]) {
      const c = list.find((x) => x.id === id);
      expect(c?.status).toBe("skip");
      expect(c?.detail).toContain("content:judge");
    }
  });

  it("treats hints and editorial as warnings, never failures", async () => {
    await call("PUT", `/v1/admin/problems/${problemId}/hints`, reviewer, { hints: [] });
    await call("DELETE", `/v1/admin/problems/${problemId}/editorial`, reviewer);
    const report = (
      await call("GET", `/v1/admin/problems/${problemId}/validation`, reviewer)
    ).json<ValidationReport>();
    const failing = report.checks.filter((c) => c.status === "fail").map((c) => c.id);
    expect(failing).not.toContain("hints");
    expect(failing).not.toContain("editorial");
  });
});
