import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EditorialDto, HintsResponse, HintUnlocked } from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import { bearer, makeTestApp, signupAndLogin, type TestApp } from "../../test/helpers.js";

let t: TestApp;
let ada: string;
let bob: string;
let problemId: string;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses"]);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  const { rows } = await t.pool.query("SELECT id FROM problems WHERE slug = 'two-sum'");
  problemId = rows[0].id;
  // the content import already wrote hints and an editorial; replace them with known text
  await t.pool.query("DELETE FROM hints");
  await t.pool.query("DELETE FROM editorials");
  await t.pool.query(
    `INSERT INTO hints (id, problem_id, tier, body_md) VALUES
      (gen_random_uuid(), $1, 1, 'NUDGE: think about complements'),
      (gen_random_uuid(), $1, 2, 'APPROACH: a hash map of seen values'),
      (gen_random_uuid(), $1, 3, 'PSEUDO: for each x, look up target - x')`,
    [problemId],
  );
  await t.pool.query(
    `INSERT INTO editorials (id, problem_id, approaches, talk_track_md) VALUES
      (gen_random_uuid(), $1, $2::jsonb, 'Say it in two minutes')`,
    [
      problemId,
      JSON.stringify([
        {
          name: "Hash map",
          intuition: "SECRET INTUITION",
          steps: ["scan", "look up the complement"],
          code: { python: "class Solution: ..." },
          time: "O(n)",
          space: "O(n)",
        },
      ]),
    ],
  );
});
afterAll(() => t.close());

beforeEach(async () => {
  await t.pool.query("DELETE FROM hint_usage");
  await t.pool.query("DELETE FROM user_problem_state");
  await t.pool.query("UPDATE user_settings SET hint_mode = 'strict', open_editorials = false");
});

const call = (method: "GET" | "POST", url: string, token: string | null, payload?: object) =>
  t.app.inject({
    method,
    url,
    ...(token ? { headers: bearer(token) } : {}),
    ...(payload ? { payload } : {}),
  });

const open = (token = ada) => call("GET", "/v1/problems/two-sum", token);
const hints = async (token = ada) =>
  (await call("GET", "/v1/problems/two-sum/hints", token)).json<HintsResponse>();
const unlock = (tier: number, token = ada) =>
  call("POST", `/v1/problems/two-sum/hints/${tier}/unlock`, token, {});
const editorial = (token = ada) => call("GET", "/v1/problems/two-sum/editorial", token);

/** Pretend the problem was first opened `minutes` ago. */
const seenAgo = (minutes: number, handle = "ada_l") =>
  t.pool.query(
    `UPDATE user_problem_state SET first_seen_at = now() - make_interval(mins => $1)
     WHERE user_id = (SELECT user_id FROM profiles WHERE handle = $2)`,
    [minutes, handle],
  );
const hintViewedAgo = (tier: number, minutes: number) =>
  t.pool.query(
    "UPDATE hint_usage SET used_at = now() - make_interval(mins => $1) WHERE tier = $2",
    [minutes, tier],
  );
const markSolved = (handle = "ada_l") =>
  t.pool.query(
    `INSERT INTO user_problem_state (user_id, problem_id, status, attempts)
     SELECT user_id, $1, 'solved', 1 FROM profiles WHERE handle = $2
     ON CONFLICT (user_id, problem_id) DO UPDATE SET status = 'solved'`,
    [problemId, handle],
  );

