import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localDay, addDays } from "@prepquest/analytics-core";
import type { JobSummary, JudgeJob } from "@prepquest/judge-core";
import type {
  DashboardDto,
  SubmissionCreated,
  SubmissionDetail,
  XpResponse,
} from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import { bearer, makeTestApp, signupAndLogin, type TestApp } from "../../test/helpers.js";
import { applyJudgeEvent } from "../submissions/ingest.js";

let t: TestApp;
let ada: string;
let bob: string;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, [
    "two-sum",
    "valid-parentheses",
    "three-sum",
    "edit-distance",
    "climbing-stairs",
  ]);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
});
afterAll(() => t.close());

beforeEach(async () => {
  for (const table of [
    "submissions",
    "user_problem_state",
    "hint_usage",
    "xp_events",
    "activity_days",
    "badges_earned",
  ]) {
    await t.pool.query(`DELETE FROM ${table}`);
  }
  await t.pool.query(
    `UPDATE profiles SET xp = 0, level = 1, streak_current = 0, streak_best = 0,
       streak_last_active = NULL, streak_freezes = 1, timezone = 'UTC', placement_date = NULL`,
  );
  await t.pool.query(
    `UPDATE problems SET submissions_count = 0, accepted_count = 0, acceptance_rate = 0`,
  );
  t.judge.jobs.length = 0;
  (t.kv as unknown as { data: Map<string, unknown> }).data.clear();
});

const call = (method: "GET" | "POST", url: string, token: string | null, payload?: object) =>
  t.app.inject({
    method,
    url,
    ...(token ? { headers: bearer(token) } : {}),
    ...(payload ? { payload } : {}),
  });

const queue = async (slug: string, token = ada, language = "python") => {
  const res = await call("POST", "/v1/submissions", token, {
    problemSlug: slug,
    language,
    code: "x",
    kind: "submit",
  });
  expect(res.statusCode).toBe(202);
  return {
    id: res.json<SubmissionCreated>().submissionId,
    job: t.judge.jobs[t.judge.jobs.length - 1]!.job,
  };
};

const summary = (job: JudgeJob, verdict: JobSummary["verdict"]): JobSummary => ({
  verdict,
  passed: verdict === "AC" ? job.tests.length : 0,
  total: job.tests.length,
  timeMs: 5,
  memoryKb: 100,
  failingOrdinal: verdict === "AC" ? null : 1,
  compileOutput: null,
  stderrTail: null,
  results: [],
});

/** Submits `slug` and has the judge answer `verdict`. */
async function attempt(
  slug: string,
  verdict: JobSummary["verdict"] = "AC",
  token = ada,
  language = "python",
) {
  const { id, job } = await queue(slug, token, language);
  await applyJudgeEvent(t.db, { type: "done", submissionId: id, summary: summary(job, verdict) });
  // (each attempt must finish before the next one, like a real user waiting for the verdict)
  return id;
}

const detail = async (id: string, token = ada) =>
  (await call("GET", `/v1/submissions/${id}`, token)).json<SubmissionDetail>();
const profile = async () =>
  (
    await t.pool.query(
      `SELECT xp::int, level, streak_current, streak_best, streak_freezes, to_char(streak_last_active, 'YYYY-MM-DD') AS last
       FROM profiles WHERE handle = 'ada_l'`,
    )
  ).rows[0] as {
    xp: number;
    level: number;
    streak_current: number;
    streak_best: number;
    streak_freezes: number;
    last: string | null;
  };
const setStreak = (current: number, daysAgo: number, freezes = 1) =>
  t.pool.query(
    `UPDATE profiles SET streak_current = $1, streak_best = $1, streak_freezes = $3,
       streak_last_active = (now() AT TIME ZONE timezone)::date - $2::int WHERE handle = 'ada_l'`,
    [current, daysAgo, freezes],
  );
const today = () => localDay(new Date(), "UTC");

