import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { findContentRoot } from "@prepquest/content";
import type {
  ContestDetailDto,
  FlagDetail,
  FlagListResponse,
  MyIntegrityNotice,
  ScanResult,
  StandingsResponse,
  UserRole,
} from "@prepquest/shared";
import { signAccessToken } from "../auth/access-token.js";
import { seedContent } from "../../test/content.js";
import { bearer, makeTestApp, signup, type TestApp } from "../../test/helpers.js";
import { resetLearning, solveProblem } from "../../test/solve.js";

let t: TestApp;
const tokens: Record<string, string> = {};

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
  await seedContent(t, ["edit-distance", "valid-parentheses"]);
  for (const n of ["ada", "bob", "cy"]) tokens[n] = await actingAs("user", n);
  tokens.rev = await actingAs("reviewer", "rev");
  // moderators and admins must have passed two-factor: mint tokens that did
  const keys = t.keys;
  for (const [name, role] of [
    ["mod", "moderator"],
    ["adm", "admin"],
  ] as const) {
    await actingAs(role, name);
    const row = (
      await t.pool.query("SELECT id FROM users WHERE email = $1", [`${name}@example.com`])
    ).rows[0] as { id: string };
    tokens[name] = await signAccessToken(
      keys,
      { userId: row.id, role, sessionId: "00000000-0000-4000-8000-000000000001", mfa: true },
      600,
    );
  }
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetLearning(t);
  await t.pool.query("DELETE FROM integrity_flags");
});

const call = <T>(
  method: "GET" | "POST" | "PATCH",
  url: string,
  token: string | null,
  payload?: object,
) =>
  t.app
    .inject({
      method,
      url: `/v1${url}`,
      ...(token ? { headers: bearer(token) } : {}),
      ...(payload ? { payload } : {}),
    })
    .then((r) => ({ status: r.statusCode, body: r.json<T>() }));

const REF = readFileSync(
  path.join(findContentRoot(), "problems", "edit-distance", "solutions", "ref.py"),
  "utf8",
);
const KEYWORDS = new Set(
  "def if in for return self class not and or else elif while True False None".split(" "),
);
/** The same program with every name changed and comments added. */
const disguised = () => {
  let n = 0;
  const names = new Map<string, string>();
  return REF.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (w) => {
    if (KEYWORDS.has(w)) return w;
    if (!names.has(w)) names.set(w, `name${n++}`);
    return names.get(w)!;
  })
    .split("\n")
    .map((l) => (l.trim() ? `${l}  # mine` : l))
    .join("\n");
};
// a different, slower way to solve the same problem
const BRUTE = `import sys
from functools import lru_cache

class Solution:
    def minDistance(self, left, right):
        sys.setrecursionlimit(10000)

        @lru_cache(maxsize=None)
        def solve(x, y):
            if x == len(left):
                return len(right) - y
            if y == len(right):
                return len(left) - x
            if left[x] == right[y]:
                return solve(x + 1, y + 1)
            insert = solve(x, y + 1)
            delete = solve(x + 1, y)
            replace = solve(x + 1, y + 1)
            return 1 + min(insert, delete, replace)

        return solve(0, 0)
`;

const BODY = {
  title: "Integrity round",
  kind: "private",
  scoring: "icpc",
  startsAt: new Date(Date.now() - 10 * 1000).toISOString(),
  durationMinutes: 60,
  problems: [{ slug: "edit-distance" }, { slug: "valid-parentheses" }],
};

async function contest() {
  const made = await call<ContestDetailDto>("POST", "/contests", tokens.ada!, BODY);
  expect(made.status).toBe(201);
  for (const n of ["bob", "cy"]) {
    const r = await call("POST", `/contests/${made.body.slug}/register`, tokens[n]!, {
      inviteCode: made.body.inviteCode,
    });
    expect(r.status).toBe(200);
  }
  return made.body.slug;
}
const solve = (who: string, slug: string, code: string) =>
  solveProblem(t, tokens[who]!, "edit-distance", "AC", {
    mode: "contest",
    contestSlug: slug,
    code,
  });
const scan = (slug: string, who = "rev") =>
  call<ScanResult>("POST", "/admin/integrity/scan", tokens[who]!, { contestSlug: slug });
const flags = (query = "", who = "rev") =>
  call<FlagListResponse>("GET", `/admin/integrity/flags${query}`, tokens[who]!);