describe("hints (D4)", () => {
  it("require sign-in", async () => {
    expect((await call("GET", "/v1/problems/two-sum/hints", null)).statusCode).toBe(401);
    expect((await call("POST", "/v1/problems/two-sum/hints/1/unlock", null, {})).statusCode).toBe(
      401,
    );
  });

  it("start locked behind the first-hint wait and never reveal their text", async () => {
    await open();
    const res = await call("GET", "/v1/problems/two-sum/hints", ada);
    const body = res.json<HintsResponse>();
    expect(body).toMatchObject({ mode: "strict", hintsUsed: 0 });
    expect(body.tiers.map((x) => x.tier)).toEqual([1, 2, 3]);
    expect(body.tiers[0]?.locked).toMatchObject({ reason: "cooldown" });
    const wait = Date.parse(body.tiers[0]?.locked?.unlockAt ?? "") - Date.now();
    expect(wait).toBeGreaterThan(170_000);
    expect(wait).toBeLessThanOrEqual(180_000);
    expect(body.tiers[1]?.locked).toEqual({ reason: "previous_tier", missingTier: 1 });
    expect(res.body).not.toMatch(/NUDGE|APPROACH|PSEUDO/);
  });

  it("refuse an early hint with the time it unlocks, then allow it after the wait", async () => {
    await open();
    const early = await unlock(1);
    expect(early.statusCode).toBe(403);
    expect(early.json().error).toMatchObject({
      code: "HINT_LOCKED",
      details: { reason: "cooldown" },
    });
    expect(early.body).not.toMatch(/NUDGE/);

    await seenAgo(4);
    const ok = await unlock(1);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<HintUnlocked>()).toMatchObject({ tier: 1, hintsUsed: 1 });
    expect(ok.json<HintUnlocked>().bodyMd).toContain("NUDGE");

    const state = await t.pool.query("SELECT hints_used FROM user_problem_state");
    expect(state.rows[0].hints_used).toBe(1);
  });

  it("must be viewed in order, with a pause between tiers", async () => {
    await open();
    await seenAgo(10);
    const skip = await unlock(3);
    expect(skip.statusCode).toBe(403);
    expect(skip.json().error.details).toEqual({ reason: "previous_tier", missingTier: 1 });

    expect((await unlock(1)).statusCode).toBe(200);
    const tooSoon = await unlock(2);
    expect(tooSoon.statusCode).toBe(403);
    expect(tooSoon.json().error.details.reason).toBe("cooldown");

    await hintViewedAgo(1, 6);
    expect((await unlock(2)).statusCode).toBe(200);
    expect((await unlock(3)).statusCode).toBe(403); // another pause
    await hintViewedAgo(2, 6);
    const third = await unlock(3);
    expect(third.json<HintUnlocked>()).toMatchObject({ tier: 3, hintsUsed: 3 });
  });

  it("can be read again for free and show their text in the overview once viewed", async () => {
    await open();
    await seenAgo(10);
    await unlock(1);
    const again = await unlock(1);
    expect(again.statusCode).toBe(200);
    const { rows } = await t.pool.query("SELECT count(*)::int AS n FROM hint_usage");
    expect(rows[0].n).toBe(1);
    const overview = await hints();
    expect(overview.tiers[0]).toMatchObject({ viewed: true });
    expect(overview.tiers[0]?.bodyMd).toContain("NUDGE");
    expect(overview.tiers[1]?.bodyMd).toBeUndefined();
  });

  it("are quicker in relaxed mode", async () => {
    await t.pool.query(
      "UPDATE user_settings SET hint_mode = 'relaxed' WHERE user_id = (SELECT user_id FROM profiles WHERE handle = 'ada_l')",
    );
    await open();
    expect((await unlock(1)).statusCode).toBe(200); // no wait for the first hint
    expect((await unlock(2)).statusCode).toBe(403); // still a minute between tiers
    await hintViewedAgo(1, 2);
    expect((await unlock(2)).statusCode).toBe(200);
  });

  it("only need the right order once the problem is solved", async () => {
    await open();
    await markSolved();
    expect((await unlock(2)).statusCode).toBe(403);
    expect((await unlock(1)).statusCode).toBe(200);
    expect((await unlock(2)).statusCode).toBe(200);
  });

  it("are tracked per user and validated", async () => {
    await open();
    await open(bob);
    await seenAgo(10);
    await unlock(1);
    expect((await hints(bob)).tiers[0]?.viewed).toBe(false);
    expect((await call("POST", "/v1/problems/two-sum/hints/4/unlock", ada, {})).statusCode).toBe(
      422,
    );
    expect((await call("POST", "/v1/problems/two-sum/hints/0/unlock", ada, {})).statusCode).toBe(
      422,
    );
    expect((await call("POST", "/v1/problems/nope/hints/1/unlock", ada, {})).statusCode).toBe(404);
    // valid-parentheses has no hints authored
    expect(
      (await call("POST", "/v1/problems/valid-parentheses/hints/1/unlock", ada, {})).statusCode,
    ).toBe(404);
    expect((await call("GET", "/v1/problems/valid-parentheses/hints", ada)).json().tiers).toEqual(
      [],
    );
  });

  it("make the next submission remember how many were used", async () => {
    await open();
    await seenAgo(10);
    await unlock(1);
    await hintViewedAgo(1, 6);
    await unlock(2);
    const res = await call("POST", "/v1/submissions", ada, {
      problemSlug: "two-sum",
      language: "python",
      code: "class Solution: pass",
      kind: "submit",
    });
    const { submissionId } = res.json<{ submissionId: string }>();
    const { rows } = await t.pool.query("SELECT hints_used FROM submissions WHERE id = $1", [
      submissionId,
    ]);
    expect(rows[0].hints_used).toBe(2);
    await t.pool.query("DELETE FROM submissions");
  });
});