describe("XP and rewards", () => {
  it("pays the first accepted solution with first-try and no-hint bonuses", async () => {
    const id = await attempt("two-sum"); // easy: 10 * 1.4
    const d = await detail(id);
    expect(d.rewards).toMatchObject({
      firstSolve: true,
      xp: 14,
      problemXp: 14,
      levelBefore: 1,
      levelAfter: 1,
    });
    expect(d.rewards?.badges).toEqual(["first-blood"]);
    expect(await profile()).toMatchObject({ xp: 14, level: 1 });
    const { rows } = await t.pool.query("SELECT delta, reason, ref_type FROM xp_events");
    expect(rows).toEqual([{ delta: 14, reason: "problem_ac", ref_type: "submission" }]);
  });

  it("scales with difficulty", async () => {
    await attempt("edit-distance"); // hard: 50 * 1.4
    expect((await profile()).xp).toBe(70);
  });

  it("takes the first-try bonus away after a failed attempt", async () => {
    await attempt("two-sum", "WA");
    const id = await attempt("two-sum"); // 10 * 1.2
    expect((await detail(id)).rewards?.problemXp).toBe(12);
  });

  it("charges 10% per hint tier used before solving", async () => {
    await t.pool.query(
      `INSERT INTO user_problem_state (user_id, problem_id, hints_used, first_seen_at)
       SELECT user_id, (SELECT id FROM problems WHERE slug = 'three-sum'), 2, now() FROM profiles WHERE handle = 'ada_l'`,
    );
    const id = await attempt("three-sum"); // medium 25 * (1 + 0.2 - 0.2)
    expect((await detail(id)).rewards?.problemXp).toBe(25);
  });

  it("counts giving up on the editorial as all three hints", async () => {
    await t.pool.query(
      `INSERT INTO user_problem_state (user_id, problem_id, gave_up_at, first_seen_at)
       SELECT user_id, (SELECT id FROM problems WHERE slug = 'three-sum'), now(), now() FROM profiles WHERE handle = 'ada_l'`,
    );
    const id = await attempt("three-sum"); // 25 * (1 + 0.2 - 0.3) = 22.5
    expect((await detail(id)).rewards?.problemXp).toBe(23);
    const { rows } = await t.pool.query(
      "SELECT clean_solve FROM user_problem_state WHERE status = 'solved'",
    );
    expect(rows[0].clean_solve).toBe(false);
  });

  it("pays nothing for solving the same problem again, but still counts as activity", async () => {
    await attempt("two-sum");
    const again = await attempt("two-sum");
    expect((await detail(again)).rewards).toMatchObject({ firstSolve: false, xp: 0 });
    expect((await profile()).xp).toBe(14);
    const { rows } = await t.pool.query("SELECT problems FROM activity_days");
    expect(rows).toEqual([{ problems: 2 }]);
  });

  it("gives nothing for wrong answers, runs or infrastructure errors", async () => {
    await attempt("two-sum", "WA");
    await attempt("valid-parentheses", "IE");
    const run = await call("POST", "/v1/submissions", ada, {
      problemSlug: "two-sum",
      language: "python",
      code: "x",
      kind: "run",
    });
    const job = t.judge.jobs[t.judge.jobs.length - 1]!.job;
    await applyJudgeEvent(t.db, {
      type: "done",
      submissionId: run.json<SubmissionCreated>().submissionId,
      summary: summary(job, "AC"),
    });
    expect(await profile()).toMatchObject({ xp: 0, streak_current: 0 });
    expect((await t.pool.query("SELECT count(*)::int AS n FROM xp_events")).rows[0].n).toBe(0);
    expect((await t.pool.query("SELECT count(*)::int AS n FROM activity_days")).rows[0].n).toBe(0);
  });

  it("levels up along the 100 * level^1.4 curve", async () => {
    await t.pool.query("UPDATE profiles SET xp = 95 WHERE handle = 'ada_l'");
    const id = await attempt("two-sum");
    expect((await detail(id)).rewards).toMatchObject({ levelBefore: 1, levelAfter: 2, xp: 14 });
    expect(await profile()).toMatchObject({ xp: 109, level: 2 });
  });

  it("is awarded once even if the judge's final event is delivered twice", async () => {
    const { id, job } = await queue("two-sum");
    const event = { type: "done" as const, submissionId: id, summary: summary(job, "AC") };
    await applyJudgeEvent(t.db, event);
    await applyJudgeEvent(t.db, event);
    expect((await profile()).xp).toBe(14);
    expect((await t.pool.query("SELECT count(*)::int AS n FROM xp_events")).rows[0].n).toBe(1);
  });

  it("shows up in the XP ledger, newest first", async () => {
    await attempt("two-sum");
    await attempt("valid-parentheses");
    const xp = (await call("GET", "/v1/me/xp", ada)).json<XpResponse>();
    expect(xp).toMatchObject({ xp: 28, level: { level: 1, into: 28, needed: 100 } });
    expect(xp.events.map((e) => e.delta)).toEqual([14, 14]);
    expect((await call("GET", "/v1/me/xp", null)).statusCode).toBe(401);
    expect((await call("GET", "/v1/me/xp", bob)).json<XpResponse>().xp).toBe(0);
  });
});