describe("scanning a contest", () => {
  it("flags a renamed copy for both authors and leaves an independent solution alone", async () => {
    const slug = await contest();
    await solve("ada", slug, REF);
    await solve("bob", slug, disguised());
    await solve("cy", slug, BRUTE);
    const res = await scan(slug);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ participants: 3, flagsCreated: 2 });

    const list = await flags();
    expect(list.body.open).toBe(2);
    expect(list.body.items.map((f) => f.user.handle).sort()).toEqual(["h_ada", "h_bob"]);
    expect(list.body.items.every((f) => f.kind === "similarity" && f.score! >= 0.9)).toBe(true);
    expect(list.body.items.every((f) => f.status === "open")).toBe(true);
  });

  it("shows both programs side by side with the matching lines marked", async () => {
    const slug = await contest();
    await solve("ada", slug, REF);
    await solve("bob", slug, disguised());
    await scan(slug);
    const item = (await flags()).body.items.find((f) => f.user.handle === "h_ada")!;
    const detail = (await call<FlagDetail>("GET", `/admin/integrity/flags/${item.id}`, tokens.rev!))
      .body;
    expect(detail.pairs).toHaveLength(1);
    const pair = detail.pairs[0]!;
    expect(pair.similarity).toBeGreaterThanOrEqual(0.9);
    expect(pair.mine.handle).toBe("h_ada");
    expect(pair.other.handle).toBe("h_bob");
    expect(pair.mine.matchedLines.length).toBeGreaterThan(3);
    expect(pair.other.code).toContain("name0");
  });

  it("is repeatable: a second scan changes nothing that was already there", async () => {
    const slug = await contest();
    await solve("ada", slug, REF);
    await solve("bob", slug, disguised());
    await scan(slug);
    const again = await scan(slug);
    expect(again.body).toMatchObject({ flagsCreated: 0, flagsUpdated: 2 });
    expect((await flags()).body.items).toHaveLength(2);
  });

  it("does not flag tiny answers, which honest learners write alike", async () => {
    const slug = await contest();
    const tiny = "class Solution:\n    def twoSum(self, nums, target):\n        return []\n";
    await solve("ada", slug, tiny);
    await solve("bob", slug, tiny);
    expect((await scan(slug)).body).toMatchObject({ compared: 0, flagsCreated: 0 });
  });

  it("raises the severity when pasting and tab changes agree with the match", async () => {
    const slug = await contest();
    await solve("ada", slug, REF);
    await solve("bob", slug, disguised());
    await t.pool.query(
      `UPDATE contest_participants SET integrity = '{"paste": 6, "blur": 20}' WHERE user_id = (SELECT id FROM users WHERE email = 'bob@example.com')`,
    );
    await scan(slug);
    const bob = (await flags()).body.items.filter((f) => f.user.handle === "h_bob");
    const similarity = bob.find((f) => f.kind === "similarity")!;
    expect(similarity.severity).toBe("high");
    expect(bob.map((f) => f.kind).sort()).toEqual(["focus", "paste", "similarity"]);
    const detail = (
      await call<FlagDetail>("GET", `/admin/integrity/flags/${similarity.id}`, tokens.rev!)
    ).body;
    expect(detail.aggravating).toEqual([
      "6 paste events during the contest",
      "20 times the window lost focus",
    ]);
  });

  it("treats a few pastes and tab changes as normal", async () => {
    const slug = await contest();
    await t.pool.query(
      `UPDATE contest_participants SET integrity = '{"paste": 2, "blur": 9}' WHERE user_id = (SELECT id FROM users WHERE email = 'cy@example.com')`,
    );
    await scan(slug);
    expect((await flags()).body.items).toEqual([]);
  });
});

describe("who may review", () => {
  it("is for reviewers, admins and moderators only", async () => {
    expect((await call("GET", "/admin/integrity/flags", tokens.ada!)).status).toBe(403);
    expect((await call("GET", "/admin/integrity/flags", null)).status).toBe(401);
    expect(
      (await call("POST", "/admin/integrity/scan", tokens.bob!, { contestSlug: "x" })).status,
    ).toBe(403);
    expect((await call("GET", "/admin/integrity/flags", tokens.rev!)).status).toBe(200);
  });
  it("answers 404 for an unknown contest or flag", async () => {
    expect((await scan("nope")).status).toBe(404);
    expect(
      (
        await call(
          "GET",
          "/admin/integrity/flags/00000000-0000-4000-8000-000000000000",
          tokens.rev!,
        )
      ).status,
    ).toBe(404);
  });
});