describe("editorial (D5)", () => {
  it("is locked until earned, listing the ways in, and leaks nothing", async () => {
    await open();
    const res = await editorial();
    expect(res.statusCode).toBe(403);
    const err = res.json().error;
    expect(err.code).toBe("EDITORIAL_LOCKED");
    expect(err.details.reasons).toHaveLength(3);
    expect(err.details.canGiveUp).toBe(false);
    expect(err.details.giveUpAt).toBeTruthy();
    expect(res.body).not.toMatch(/SECRET|Hash map/);
    expect((await call("GET", "/v1/problems/two-sum/editorial", null)).statusCode).toBe(401);
  });

  it("unlocks after solving", async () => {
    await open();
    await markSolved();
    const res = await editorial();
    expect(res.statusCode).toBe(200);
    expect(res.json<EditorialDto>()).toMatchObject({
      via: "solved",
      talkTrackMd: "Say it in two minutes",
      approaches: [{ name: "Hash map", time: "O(n)", code: { python: expect.any(String) } }],
    });
  });

  it("unlocks after all three hints, but not two", async () => {
    await open();
    await t.pool.query(
      `INSERT INTO hint_usage (user_id, problem_id, tier, used_at)
       SELECT user_id, $1, g, now() FROM profiles, generate_series(1, 2) g WHERE handle = 'ada_l'`,
      [problemId],
    );
    expect((await editorial()).statusCode).toBe(403);
    await t.pool.query(
      `INSERT INTO hint_usage (user_id, problem_id, tier) SELECT user_id, $1, 3 FROM profiles WHERE handle = 'ada_l'`,
      [problemId],
    );
    expect((await editorial()).json<EditorialDto>().via).toBe("hints");
  });

  it("unlocks with the open-editorials setting", async () => {
    await open();
    await t.pool.query(
      "UPDATE user_settings SET open_editorials = true WHERE user_id = (SELECT user_id FROM profiles WHERE handle = 'ada_l')",
    );
    expect((await editorial()).json<EditorialDto>().via).toBe("setting");
    expect((await editorial(bob)).statusCode).toBe(403); // someone else's setting
  });

  it("can be unlocked by giving up, after a wait and a confirmation", async () => {
    await open();
    const giveUp = (body: object = { confirm: true }) =>
      call("POST", "/v1/problems/two-sum/editorial/give-up", ada, body);

    expect((await giveUp({})).statusCode).toBe(422); // no confirmation
    expect((await giveUp({ confirm: false })).statusCode).toBe(422);
    const early = await giveUp();
    expect(early.statusCode).toBe(403);
    expect(early.json().error.code).toBe("GIVE_UP_TOO_EARLY");
    expect(early.json().error.details.availableAt).toBeTruthy();
    expect((await editorial()).statusCode).toBe(403);

    await seenAgo(11);
    const status = await call("GET", "/v1/problems/two-sum/editorial/status", ada);
    expect(status.json()).toMatchObject({ exists: true, unlocked: false, canGiveUp: true });

    const done = await giveUp();
    expect(done.statusCode).toBe(200);
    expect(done.json<EditorialDto>().via).toBe("gave_up");
    expect((await editorial()).statusCode).toBe(200);
    const { rows } = await t.pool.query(
      "SELECT gave_up_at IS NOT NULL AS gave_up FROM user_problem_state",
    );
    expect(rows[0].gave_up).toBe(true);
  });

  it("reports a missing editorial as 404, and its status without revealing content", async () => {
    expect((await call("GET", "/v1/problems/valid-parentheses/editorial", ada)).statusCode).toBe(
      404,
    );
    expect(
      (await call("GET", "/v1/problems/valid-parentheses/editorial/status", ada)).json(),
    ).toEqual({
      exists: false,
      unlocked: false,
    });
    const status = (await call("GET", "/v1/problems/two-sum/editorial/status", ada)).json();
    expect(JSON.stringify(status)).not.toMatch(/SECRET|Hash map/);
  });
});

describe("self-rating", () => {
  const rate = (rating: unknown, token = ada) =>
    call("POST", "/v1/problems/two-sum/rating", token, { rating });

  it("needs a solved problem", async () => {
    await open();
    const res = await rate("good");
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_SOLVED");
  });

  it("is stored for the solver and validated", async () => {
    await open();
    await markSolved();
    expect((await rate("hard")).json()).toEqual({ rating: "hard" });
    expect((await rate("again")).statusCode).toBe(200); // can change their mind
    const { rows } = await t.pool.query(
      "SELECT solve_rating FROM user_problem_state WHERE status = 'solved'",
    );
    expect(rows).toEqual([{ solve_rating: "again" }]);
    expect((await rate("amazing")).statusCode).toBe(422);
    expect((await rate("easy", bob)).statusCode).toBe(403); // bob hasn't solved it
  });
});
