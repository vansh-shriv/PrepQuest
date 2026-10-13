import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type {
  ContestDetailDto,
  ContestListResponse,
  ContestMeDto,
  StandingsResponse,
  UserRole,
} from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import { bearer, makeTestApp, signup, type TestApp } from "../../test/helpers.js";
import { resetLearning, solveProblem } from "../../test/solve.js";

let t: TestApp;
let ada: string;
let bob: string;
let cy: string;
let reviewer: string;
let adaId: string;
let bobId: string;

const MIN = 60_000;

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
const userId = async (n: string) =>
  (await t.pool.query(`SELECT id FROM users WHERE email = $1`, [`${n}@example.com`])).rows[0]
    .id as string;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses", "three-sum"]);
  ada = await actingAs("user", "ada");
  bob = await actingAs("user", "bob");
  cy = await actingAs("user", "cy");
  reviewer = await actingAs("reviewer", "rev");
  adaId = await userId("ada");
  bobId = await userId("bob");
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetLearning(t);
});

const call = <T>(
  method: "GET" | "POST",
  url: string,
  token: string,
  payload?: object,
): Promise<{ status: number; body: T }> =>
  t.app
    .inject({ method, url: `/v1${url}`, headers: bearer(token), ...(payload ? { payload } : {}) })
    .then((r) => ({ status: r.statusCode, body: r.json<T>() }));

const BODY = (over: object = {}) => ({
  title: "Friday night round",
  kind: "private",
  scoring: "icpc",
  startsAt: new Date(Date.now() - 10 * 1000).toISOString(),
  durationMinutes: 60,
  problems: [{ slug: "two-sum" }, { slug: "valid-parentheses", points: 200 }],
  ...over,
});
const create = async (token: string, over: object = {}) => {
  const r = await call<ContestDetailDto>("POST", "/contests", token, BODY(over));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};
const submit = (token: string, slug: string, contest: string, verdict = "AC") =>
  solveProblem(t, token, slug, verdict as "AC", { mode: "contest", contestSlug: contest });

