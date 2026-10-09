import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CustomTest, Draft, DraftHistoryItem } from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import { bearer, makeTestApp, signupAndLogin, type TestApp } from "../../test/helpers.js";

let t: TestApp;
let ada: string;
let bob: string;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses"]);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
});
afterAll(() => t.close());

const call = (
  method: "GET" | "PUT" | "POST" | "DELETE",
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

const save = (
  token: string,
  code: string,
  baseVersion: number,
  extra: object = {},
  slug = "two-sum",
  lang = "python",
) =>
  call("PUT", `/v1/problems/${slug}/draft?language=${lang}`, token, {
    code,
    baseVersion,
    ...extra,
  });

const draftOf = (token: string, slug = "two-sum", lang = "python") =>
  call("GET", `/v1/problems/${slug}/draft?language=${lang}`, token).then(
    (r) => r.json<{ draft: Draft | null }>().draft,
  );

describe("drafts: access", () => {
  it("require sign-in and a visible problem and a valid language", async () => {
    expect((await call("GET", "/v1/problems/two-sum/draft?language=python", null)).statusCode).toBe(
      401,
    );
    expect((await call("GET", "/v1/problems/no-such/draft?language=python", ada)).statusCode).toBe(
      404,
    );
    expect((await call("GET", "/v1/problems/two-sum/draft?language=cobol", ada)).statusCode).toBe(
      422,
    );
    expect((await call("GET", "/v1/problems/two-sum/draft", ada)).statusCode).toBe(422);
  });

  it("start empty", async () => {
    expect(await draftOf(ada)).toBeNull();
  });
});

describe("drafts: autosave with optimistic concurrency", () => {
  it("creates version 1, then increments; the cursor is kept", async () => {
    const first = await save(ada, "print(1)", 0, { cursor: { line: 1, column: 9 } });
    expect(first.statusCode).toBe(200);
    expect(first.json().draft).toMatchObject({
      code: "print(1)",
      version: 1,
      cursor: { line: 1, column: 9 },
    });

    const second = await save(ada, "print(2)", 1);
    expect(second.json().draft).toMatchObject({
      code: "print(2)",
      version: 2,
      cursor: { line: 1, column: 9 },
    });
    expect(await draftOf(ada)).toMatchObject({ code: "print(2)", version: 2 });
  });

  it("rejects a stale base version with 409 and the current draft", async () => {
    const stale = await save(ada, "from another tab", 1);
    expect(stale.statusCode).toBe(409);
    const error = stale.json().error;
    expect(error.code).toBe("CONFLICT");
    expect(error.details.current).toMatchObject({ code: "print(2)", version: 2 });
    // and nothing was overwritten
    expect(await draftOf(ada)).toMatchObject({ code: "print(2)", version: 2 });
  });

  it("rejects creating over an existing draft with baseVersion 0, and a future version", async () => {
    expect((await save(ada, "x", 0)).statusCode).toBe(409);
    expect((await save(ada, "x", 99)).statusCode).toBe(409);
  });

  it("treats an unchanged save as a no-op (no version churn)", async () => {
    const before = await draftOf(ada);
    const again = await save(ada, before!.code, before!.version);
    expect(again.statusCode).toBe(200);
    expect(again.json().draft.version).toBe(before!.version);
  });

  it("keeps drafts separate per language, per problem and per user", async () => {
    await save(ada, "int main() {}", 0, {}, "two-sum", "cpp");
    await save(ada, "stack = []", 0, {}, "valid-parentheses", "python");
    expect(await draftOf(ada, "two-sum", "cpp")).toMatchObject({
      code: "int main() {}",
      version: 1,
    });
    expect(await draftOf(ada, "valid-parentheses", "python")).toMatchObject({ code: "stack = []" });
    expect(await draftOf(ada, "two-sum", "java")).toBeNull();
    expect(await draftOf(bob)).toBeNull(); // bob never saved anything
    expect((await save(bob, "bob's code", 0)).json().draft.version).toBe(1);
    expect(await draftOf(ada)).toMatchObject({ code: "print(2)" });
  });

  it("validates the body: size limit (64 KB), types, missing fields", async () => {
    expect((await save(ada, "a".repeat(64 * 1024 + 1), 2)).statusCode).toBe(422);
    expect((await save(ada, "a".repeat(64 * 1024), 2)).statusCode).toBe(200);
    expect(
      (
        await call("PUT", "/v1/problems/two-sum/draft?language=python", ada, {
          code: 5,
          baseVersion: 3,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await call("PUT", "/v1/problems/two-sum/draft?language=python", ada, { code: "x" }))
        .statusCode,
    ).toBe(422);
    expect((await save(ada, "x", 3, { cursor: { line: 0, column: 1 } })).statusCode).toBe(422);
  });

  it("survives concurrent saves from two tabs: exactly one wins", async () => {
    const v = (await draftOf(bob))!.version;
    const results = await Promise.all([save(bob, "tab one", v), save(bob, "tab two", v)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await draftOf(bob))!.version).toBe(v + 1);
  });
});

describe("draft history (last 5 snapshots)", () => {
  it("snapshots replaced code at most once a minute and keeps the five newest", async () => {
    const lang = "java";
    const slug = "valid-parentheses";
    let version = (await save(ada, "v0", 0, {}, slug, lang)).json().draft.version;

    // rapid edits collapse into a single snapshot
    for (const code of ["v1", "v2", "v3"]) {
      version = (await save(ada, code, version, {}, slug, lang)).json().draft.version;
    }
    let history = (
      await call("GET", `/v1/problems/${slug}/draft-history?language=${lang}`, ada)
    ).json<{ items: DraftHistoryItem[] }>().items;
    expect(history.map((h) => h.code)).toEqual(["v0"]);

    // age the snapshots so the next saves are allowed to snapshot again
    for (let i = 1; i <= 7; i++) {
      await t.db.execute(sql`UPDATE draft_history SET saved_at = saved_at - interval '2 minutes'`);
      version = (await save(ada, `w${i}`, version, {}, slug, lang)).json().draft.version;
    }
    history = (await call("GET", `/v1/problems/${slug}/draft-history?language=${lang}`, ada)).json<{
      items: DraftHistoryItem[];
    }>().items;
    expect(history).toHaveLength(5);
    expect(history[0]?.code).toBe("w6"); // newest snapshot is the code replaced by the last save
    const times = history.map((h) => new Date(h.savedAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("is private to the user", async () => {
    const mine = await call(
      "GET",
      "/v1/problems/valid-parentheses/draft-history?language=java",
      bob,
    );
    expect(mine.json().items).toEqual([]);
  });
});

describe("custom tests", () => {
  const url = "/v1/problems/two-sum/custom-tests";

  it("require sign-in", async () => {
    expect((await call("GET", url, null)).statusCode).toBe(401);
  });

  it("can be added, listed in order and deleted", async () => {
    expect((await call("GET", url, ada)).json().items).toEqual([]);
    const a = await call("POST", url, ada, { label: "  empty-ish  ", input: "2\n1 2\n3\n" });
    expect(a.statusCode).toBe(201);
    expect(a.json<CustomTest>()).toMatchObject({ label: "empty-ish", input: "2\n1 2\n3\n" });
    const b = await call("POST", url, ada, { input: "second" });
    expect(b.json<CustomTest>().label).toBeNull();

    const items = (await call("GET", url, ada)).json<{ items: CustomTest[] }>().items;
    expect(items.map((i) => i.input)).toEqual(["2\n1 2\n3\n", "second"]);

    expect((await call("DELETE", `${url}/${a.json().id}`, ada)).statusCode).toBe(204);
    expect((await call("GET", url, ada)).json<{ items: CustomTest[] }>().items).toHaveLength(1);
    expect((await call("DELETE", `${url}/${a.json().id}`, ada)).statusCode).toBe(404);
  });

  it("are private: other users can't see or delete them", async () => {
    const mine = (await call("GET", url, ada)).json<{ items: CustomTest[] }>().items[0]!;
    expect((await call("GET", url, bob)).json().items).toEqual([]);
    expect((await call("DELETE", `${url}/${mine.id}`, bob)).statusCode).toBe(404);
    expect((await call("GET", url, ada)).json<{ items: CustomTest[] }>().items).toHaveLength(1);
  });

  it("are scoped to the problem", async () => {
    expect(
      (await call("GET", "/v1/problems/valid-parentheses/custom-tests", ada)).json().items,
    ).toEqual([]);
    const mine = (await call("GET", url, ada)).json<{ items: CustomTest[] }>().items[0]!;
    expect(
      (await call("DELETE", `/v1/problems/valid-parentheses/custom-tests/${mine.id}`, ada))
        .statusCode,
    ).toBe(404);
  });

  it("validate size and labels, and cap at 20 per problem (even under concurrency)", async () => {
    expect((await call("POST", url, bob, { input: "x".repeat(64 * 1024 + 1) })).statusCode).toBe(
      422,
    );
    expect((await call("POST", url, bob, { label: "l".repeat(61), input: "x" })).statusCode).toBe(
      422,
    );
    expect((await call("POST", url, bob, {})).statusCode).toBe(422);
    expect((await call("DELETE", `${url}/not-a-uuid`, bob)).statusCode).toBe(422);

    // 20 concurrent adds, then 5 more concurrent adds: exactly 20 end up stored
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => call("POST", url, bob, { input: `case ${i}` })),
    );
    const extra = await Promise.all(
      Array.from({ length: 5 }, () => call("POST", url, bob, { input: "extra" })),
    );
    expect(extra.map((r) => r.statusCode)).toEqual([429, 429, 429, 429, 429]);
    expect(extra[0]?.json().error.code).toBe("QUOTA_EXCEEDED");
    expect((await call("GET", url, bob)).json<{ items: CustomTest[] }>().items).toHaveLength(20);
  });
});