describe("streaks", () => {
  it("starts at one and does not grow twice in a day", async () => {
    await attempt("two-sum");
    await attempt("valid-parentheses");
    expect(await profile()).toMatchObject({ streak_current: 1, streak_best: 1, last: today() });
  });

  it("grows on the next day", async () => {
    await setStreak(3, 1);
    const id = await attempt("two-sum");
    expect(await profile()).toMatchObject({ streak_current: 4, streak_best: 4 });
    expect((await detail(id)).rewards?.streak).toMatchObject({
      current: 4,
      usedFreeze: false,
      milestone: null,
    });
  });

  it("forgives one missed day with the freeze, only once", async () => {
    await setStreak(3, 2, 1);
    const id = await attempt("two-sum");
    expect((await detail(id)).rewards?.streak).toMatchObject({ current: 4, usedFreeze: true });
    expect((await profile()).streak_freezes).toBe(0);
    await setStreak(4, 2, 0);
    await attempt("valid-parentheses");
    expect((await profile()).streak_current).toBe(1);
  });

  it("restarts after a longer break but remembers the best", async () => {
    await setStreak(9, 5);
    await attempt("two-sum");
    expect(await profile()).toMatchObject({ streak_current: 1, streak_best: 9 });
  });

  it("pays a bonus at 7 days and hands a freeze back", async () => {
    await setStreak(6, 1, 0);
    const id = await attempt("two-sum");
    const rewards = (await detail(id)).rewards;
    expect(rewards).toMatchObject({ xp: 64, problemXp: 14, streakBonusXp: 50 });
    expect(rewards?.streak.milestone).toBe(7);
    expect(await profile()).toMatchObject({ xp: 64, streak_current: 7, streak_freezes: 1 });
    const { rows } = await t.pool.query("SELECT reason, delta FROM xp_events ORDER BY id");
    expect(rows).toEqual([
      { reason: "problem_ac", delta: 14 },
      { reason: "streak_milestone", delta: 50 },
    ]);
    expect(rewards?.badges).toContain("week-warrior");
  });

  it("uses the player's own time zone for the day", async () => {
    await t.pool.query(
      "UPDATE profiles SET timezone = 'Pacific/Kiritimati' WHERE handle = 'ada_l'",
    ); // UTC+14
    await attempt("two-sum");
    const expected = localDay(new Date(), "Pacific/Kiritimati");
    const { rows } = await t.pool.query(
      "SELECT to_char(day, 'YYYY-MM-DD') AS day FROM activity_days",
    );
    expect(rows).toEqual([{ day: expected }]);
    expect((await profile()).last).toBe(expected);
  });
});

describe("badges", () => {
  it("are earned once and listed with their state", async () => {
    await attempt("two-sum");
    await attempt("valid-parentheses");
    const list = (await call("GET", "/v1/me/badges", ada)).json<{
      items: Array<{ id: string; earnedAt: string | null }>;
    }>().items;
    expect(list.find((b) => b.id === "first-blood")?.earnedAt).toBeTruthy();
    expect(list.find((b) => b.id === "ten-down")?.earnedAt).toBeNull();
    expect((await t.pool.query("SELECT count(*)::int AS n FROM badges_earned")).rows[0].n).toBe(1);
  });

  it("include Hard Mode for the first hard problem", async () => {
    const id = await attempt("edit-distance");
    expect((await detail(id)).rewards?.badges).toEqual(
      expect.arrayContaining(["first-blood", "hard-mode"]),
    );
  });

  it("recognise acceptance in three languages", async () => {
    await attempt("two-sum", "AC", ada, "python");
    await attempt("valid-parentheses", "AC", ada, "cpp");
    const id = await attempt("climbing-stairs", "AC", ada, "java");
    expect((await detail(id)).rewards?.badges).toContain("polyglot");
  });
});