describe("creating and listing contests", () => {
  it("lets anyone run a private contest, with a code only the creator sees", async () => {
    const c = await create(ada);
    expect(c).toMatchObject({
      kind: "private",
      phase: "running",
      problemCount: 2,
      isCreator: true,
      registered: true,
      durationMinutes: 60,
    });
    expect(c.inviteCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(c.problems!.map((p) => [p.label, p.slug])).toEqual([
      ["A", "two-sum"],
      ["B", "valid-parentheses"],
    ]);
    // someone without the code cannot even see it
    expect((await call("GET", `/contests/${c.slug}`, bob)).status).toBe(404);
    const withCode = await call<ContestDetailDto>(
      "GET",
      `/contests/${c.slug}?code=${c.inviteCode}`,
      bob,
    );
    expect(withCode.body.inviteCode).toBeNull();
    expect(withCode.body.canRegister).toBe(true);
  });

  it("reserves public contests for reviewers and admins", async () => {
    expect((await call("POST", "/contests", ada, BODY({ kind: "weekly" }))).status).toBe(403);
    const ok = await call<ContestDetailDto>(
      "POST",
      "/contests",
      reviewer,
      BODY({ kind: "weekly" }),
    );
    expect(ok.status).toBe(201);
    expect(ok.body.inviteCode).toBeNull();
    const seen = await call<ContestListResponse>("GET", "/contests", bob);
    expect(seen.body.contests.map((x) => x.slug)).toContain(ok.body.slug);
  });

  it("rejects bad contests", async () => {
    const past = await call("POST", "/contests", ada, BODY({ startsAt: "2020-01-01T00:00:00Z" }));
    expect(past.status).toBe(422);
    const twice = await call(
      "POST",
      "/contests",
      ada,
      BODY({ problems: [{ slug: "two-sum" }, { slug: "two-sum" }] }),
    );
    expect(twice.status).toBe(422);
    const unknown = await call("POST", "/contests", ada, BODY({ problems: [{ slug: "nope" }] }));
    expect(unknown.status).toBe(422);
  });

  it("hides the problems until the contest starts, and lists by phase", async () => {
    const later = await create(ada, {
      startsAt: new Date(Date.now() + 60 * MIN).toISOString(),
    });
    expect(later.phase).toBe("upcoming");
    expect(later.secondsLeft).toBeGreaterThan(3000);
    // the creator may prepare; everyone else sees only the count
    const reg = await call("POST", `/contests/${later.slug}/register`, bob, {
      inviteCode: later.inviteCode,
    });
    expect(reg.status).toBe(200);
    const asBob = await call<ContestDetailDto>("GET", `/contests/${later.slug}`, bob);
    expect(asBob.body.problems).toBeNull();
    expect(asBob.body.problemCount).toBe(2);
    const upcoming = await call<ContestListResponse>("GET", "/contests?status=upcoming", bob);
    expect(upcoming.body.contests.map((c) => c.slug)).toEqual([later.slug]);
    const running = await call<ContestListResponse>("GET", "/contests?status=running", bob);
    expect(running.body.contests).toEqual([]);
  });
});

describe("registering", () => {
  it("needs the invite code for a private contest and is idempotent", async () => {
    const c = await create(ada);
    expect((await call("POST", `/contests/${c.slug}/register`, bob, {})).status).toBe(404);
    expect(
      (await call("POST", `/contests/${c.slug}/register`, bob, { inviteCode: "WRONGONE" })).status,
    ).toBe(404);
    const ok = await call<ContestDetailDto>("POST", `/contests/${c.slug}/register`, bob, {
      inviteCode: c.inviteCode,
    });
    expect(ok.body).toMatchObject({ registered: true, participants: 2 });
    const again = await call<ContestDetailDto>("POST", `/contests/${c.slug}/register`, bob, {});
    expect(again.body.participants).toBe(2);
  });

  it("allows a late join and refuses after the end", async () => {
    const reviewerContest = await call<ContestDetailDto>(
      "POST",
      "/contests",
      reviewer,
      BODY({ kind: "weekly" }),
    );
    const slug = reviewerContest.body.slug;
    const late = await call<ContestDetailDto>("POST", `/contests/${slug}/register`, bob);
    expect(late.status).toBe(200);
    const me = await call<ContestMeDto>("GET", `/contests/${slug}/me`, bob);
    // a late joiner still gets the contest's own end time
    expect(me.body.participation!.secondsLeft).toBeGreaterThan(3400);
    await t.pool.query(
      `UPDATE contests SET starts_at = now() - interval '3 hours', ends_at = now() - interval '2 hours' WHERE slug = $1`,
      [slug],
    );
    const tooLate = await call<{ error: { code: string } }>(
      "POST",
      `/contests/${slug}/register`,
      cy,
    );
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.error.code).toBe("CONTEST_ENDED");
  });
});

