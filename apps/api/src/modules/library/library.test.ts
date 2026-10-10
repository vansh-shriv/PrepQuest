import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BookmarkItem, NoteDto, NoteHubItem } from "@prepquest/shared";
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
beforeEach(async () => {
  await t.pool.query("DELETE FROM bookmarks");
  await t.pool.query("DELETE FROM notes");
});

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

describe("bookmarks", () => {
  it("require sign-in", async () => {
    expect((await call("GET", "/v1/me/bookmarks", null)).statusCode).toBe(401);
    expect((await call("PUT", "/v1/me/bookmarks/two-sum", null, {})).statusCode).toBe(401);
  });

  it("can be added into a folder, listed newest first, moved and removed", async () => {
    expect((await call("PUT", "/v1/me/bookmarks/two-sum", ada, {})).json()).toEqual({
      bookmarked: true,
      folder: "default",
    });
    await call("PUT", "/v1/me/bookmarks/valid-parentheses", ada, { folder: "Amazon" });
    const list = (await call("GET", "/v1/me/bookmarks", ada)).json<{ items: BookmarkItem[] }>()
      .items;
    expect(list.map((b) => [b.problem.slug, b.folder])).toEqual([
      ["valid-parentheses", "Amazon"],
      ["two-sum", "default"],
    ]);
    expect(list[0]?.problem).toMatchObject({ title: "Valid Parentheses", difficulty: "easy" });

    // bookmarking again moves it instead of duplicating
    await call("PUT", "/v1/me/bookmarks/two-sum", ada, { folder: "Revisit" });
    const moved = (await call("GET", "/v1/me/bookmarks", ada)).json<{ items: BookmarkItem[] }>()
      .items;
    expect(moved).toHaveLength(2);
    expect(moved.find((b) => b.problem.slug === "two-sum")?.folder).toBe("Revisit");

    expect((await call("DELETE", "/v1/me/bookmarks/two-sum", ada)).statusCode).toBe(204);
    expect((await call("DELETE", "/v1/me/bookmarks/two-sum", ada)).statusCode).toBe(204); // idempotent
    expect((await call("GET", "/v1/me/bookmarks", ada)).json().items).toHaveLength(1);
  });

  it("are private, validated, and shown on the problem page", async () => {
    await call("PUT", "/v1/me/bookmarks/two-sum", ada, {});
    expect((await call("GET", "/v1/me/bookmarks", bob)).json().items).toEqual([]);
    expect((await call("PUT", "/v1/me/bookmarks/nope", ada, {})).statusCode).toBe(404);
    expect(
      (await call("PUT", "/v1/me/bookmarks/two-sum", ada, { folder: "x".repeat(41) })).statusCode,
    ).toBe(422);

    const flag = async (token: string | null) =>
      (await call("GET", "/v1/problems/two-sum", token)).json().bookmarked;
    expect(await flag(ada)).toBe(true);
    expect(await flag(bob)).toBe(false);
    expect(await flag(null)).toBeNull();
  });
});

describe("notes", () => {
  const url = "/v1/problems/two-sum/note";
  const note = async (token: string) =>
    (await call("GET", url, token)).json<{ note: NoteDto | null }>().note;

  it("start empty, save with a version, and update in sequence", async () => {
    expect(await note(ada)).toBeNull();
    const first = await call("PUT", url, ada, {
      bodyMd: "# Hash map\nstore seen values",
      baseVersion: 0,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().note).toMatchObject({
      bodyMd: "# Hash map\nstore seen values",
      version: 1,
    });
    const second = await call("PUT", url, ada, { bodyMd: "edited", baseVersion: 1 });
    expect(second.json().note).toMatchObject({ bodyMd: "edited", version: 2 });
    expect(await note(ada)).toMatchObject({ bodyMd: "edited", version: 2 });
    expect(await note(bob)).toBeNull(); // notes are private
  });

  it("refuse a stale save and return the newer note (two tabs)", async () => {
    await call("PUT", url, ada, { bodyMd: "tab A", baseVersion: 0 });
    await call("PUT", url, ada, { bodyMd: "tab A again", baseVersion: 1 });

    const stale = await call("PUT", url, ada, { bodyMd: "tab B", baseVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details.current).toMatchObject({ bodyMd: "tab A again", version: 2 });
    // a second tab that never saw a note also can't overwrite it
    expect((await call("PUT", url, ada, { bodyMd: "tab C", baseVersion: 0 })).statusCode).toBe(409);
    expect(await note(ada)).toMatchObject({ bodyMd: "tab A again", version: 2 });
  });

  it("allow only one of two concurrent first saves", async () => {
    const results = await Promise.all([
      call("PUT", url, ada, { bodyMd: "one", baseVersion: 0 }),
      call("PUT", url, ada, { bodyMd: "two", baseVersion: 0 }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it("are deleted by saving an empty body, and size-limited", async () => {
    await call("PUT", url, ada, { bodyMd: "temp", baseVersion: 0 });
    const cleared = await call("PUT", url, ada, { bodyMd: "  \n", baseVersion: 1 });
    expect(cleared.json()).toEqual({ note: null });
    expect(await note(ada)).toBeNull();
    expect(
      (await call("PUT", url, ada, { bodyMd: "x".repeat(20_001), baseVersion: 0 })).statusCode,
    ).toBe(422);
    expect(
      (await call("PUT", "/v1/problems/nope/note", ada, { bodyMd: "x", baseVersion: 0 }))
        .statusCode,
    ).toBe(404);
  });

  it("can be searched across problems in the notes hub", async () => {
    await call("PUT", url, ada, {
      bodyMd: "Use a hash map to remember complements",
      baseVersion: 0,
    });
    await call("PUT", "/v1/problems/valid-parentheses/note", ada, {
      bodyMd: "stack of openers",
      baseVersion: 0,
    });
    await call("PUT", url, bob, { bodyMd: "bob only: complements", baseVersion: 0 });

    const hub = async (q = "") =>
      (await call("GET", `/v1/me/notes${q}`, ada)).json<{
        items: NoteHubItem[];
        nextCursor: string | null;
      }>();
    const all = await hub();
    expect(all.items.map((n) => n.problem?.slug)).toEqual(["valid-parentheses", "two-sum"]);
    expect((await hub("?q=complement")).items.map((n) => n.problem?.slug)).toEqual(["two-sum"]);
    expect((await hub("?q=parentheses")).items).toHaveLength(1); // matches the problem title too
    expect((await hub("?q=zzz")).items).toEqual([]);

    const page = await hub("?limit=1");
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const next = await hub(`?limit=1&cursor=${page.nextCursor}`);
    expect(next.items[0]?.problem?.slug).toBe("two-sum");
    expect(next.nextCursor).toBeNull();
  });

  it("are kept, marked archived, when the problem is archived", async () => {
    await call("PUT", url, ada, { bodyMd: "keep me", baseVersion: 0 });
    await t.pool.query("UPDATE problems SET status = 'archived' WHERE slug = 'two-sum'");
    const hub = (await call("GET", "/v1/me/notes", ada)).json<{ items: NoteHubItem[] }>().items;
    expect(hub[0]?.problem).toMatchObject({ slug: "two-sum", archived: true });
    await t.pool.query("UPDATE problems SET status = 'published' WHERE slug = 'two-sum'");
  });
});