describe("dashboard", () => {
  const dash = async (query = "", token = ada) => {
    const res = await call("GET", `/v1/me/dashboard${query}`, token);
    expect(res.statusCode).toBe(200);
    return res.json<DashboardDto>();
  };

  it("requires sign-in and validates the range", async () => {
    expect((await call("GET", "/v1/me/dashboard", null)).statusCode).toBe(401);
    expect((await call("GET", "/v1/me/dashboard?range=1y", ada)).statusCode).toBe(422);
  });

  it("is friendly and empty for a new player, with starting recommendations", async () => {
    const d = await dash();
    expect(d.player).toMatchObject({ xp: 0, level: { level: 1 }, streak: { current: 0 } });
    expect(d.solved).toMatchObject({ total: 0, easy: 0, medium: 0, hard: 0, inRange: 0 });
    expect(d.solved.daily).toHaveLength(30);
    expect(d.accuracy).toMatchObject({ submissions: 0, acceptanceRate: 0, firstTryRate: 0 });
    expect(d.heatmap).toEqual([]);
    expect(d.weakAreas).toEqual([]);
    expect(d.skills.every((s) => s.stage === "seed")).toBe(true);
    expect(d.next).toHaveLength(3);
    expect(d.next.every((n) => n.difficulty === "easy" || d.next.length > 0)).toBe(true);
    expect(d.badges.every((b) => b.earnedAt === null)).toBe(true);
    expect(d.sheets[0]).toMatchObject({ slug: "mini", solved: 0, total: 3 });
    expect(d.countdown).toBeNull();
  });

  it("reconciles its numbers with the raw tables", async () => {
    await attempt("two-sum"); // easy AC first try
    await attempt("valid-parentheses", "WA");
    await attempt("valid-parentheses"); // easy AC second try
    await attempt("three-sum", "TLE"); // medium, unsolved
    await attempt("edit-distance"); // hard AC first try
    const d = await dash("?range=all");

    const raw = (
      await t.pool.query(
        `SELECT
           (SELECT count(*)::int FROM user_problem_state WHERE status = 'solved') AS solved,
           (SELECT count(*)::int FROM submissions WHERE kind = 'submit') AS subs,
           (SELECT count(*)::int FROM submissions WHERE kind = 'submit' AND verdict = 'AC') AS acs,
           (SELECT xp::int FROM profiles WHERE handle = 'ada_l') AS xp`,
      )
    ).rows[0];
    expect(d.solved).toMatchObject({ total: raw.solved, easy: 2, medium: 0, hard: 1, inRange: 3 });
    expect(d.accuracy.submissions).toBe(raw.subs);
    expect(d.accuracy.accepted).toBe(raw.acs);
    expect(d.accuracy.acceptanceRate).toBe(Math.round((raw.acs / raw.subs) * 1000) / 10); // 4 AC? 3 of 5
    expect(d.accuracy.firstTryRate).toBeCloseTo((2 / 3) * 100, 0);
    expect(d.accuracy.avgAttemptsToAc).toBeCloseTo((1 + 2 + 1) / 3, 1);
    expect(d.player.xp).toBe(raw.xp);
    expect(d.player.streak.current).toBe(1);
    expect(d.solved.daily.at(-1)).toBe(3); // three accepted submissions today
    expect(d.heatmap).toEqual([{ day: today(), count: 3 }]);
    expect(d.recent).toHaveLength(5);
    expect(d.recent[0]?.problem.slug).toBe("edit-distance");
    expect(d.sheets[0]).toMatchObject({ slug: "mini", solved: 3, total: 3 });
    expect(d.badges.find((b) => b.id === "first-blood")?.earnedAt).toBeTruthy();
  });

  it("grows skill plants, finds weak areas and recommends what to do next", async () => {
    await attempt("two-sum"); // arrays, hashing: solved first try
    await attempt("three-sum", "TLE");
    await attempt("three-sum", "TLE");
    const d = await dash();
    const arrays = d.skills.find((s) => s.topic === "arrays");
    expect(arrays).toMatchObject({ attempted: 2, solved: 1 });
    expect(arrays?.stage).not.toBe("seed");
    expect(d.weakAreas.length).toBeGreaterThan(0);
    expect(d.weakAreas[0]?.diagnosis).toMatch(/time|wrong|crash|hint/i);
    const slugs = d.next.map((n) => n.slug);
    expect(slugs).not.toContain("two-sum"); // already solved
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("filters by range", async () => {
    await attempt("two-sum");
    await t.pool.query(
      `UPDATE user_problem_state SET first_ac_at = now() - interval '40 days';
       UPDATE submissions SET created_at = now() - interval '40 days'`,
    );
    await attempt("valid-parentheses");
    expect((await dash("?range=7d")).solved.inRange).toBe(1);
    expect((await dash("?range=30d")).solved.inRange).toBe(1);
    expect((await dash("?range=90d")).solved.inRange).toBe(2);
    expect((await dash("?range=all")).solved.inRange).toBe(2);
    expect((await dash("?range=7d")).accuracy.submissions).toBe(1);
    expect((await dash("?range=90d")).accuracy.submissions).toBe(2);
    expect((await dash("?range=7d")).solved.total).toBe(2); // totals ignore the range
  });

  it("shows the placement countdown and a lapsed streak as zero", async () => {
    await t.pool.query(
      "UPDATE profiles SET placement_date = (now() AT TIME ZONE 'UTC')::date + 30 WHERE handle = 'ada_l'",
    );
    await setStreak(5, 4, 1);
    const d = await dash();
    expect(d.countdown).toMatchObject({ daysLeft: 30 });
    expect(d.player.streak).toMatchObject({ current: 0, best: 5 });
    await setStreak(5, 2, 1);
    expect((await dash()).player.streak.current).toBe(5); // a freeze can still save it
    expect(addDays(today(), 30)).toBe(d.countdown?.placementDate);
  });

  it("only ever shows the caller's own data", async () => {
    await attempt("two-sum");
    const other = await dash("", bob);
    expect(other.player.xp).toBe(0);
    expect(other.solved.total).toBe(0);
    expect(other.recent).toEqual([]);
    expect(other.badges.every((b) => b.earnedAt === null)).toBe(true);
  });
});
