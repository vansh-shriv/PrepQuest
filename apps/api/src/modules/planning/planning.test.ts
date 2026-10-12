import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  GoalsTodayResponse,
  GoalTemplateResponse,
  PlanDto,
  PlanTaskDto,
  QuestBoardResponse,
} from "@prepquest/shared";
import { seedBank, seedContent } from "../../test/content.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";
import { resetLearning, solveProblem } from "../../test/solve.js";
import { nightlyPlanning } from "./plan-service.js";

let t: TestApp;
let ada: string;
let bob: string;

const SLUGS = [
  "two-sum",
  "valid-parentheses",
  "three-sum",
  "climbing-stairs",
  "edit-distance",
  "merge-intervals",
];
const NOW = new Date("2026-03-02T09:00:00Z"); // a Monday
const at = (iso: string) => () => new Date(iso);
const addDaysIso = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, SLUGS);
  await seedBank(t);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetLearning(t);
  t.app.ai.now = () => NOW;
});

const call = <T>(
  method: "GET" | "POST" | "PATCH" | "PUT",
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

const generate = async (
  body: object = { placementDate: "2026-04-10", defaultHours: 2 },
  token = ada,
) => {
  const r = await call<{ plan: PlanDto }>("POST", "/me/plan", token, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.plan;
};

const capacity = (plan: PlanDto, day: string) => {
  const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${day}T00:00:00Z`).getUTCDay()
  ]!;
  if (plan.inputs.restDays.includes(weekday)) return 0;
  return Math.floor(
    (plan.inputs.hoursPerDay[weekday] ?? plan.inputs.defaultHours) * 60 * plan.inputs.efficiency,
  );
};

describe("study plan (P1)", () => {
  it("needs a signed-in user and starts empty", async () => {
    expect((await call("GET", "/me/plan", null)).status).toBe(401);
    expect((await call<{ plan: null }>("GET", "/me/plan", ada)).body.plan).toBeNull();
    expect((await call("POST", "/me/plan/replan", ada)).status).toBe(404);
  });

  it("generates a plan that fits the user's time, ends before the placement date and explains each task", async () => {
    const plan = await generate();
    expect(plan.version).toBe(1);
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.tasks.every((x) => x.date >= "2026-03-02" && x.date < "2026-04-10")).toBe(true);
    for (const [day, minutes] of Object.entries(plan.minutesPerDay)) {
      expect(minutes, day).toBeLessThanOrEqual(capacity(plan, day));
    }
    expect(plan.tasks.every((x) => x.why.length > 0)).toBe(true);
    expect(plan.phases.length).toBeGreaterThanOrEqual(3);
    expect(plan.narrativeMd).toMatch(/2026-04-10/);
    const problems = plan.tasks.filter((x) => x.kind === "problem");
    expect(new Set(problems.map((x) => x.ref)).size).toBe(problems.length);
    expect(problems[0]!.href).toBe(`/problems/${problems[0]!.ref}`);
  });

  it("uses the hours and placement date from the profile when none are sent", async () => {
    await t.pool.query(
      `UPDATE profiles SET placement_date = '2026-03-20', hours_per_day = '{"mon": 2, "wed": 1}'::jsonb WHERE handle = 'ada_l'`,
    );
    const plan = await generate({});
    expect(plan.placementDate).toBe("2026-03-20");
    expect(
      plan.tasks.every((x) =>
        [
          "2026-03-02",
          "2026-03-04",
          "2026-03-09",
          "2026-03-11",
          "2026-03-16",
          "2026-03-18",
        ].includes(x.date),
      ),
    ).toBe(true);
  });

  it("starts with the weakest topic once there is history", async () => {
    await solveProblem(t, ada, "two-sum", "WA");
    const plan = await generate();
    const first = plan.tasks.find((x) => x.kind === "problem")!;
    expect(first.why).toMatch(/Weak spot|New topic/);
  });

  it("never schedules problems that are already solved", async () => {
    await solveProblem(t, ada, "two-sum");
    const plan = await generate();
    expect(plan.tasks.some((x) => x.ref === "two-sum" && x.kind === "problem")).toBe(false);
  });

  it("accepts hours for only some weekdays", async () => {
    const plan = await generate({
      placementDate: "2026-03-20",
      hoursPerDay: { mon: 2, wed: 1 },
      defaultHours: 0,
    });
    expect(plan.inputs.hoursPerDay).toEqual({ mon: 2, wed: 1 });
    expect(
      plan.tasks.every((x) =>
        ["mon", "wed"].includes(
          ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
            new Date(`${x.date}T00:00:00Z`).getUTCDay()
          ]!,
        ),
      ),
    ).toBe(true);
    expect((await call("POST", "/me/plan", ada, { hoursPerDay: {} })).status).toBe(201);
    expect((await call("POST", "/me/plan", ada, { hoursPerDay: { monday: 2 } })).status).toBe(422);
  });

  it("validates the inputs", async () => {
    expect((await call("POST", "/me/plan", ada, { placementDate: "10/04/2026" })).status).toBe(422);
    expect((await call("POST", "/me/plan", ada, { defaultHours: 40 })).status).toBe(422);
    expect((await call("POST", "/me/plan", ada, { packSlug: "no-such-pack" })).status).toBe(422);
  });

  it("applies a company pack's topic emphasis", async () => {
    const plan = await generate({
      placementDate: "2026-04-10",
      defaultHours: 2,
      packSlug: "product-high-bar",
    });
    expect(plan.target).toBe("product-high-bar");
  });

  it("re-planning bumps the version and records what changed", async () => {
    const first = await generate();
    const again = await call<{ plan: PlanDto }>("POST", "/me/plan/replan", ada);
    expect(again.status).toBe(200);
    expect(again.body.plan.version).toBe(2);
    expect(again.body.plan.lastDiff).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      reason: "manual",
    });
    expect(again.body.plan.lastDiff!.summary).toBe("No changes");
    expect(again.body.plan.tasks.map((x) => x.id).sort()).toEqual(
      first.tasks.map((x) => x.id).sort(),
    );
    const diff = await call<{ diff: { toVersion: number } }>(
      "GET",
      "/me/plan/diff?from=1&to=2",
      ada,
    );
    expect(diff.body.diff.toVersion).toBe(2);
    expect((await call("GET", "/me/plan/diff?from=7&to=8", ada)).status).toBe(404);
  });

  it("changing the inputs re-plans and summarises the difference", async () => {
    await generate({ placementDate: "2026-04-10", defaultHours: 2 });
    const changed = await generate({ placementDate: "2026-04-10", defaultHours: 1 });
    expect(changed.version).toBe(2);
    expect(changed.lastDiff!.reason).toBe("generate");
    expect(changed.lastDiff!.summary).not.toBe("No changes");
    for (const [day, minutes] of Object.entries(changed.minutesPerDay)) {
      expect(minutes).toBeLessThanOrEqual(capacity(changed, day));
    }
  });
});

describe("editing tasks", () => {
  it("completes, skips and locks tasks, and keeps them through a re-plan", async () => {
    const plan = await generate();
    const [a, b] = plan.tasks.filter((x) => x.kind === "problem");
    // a locked task keeps its day, so lock one that is still ahead after the clock moves
    const c = plan.tasks.find((x) => x.kind === "problem" && x.date >= "2026-03-04")!;
    const done = await call<{ task: PlanTaskDto }>("PATCH", `/me/plan/tasks/${a!.id}`, ada, {
      status: "done",
    });
    expect(done.body.task.status).toBe("done");
    await call("PATCH", `/me/plan/tasks/${b!.id}`, ada, { status: "skipped" });
    await call("PATCH", `/me/plan/tasks/${c!.id}`, ada, { locked: true });
    t.app.ai.now = at("2026-03-03T09:00:00Z");
    const next = (await call<{ plan: PlanDto }>("POST", "/me/plan/replan", ada)).body.plan;
    const find = (id: string) => next.tasks.find((x) => x.id === id);
    expect(find(a!.id)).toMatchObject({ status: "done", date: a!.date });
    expect(find(c!.id)).toMatchObject({ locked: true, date: c!.date, status: "todo" });
    // a skipped problem is not brought back under another id
    expect(next.tasks.filter((x) => x.ref === b!.ref && x.status === "todo")).toHaveLength(0);
  });

  it("moves a task only to a day with room, never into the past", async () => {
    const plan = await generate({ placementDate: "2026-04-10", defaultHours: 1 });
    const task = plan.tasks.find((x) => x.kind === "problem")!;
    expect(
      (await call("PATCH", `/me/plan/tasks/${task.id}`, ada, { date: "2026-03-01" })).status,
    ).toBe(422);
    const full = Object.entries(plan.minutesPerDay).find(
      ([d, m]) => d > task.date && m + task.estMinutes > capacity(plan, d),
    );
    if (full) {
      const res = await call<{ error: { message: string } }>(
        "PATCH",
        `/me/plan/tasks/${task.id}`,
        ada,
        { date: full[0] },
      );
      expect(res.status).toBe(422);
      expect(res.body.error.message).toMatch(/free minutes/);
    }
    const empty = ["2026-03-28", "2026-03-29"].find(
      (d) => capacity(plan, d) >= task.estMinutes && !plan.minutesPerDay[d],
    );
    if (empty) {
      const moved = await call<{ task: PlanTaskDto }>("PATCH", `/me/plan/tasks/${task.id}`, ada, {
        date: empty,
      });
      expect(moved.body.task.date).toBe(empty);
    }
  });

  it("adds custom tasks that survive re-planning", async () => {
    await generate();
    const added = await call<{ task: PlanTaskDto }>("POST", "/me/plan/tasks", ada, {
      title: "Revise OS notes",
      date: "2026-03-05",
      estMinutes: 30,
    });
    expect(added.status).toBe(201);
    expect(added.body.task).toMatchObject({ custom: true, locked: true });
    await call("POST", "/me/plan/replan", ada);
    const plan = (await call<{ plan: PlanDto }>("GET", "/me/plan", ada)).body.plan;
    expect(plan.tasks.find((x) => x.title === "Revise OS notes")).toMatchObject({
      date: "2026-03-05",
    });
    expect(
      (await call("POST", "/me/plan/tasks", ada, { title: "x", date: "2026-02-01" })).status,
    ).toBe(422);
  });

  it("keeps plans private", async () => {
    const plan = await generate();
    const id = plan.tasks[0]!.id;
    expect((await call("PATCH", `/me/plan/tasks/${id}`, bob, { status: "done" })).status).toBe(404);
    expect((await call<{ plan: null }>("GET", "/me/plan", bob)).body.plan).toBeNull();
  });
});

describe("following the plan", () => {
  it("marks a planned problem done when it is solved", async () => {
    const plan = await generate();
    const task = plan.tasks.find((x) => x.kind === "problem")!;
    await solveProblem(t, ada, task.ref!);
    const after = (await call<{ plan: PlanDto }>("GET", "/me/plan", ada)).body.plan;
    expect(after.tasks.find((x) => x.id === task.id)).toMatchObject({ status: "done" });
  });

  it("rolls missed problems forward with priority and says so", async () => {
    const plan = await generate();
    const missed = plan.tasks.filter((x) => x.kind === "problem" && x.date < "2026-03-05");
    expect(missed.length).toBeGreaterThan(0);
    t.app.ai.now = at("2026-03-05T09:00:00Z");
    const next = (await call<{ plan: PlanDto }>("POST", "/me/plan/replan", ada)).body.plan;
    expect(next.tasks.filter((x) => x.status === "todo").every((x) => x.date >= "2026-03-05")).toBe(
      true,
    );
    expect(next.warnings.join(" ")).toMatch(/rolled forward/);
    const todaysRefs = next.tasks.filter((x) => x.date === "2026-03-05").map((x) => x.ref);
    expect(missed.some((m) => todaysRefs.includes(m.ref))).toBe(true);
    expect(next.lastDiff!.moved.length).toBeGreaterThan(0);
  });

  it("the nightly job re-plans once per local day and never twice", async () => {
    await generate();
    t.app.ai.now = at("2026-03-03T09:00:00Z");
    expect(await nightlyPlanning(t.app.ai)).toBe(1);
    expect(await nightlyPlanning(t.app.ai)).toBe(0);
    const plan = (await call<{ plan: PlanDto }>("GET", "/me/plan", ada)).body.plan;
    expect(plan.version).toBe(2);
    expect(plan.lastDiff!.reason).toBe("nightly");
    const { rows } = await t.pool.query(
      `SELECT count(*)::int AS n FROM readiness_snapshots WHERE snap_date = '2026-03-03'`,
    );
    expect(rows[0].n).toBe(1);
    t.app.ai.now = at("2026-03-04T09:00:00Z");
    expect(await nightlyPlanning(t.app.ai)).toBe(1);
  });

  it("respects the user's time zone for 'a new day'", async () => {
    await t.pool.query(`UPDATE profiles SET timezone = 'Asia/Kolkata' WHERE handle = 'ada_l'`);
    t.app.ai.now = at("2026-03-02T20:00:00Z"); // 01:30 on the 3rd in India
    const plan = await generate();
    expect(plan.today).toBe("2026-03-03");
    expect(plan.tasks.every((x) => x.date >= "2026-03-03")).toBe(true);
  });

  it("learns from how much was actually done", async () => {
    await generate();
    for (const date of ["2026-03-04", "2026-03-05", "2026-03-06"]) {
      await call("POST", "/me/plan/tasks", ada, { title: `Study ${date}`, date, estMinutes: 60 });
    }
    // nothing done all week: the planner trims what it asks for
    t.app.ai.now = at("2026-03-10T09:00:00Z");
    await nightlyPlanning(t.app.ai);
    const plan = (await call<{ plan: PlanDto }>("GET", "/me/plan", ada)).body.plan;
    expect(plan.inputs.efficiency).toBeLessThan(0.8);
    expect(plan.inputs.efficiency).toBeGreaterThanOrEqual(0.5);
  });
});

describe("daily goals (P2)", () => {
  // first_ac_at comes from the database clock, so these tests run on real time
  const utcToday = () => new Date().toISOString().slice(0, 10);
  beforeEach(() => {
    t.app.ai.now = () => new Date();
  });

  it("starts from the standard preset and tracks progress", async () => {
    const tpl = (await call<GoalTemplateResponse>("GET", "/me/goals/template", ada)).body;
    expect(tpl.preset).toBe("standard");
    expect(tpl.presets.map((p) => p.key)).toEqual(["light", "standard", "intense", "weekend"]);
    const today = (await call<GoalsTodayResponse>("GET", "/me/goals/today", ada)).body;
    expect(today.date).toBe(utcToday());
    expect(today.items[0]).toMatchObject({ type: "problems", target: 2, progress: 0, done: false });
    expect(today.completed).toBe(false);
    await solveProblem(t, ada, "two-sum");
    const after = (await call<GoalsTodayResponse>("GET", "/me/goals/today", ada)).body;
    expect(after.items[0]).toMatchObject({ progress: 1, done: false });
  });

  it("pays the completion bonus once", async () => {
    await call("PUT", "/me/goals/template", ada, { items: [{ type: "problems", target: 2 }] });
    await solveProblem(t, ada, "two-sum");
    await solveProblem(t, ada, "valid-parentheses");
    const xpBefore = (await t.pool.query(`SELECT xp::int FROM profiles WHERE handle = 'ada_l'`))
      .rows[0].xp as number;
    const done = (await call<GoalsTodayResponse>("GET", "/me/goals/today", ada)).body;
    expect(done.completed).toBe(true);
    expect(done.rewardXp).toBe(15);
    await call("GET", "/me/goals/today", ada);
    await Promise.all([call("GET", "/me/goals/today", ada), call("GET", "/me/goals/today", ada)]);
    const { rows } = await t.pool.query(
      `SELECT count(*)::int AS n, sum(delta)::int AS xp FROM xp_events WHERE reason = 'daily_goal'`,
    );
    expect(rows[0]).toEqual({ n: 1, xp: 15 });
    expect(
      (await t.pool.query(`SELECT xp::int FROM profiles WHERE handle = 'ada_l'`)).rows[0].xp,
    ).toBe(xpBefore + 15);
  });

  it("changes the template and today's goals until they are completed", async () => {
    const put = await call<GoalTemplateResponse>("PUT", "/me/goals/template", ada, {
      preset: "intense",
    });
    expect(put.body.preset).toBe("intense");
    expect(put.body.items.find((i) => i.type === "problems")!.target).toBe(4);
    const custom = await call<GoalTemplateResponse>("PUT", "/me/goals/template", ada, {
      items: [
        { type: "problems", target: 1 },
        { type: "problems", target: 3 },
      ],
    });
    expect(custom.body.preset).toBe("custom");
    expect(custom.body.items).toEqual([{ type: "problems", target: 1 }]);
    expect((await call("PUT", "/me/goals/template", ada, {})).status).toBe(422);

    const patched = await call<GoalsTodayResponse>("PATCH", "/me/goals/today", ada, {
      items: [{ type: "problems", target: 1 }],
    });
    expect(patched.body.items).toHaveLength(1);
    await solveProblem(t, ada, "two-sum");
    expect((await call<GoalsTodayResponse>("GET", "/me/goals/today", ada)).body.completed).toBe(
      true,
    );
    expect(
      (await call("PATCH", "/me/goals/today", ada, { items: [{ type: "problems", target: 9 }] }))
        .status,
    ).toBe(409);
  });

  it("counts a new local day separately and suggests a lighter goal after a bad fortnight", async () => {
    await call("GET", "/me/goals/today", ada);
    for (let i = 1; i <= 10; i++) {
      await t.pool.query(
        `INSERT INTO daily_goals (id, user_id, goal_date, items, completed)
         SELECT gen_random_uuid(), user_id, ($2::date - $1::int), '[]'::jsonb, false FROM profiles WHERE handle = 'ada_l'`,
        [i, utcToday()],
      );
    }
    const now = (await call<GoalsTodayResponse>("GET", "/me/goals/today", ada)).body;
    expect(now.suggestion?.direction).toBe("lower");
    t.app.ai.now = () => new Date(Date.now() + 24 * 3600_000);
    const tomorrow = (await call<GoalsTodayResponse>("GET", "/me/goals/today", ada)).body;
    expect(tomorrow.date).not.toBe(now.date);
  });

  it("follows today's plan when the goal asks for it", async () => {
    await generate({ placementDate: addDaysIso(utcToday(), 40), defaultHours: 2 });
    await call("PUT", "/me/goals/template", ada, { items: [{ type: "plan_tasks", target: 1 }] });
    const g = (await call<GoalsTodayResponse>("GET", "/me/goals/today", ada)).body;
    const plan = (await call<{ plan: PlanDto }>("GET", "/me/plan", ada)).body.plan;
    const todays = plan.tasks.filter((x) => x.date === utcToday() && x.status !== "skipped");
    expect(g.items[0]).toMatchObject({ type: "plan_tasks", target: todays.length, progress: 0 });
  });
});

describe("quest board", () => {
  it("sends a new learner to the diagnostic", async () => {
    const q = (await call<QuestBoardResponse>("GET", "/me/quest-board", ada)).body;
    expect(q.hasPlan).toBe(false);
    expect(q.readiness.needsDiagnostic).toBe(true);
    expect(q.next?.kind).toBe("diagnostic");
    expect(q.goals.items.length).toBeGreaterThan(0);
  });

  it("shows today's tasks and the next one to start", async () => {
    await generate({ placementDate: "2026-04-10", defaultHours: 2 });
    const q = (await call<QuestBoardResponse>("GET", "/me/quest-board", ada)).body;
    expect(q.hasPlan).toBe(true);
    expect(q.tasks.length).toBeGreaterThan(0);
    expect(q.next?.href).toBe(q.tasks.find((x) => x.status === "todo")?.href);
  });
});