describe("taking part", () => {
  it("accepts contest attempts only from registered participants inside the window", async () => {
    const c = await create(ada);
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: bearer(bob),
      payload: {
        problemSlug: "two-sum",
        language: "python",
        code: "x",
        kind: "submit",
        mode: "contest",
        contestSlug: c.slug,
      },
    });
    expect(res.statusCode).toBe(403); // not registered
    await call("POST", `/contests/${c.slug}/register`, bob, { inviteCode: c.inviteCode });
    await submit(bob, "two-sum", c.slug);
    const wrongProblem = await t.app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: bearer(bob),
      payload: {
        problemSlug: "three-sum",
        language: "python",
        code: "x",
        kind: "submit",
        mode: "contest",
        contestSlug: c.slug,
      },
    });
    expect(wrongProblem.statusCode).toBe(422);
    await t.pool.query(
      `UPDATE contests SET ends_at = now() - interval '1 second', starts_at = now() - interval '2 hours' WHERE slug = $1`,
      [c.slug],
    );
    const after = await t.app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: bearer(bob),
      payload: {
        problemSlug: "two-sum",
        language: "python",
        code: "x",
        kind: "submit",
        mode: "contest",
        contestSlug: c.slug,
      },
    });
    expect(after.statusCode).toBe(409);
    expect(after.json().error.code).toBe("CONTEST_NOT_RUNNING");
  });

  it("turns hints and editorials off for contest problems while the contest runs", async () => {
    const c = await create(ada);
    const open = await call("GET", "/problems/three-sum/hints", ada);
    expect(open.status).toBe(200); // not in the contest
    const locked = await call<{ error: { code: string } }>("GET", "/problems/two-sum/hints", ada);
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe("HINT_LOCKED");
    await t.pool.query(
      `UPDATE contests SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE slug = $1`,
      [c.slug],
    );
    expect((await call("GET", "/problems/two-sum/hints", ada)).status).toBe(200);
  });

  it("counts focus loss and pasting for the integrity review", async () => {
    const c = await create(ada);
    await call("POST", `/contests/${c.slug}/events`, ada, { type: "blur" });
    await call("POST", `/contests/${c.slug}/events`, ada, { type: "blur" });
    await call("POST", `/contests/${c.slug}/events`, ada, { type: "paste" });
    const row = (
      await t.pool.query(`SELECT integrity FROM contest_participants WHERE user_id = $1`, [adaId])
    ).rows[0];
    expect(row.integrity).toEqual({ blur: 2, paste: 1 });
  });
});

describe("standings", () => {
  const standings = (token: string, slug: string) =>
    call<StandingsResponse>("GET", `/contests/${slug}/standings`, token);

  it("updates the moment a verdict arrives and ranks by solved then penalty", async () => {
    const c = await create(ada);
    for (const [token, who] of [
      [bob, bobId],
      [cy, ""],
    ] as const) {
      void who;
      await call("POST", `/contests/${c.slug}/register`, token, { inviteCode: c.inviteCode });
    }
    await submit(ada, "two-sum", c.slug, "WA");
    let table = (await standings(ada, c.slug)).body;
    expect(table.rows.every((r) => r.solved === 0)).toBe(true);
    expect(table.rows.find((r) => r.handle === "h_ada")!.cells[0]).toMatchObject({
      wrong: 1,
      solved: false,
    });

    await submit(ada, "two-sum", c.slug, "AC");
    await submit(bob, "two-sum", c.slug, "AC");
    await submit(bob, "valid-parentheses", c.slug, "AC");
    table = (await standings(ada, c.slug)).body;
    expect(table.rows.map((r) => [r.handle, r.rank, r.solved])).toEqual([
      ["h_bob", 1, 2],
      ["h_ada", 2, 1],
      ["h_cy", 3, 0],
    ]);
    // ada: solved in minute 0 after one wrong attempt = 20 minutes of penalty
    expect(table.rows[1]!.penalty).toBe(20);
    expect(table.me).toMatchObject({ handle: "h_ada", rank: 2, isMe: true });
    expect(table.scoring).toBe("icpc");
    expect(table.problems.map((p) => p.label)).toEqual(["A", "B"]);
  });

  it("ignores practice submissions and runs", async () => {
    const c = await create(ada);
    await solveProblem(t, ada, "two-sum", "AC"); // practice
    const table = (await standings(ada, c.slug)).body;
    expect(table.rows[0]).toMatchObject({ solved: 0 });
  });

  it("scores by points when the contest asks for it", async () => {
    const c = await create(ada, { scoring: "points", durationMinutes: 100 });
    await submit(ada, "valid-parentheses", c.slug, "AC");
    const table = (await standings(ada, c.slug)).body;
    // solved at minute 0 of 100: all 200 points
    expect(table.rows[0]).toMatchObject({ solved: 1, score: 200 });
  });

  it("freezes the last minutes for everyone but the creator, and unfreezes at the end", async () => {
    const c = await create(ada, { freezeMinutes: 30, durationMinutes: 60 });
    await call("POST", `/contests/${c.slug}/register`, bob, { inviteCode: c.inviteCode });
    // move the start back so that "now" is inside the frozen half
    await t.pool.query(
      `UPDATE contests SET starts_at = now() - interval '40 minutes', ends_at = now() + interval '20 minutes' WHERE slug = $1`,
      [c.slug],
    );
    await t.pool.query(
      `UPDATE contest_participants SET started_at = now() - interval '40 minutes', ends_at = now() + interval '20 minutes'`,
    );
    await submit(bob, "two-sum", c.slug, "AC");
    const asBob = (await standings(bob, c.slug)).body;
    expect(asBob.frozen).toBe(true);
    expect(asBob.rows.find((r) => r.handle === "h_bob")).toMatchObject({ solved: 0 });
    expect(asBob.rows.find((r) => r.handle === "h_bob")!.cells[0]!.pending).toBe(1);
    const asCreator = (await standings(ada, c.slug)).body;
    expect(asCreator.frozen).toBe(false);
    expect(asCreator.rows.find((r) => r.handle === "h_bob")).toMatchObject({ solved: 1 });
    await t.pool.query(
      `UPDATE contests SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE slug = $1`,
      [c.slug],
    );
    await t.pool.query(
      `UPDATE submissions SET created_at = now() - interval '90 minutes' WHERE contest_id IS NOT NULL`,
    );
    const after = (await standings(bob, c.slug)).body;
    expect(after.frozen).toBe(false);
    expect(after.rows.find((r) => r.handle === "h_bob")).toMatchObject({ solved: 1 });
  });
});