describe("decisions", () => {
  async function flagged() {
    const slug = await contest();
    await solve("ada", slug, REF);
    await solve("bob", slug, disguised());
    await solve("cy", slug, BRUTE);
    await scan(slug);
    const items = (await flags()).body.items;
    return {
      slug,
      bob: items.find((f) => f.user.handle === "h_bob")!,
      ada: items.find((f) => f.user.handle === "h_ada")!,
    };
  }
  const standings = async (slug: string) =>
    (await call<StandingsResponse>("GET", `/contests/${slug}/standings`, tokens.cy!)).body.rows.map(
      (r) => r.handle,
    );
  const decide = (
    id: string,
    decision: string,
    note = "Reviewed the code side by side.",
    who = "rev",
  ) => call<FlagDetail>("PATCH", `/admin/integrity/flags/${id}`, tokens[who]!, { decision, note });

  it("changes nothing until a person confirms", async () => {
    const { slug } = await flagged();
    expect((await standings(slug)).sort()).toEqual(["h_ada", "h_bob", "h_cy"]);
  });

  it("takes a participant out of the standings only when a flag is confirmed", async () => {
    const { slug, bob } = await flagged();
    const done = await decide(bob.id, "confirm");
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "confirmed", reviewedBy: "h_rev" });
    expect((await standings(slug)).sort()).toEqual(["h_ada", "h_cy"]);
  });

  it("puts them back when the flag is dismissed later", async () => {
    const { slug, bob } = await flagged();
    await decide(bob.id, "confirm");
    await decide(bob.id, "dismiss", "On a second look the two were written independently.");
    expect((await standings(slug)).sort()).toEqual(["h_ada", "h_bob", "h_cy"]);
  });

  it("needs a reason and audits every decision", async () => {
    const { bob } = await flagged();
    expect((await decide(bob.id, "confirm", "x")).status).toBe(422);
    await decide(bob.id, "dismiss", "Same textbook solution, written independently.");
    const rows = (
      await t.pool.query(
        `SELECT action, actor_role, reason FROM admin_audit_log WHERE entity_type = 'integrity_flag' AND entity_id = $1`,
        [bob.id],
      )
    ).rows;
    expect(rows).toEqual([
      {
        action: "integrity.dismiss",
        actor_role: "reviewer",
        reason: "Same textbook solution, written independently.",
      },
    ]);
  });

  it("lets a moderator escalate, and only an admin decide an escalated flag", async () => {
    const { bob } = await flagged();
    const esc = await decide(bob.id, "escalate", "Needs a second pair of eyes.", "mod");
    expect(esc.status, JSON.stringify(esc.body)).toBe(200);
    expect(esc.body.status).toBe("escalated");
    expect((await decide(bob.id, "confirm", "Confirming it myself.", "rev")).status).toBe(403);
    expect((await decide(bob.id, "confirm", "Confirmed after reading both.", "adm")).status).toBe(
      200,
    );
  });

  it("does not let an already decided flag be escalated", async () => {
    const { bob } = await flagged();
    await decide(bob.id, "dismiss", "Independent solutions, same idea.");
    expect((await decide(bob.id, "escalate", "Changed my mind.")).status).toBe(409);
  });
});

describe("the learner's side", () => {
  async function confirmed() {
    const slug = await contest();
    await solve("ada", slug, REF);
    await solve("bob", slug, disguised());
    await scan(slug);
    const bob = (await flags()).body.items.find((f) => f.user.handle === "h_bob")!;
    await call("PATCH", `/admin/integrity/flags/${bob.id}`, tokens.rev!, {
      decision: "confirm",
      note: "The two solutions match line for line after renaming.",
    });
    return bob.id;
  }
  const mine = async (who: string) =>
    (await call<{ items: MyIntegrityNotice[] }>("GET", "/me/integrity", tokens[who]!)).body.items;

  it("tells a learner nothing while a flag is open", async () => {
    const slug = await contest();
    await solve("ada", slug, REF);
    await solve("bob", slug, disguised());
    await scan(slug);
    expect(await mine("bob")).toEqual([]);
  });

  it("tells them the decision and the reason, without the evidence", async () => {
    await confirmed();
    const [notice] = await mine("bob");
    expect(notice).toMatchObject({
      status: "confirmed",
      kind: "similarity",
      canAppeal: true,
      decisionNote: "The two solutions match line for line after renaming.",
    });
    expect(JSON.stringify(notice)).not.toContain("h_ada");
    expect(await mine("ada")).toEqual([]);
  });

  it("lets them appeal once, and a reviewer decides again", async () => {
    const id = await confirmed();
    const short = await call("POST", `/me/integrity/${id}/appeal`, tokens.bob!, { text: "no" });
    expect(short.status).toBe(422);
    const ok = await call<MyIntegrityNotice>("POST", `/me/integrity/${id}/appeal`, tokens.bob!, {
      text: "I wrote this alone; we use the same course template and the same helper idea.",
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "appealed", canAppeal: false });
    expect(
      (await call("POST", `/me/integrity/${id}/appeal`, tokens.bob!, { text: "x".repeat(30) }))
        .status,
    ).toBe(409);

    const queue = await flags("?status=appealed");
    expect(queue.body.items.map((f) => f.id)).toEqual([id]);
    const detail = (await call<FlagDetail>("GET", `/admin/integrity/flags/${id}`, tokens.rev!))
      .body;
    expect(detail.appealText).toContain("same course template");

    await call("PATCH", `/admin/integrity/flags/${id}`, tokens.rev!, {
      decision: "dismiss",
      note: "Appeal accepted: the shared template explains the overlap.",
    });
    const [after] = await mine("bob");
    expect(after).toMatchObject({ status: "dismissed", canAppeal: false });
  });

  it("does not let someone appeal another learner's flag", async () => {
    const id = await confirmed();
    const res = await call("POST", `/me/integrity/${id}/appeal`, tokens.cy!, {
      text: "x".repeat(30),
    });
    expect(res.status).toBe(404);
  });
});