describe("virtual contests", () => {
  const finished = async () => {
    const c = await create(ada);
    await call("POST", `/contests/${c.slug}/register`, bob, { inviteCode: c.inviteCode });
    await submit(bob, "two-sum", c.slug, "AC");
    await submit(bob, "valid-parentheses", c.slug, "AC");
    await submit(ada, "two-sum", c.slug, "AC");
    await t.pool.query(
      `UPDATE contests SET starts_at = now() - interval '3 hours', ends_at = now() - interval '2 hours' WHERE slug = $1`,
      [c.slug],
    );
    await t.pool.query(
      `UPDATE contest_participants SET started_at = now() - interval '3 hours', ends_at = now() - interval '2 hours'`,
    );
    await t.pool.query(
      `UPDATE submissions SET created_at = now() - interval '150 minutes' WHERE contest_id IS NOT NULL`,
    );
    return c;
  };

  it("replays a finished contest on your own clock and places you among the real results", async () => {
    const c = await finished();
    expect((await call("POST", `/contests/${c.slug}/virtual`, cy, {})).status).toBe(404); // private, no access
    const run = await call<ContestMeDto>("POST", `/contests/${c.slug}/virtual`, ada);
    expect(run.status).toBe(200);
    expect(run.body.participation).toMatchObject({ kind: "virtual" });
    expect(run.body.participation!.secondsLeft).toBeGreaterThan(3500);
    // a second run cannot start while one is going
    expect((await call("POST", `/contests/${c.slug}/virtual`, ada)).status).toBe(409);

    // ada solves both problems in the replay, so she would beat bob's live time
    await submit(ada, "two-sum", c.slug, "AC");
    await submit(ada, "valid-parentheses", c.slug, "AC");
    const me = (await call<ContestMeDto>("GET", `/contests/${c.slug}/me`, ada)).body;
    expect(me.virtual).toMatchObject({ solved: 2 });
    expect(me.virtual!.wouldRank).toBeLessThanOrEqual(2);
    expect(me.virtual!.of).toBe(3);
    // the real standings are untouched by the replay
    const real = (await call<StandingsResponse>("GET", `/contests/${c.slug}/standings`, ada)).body;
    expect(real.rows.find((r) => r.handle === "h_ada")).toMatchObject({ solved: 1 });
  });

  it("refuses a virtual run while the contest is still on", async () => {
    const c = await create(ada);
    const r = await call<{ error: { code: string } }>("POST", `/contests/${c.slug}/virtual`, ada);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CONTEST_NOT_OVER");
  });
});
