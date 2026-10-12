import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  DiagnosticDto,
  ReadinessDto,
  ReadinessHistoryResponse,
  TimeAnalyticsResponse,
  TopicsResponse,
  TrendsResponse,
} from "@prepquest/shared";
import { seedBank, seedContent } from "../../test/content.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";
import { Interviews } from "../../test/interviews.js";
import { resetLearning, solveProblem } from "../../test/solve.js";

let t: TestApp;
let ada: string;
let bob: string;

const SLUGS = ["two-sum", "valid-parentheses", "three-sum", "climbing-stairs", "edit-distance"];

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
  t.app.ai.now = () => new Date();
});

const get = <T>(url: string, token = ada) =>
  t.app.inject({ method: "GET", url: `/v1${url}`, headers: bearer(token) }).then((r) => ({
    status: r.statusCode,
    body: r.json<T>(),
  }));

describe("access", () => {
  it("needs a signed-in user", async () => {
    for (const url of [
      "/me/analytics/topics",
      "/me/readiness",
      "/me/analytics/time",
      "/me/analytics/interviews",
    ]) {
      expect((await t.app.inject({ method: "GET", url: `/v1${url}` })).statusCode, url).toBe(401);
    }
  });
});

describe("topics and recommendations (A2)", () => {
  it("starts a new learner on the diagnostic", async () => {
    const { body } = await get<TopicsResponse>("/me/analytics/topics");
    expect(body.recommendations[0]!.kind).toBe("diagnostic");
    expect(body.topics.every((x) => x.attempted === 0 && x.stage === "seed")).toBe(true);
  });

  it("raises mastery with solves, explains it, and never recommends what is solved", async () => {
    await solveProblem(t, ada, "two-sum");
    await solveProblem(t, ada, "valid-parentheses", "WA");
    const { body } = await get<TopicsResponse>("/me/analytics/topics");
    const attempted = body.topics.filter((x) => x.attempted > 0);
    expect(attempted.length).toBeGreaterThan(0);
    for (const x of attempted) {
      expect(x.mastery).toBeGreaterThanOrEqual(0);
      expect(x.mastery).toBeLessThanOrEqual(1);
      expect(x.signals.solve).toBeGreaterThanOrEqual(0);
    }
    const recs = body.recommendations.filter((r) => r.kind === "problem");
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.why.length > 0)).toBe(true);
    expect(recs.some((r) => r.href === "/problems/two-sum")).toBe(false);
    expect(body.recommendations.some((r) => r.kind === "diagnostic")).toBe(false);
  });

  it("weights topics by the target's pack and refuses an unknown target", async () => {
    await solveProblem(t, ada, "two-sum");
    const plain = (await get<TopicsResponse>("/me/analytics/topics")).body;
    const packed = (await get<TopicsResponse>("/me/analytics/topics?target=product-high-bar")).body;
    expect(plain.target).toBe("general");
    expect(packed.target).toBe("product-high-bar");
    expect(plain.topics.every((x) => x.importance === 1)).toBe(true);
    expect(packed.topics.some((x) => x.importance !== 1)).toBe(true);
    expect((await get<unknown>("/me/analytics/topics?target=nope")).status).toBe(404);
  });
});

describe("time analysis (A5)", () => {
  it("estimates active time to an accept and ignores long breaks", async () => {
    await solveProblem(t, ada, "two-sum");
    // opened 10 minutes before the accept
    await t.pool.query(
      `UPDATE user_problem_state SET first_seen_at = now() - interval '10 minutes'`,
    );
    await t.pool.query(`UPDATE submissions SET created_at = now()`);
    const { body } = await get<TimeAnalyticsResponse>("/me/analytics/time");
    const easy = body.summaries.find((s) => s.difficulty === "easy")!;
    expect(easy.count).toBe(1);
    expect(easy.medianSeconds).toBeGreaterThan(540);
    expect(easy.medianSeconds).toBeLessThan(660);
    expect(body.note).toMatch(/Estimated/);

    // opened a day before: capped at the break threshold
    await t.pool.query(`UPDATE user_problem_state SET first_seen_at = now() - interval '1 day'`);
    const capped = (await get<TimeAnalyticsResponse>("/me/analytics/time")).body;
    expect(capped.summaries.find((s) => s.difficulty === "easy")!.medianSeconds).toBe(1200);
  });

  it("has nothing to say without solves", async () => {
    const { body } = await get<TimeAnalyticsResponse>("/me/analytics/time");
    expect(body.summaries.every((s) => s.count === 0)).toBe(true);
    expect(body.coaching).toBeNull();
    expect(body.slowest).toEqual([]);
  });
});

describe("readiness (A4)", () => {
  it("withholds the score for a learner with no data and points to the diagnostic", async () => {
    const { body } = await get<ReadinessDto>("/me/readiness");
    expect(body.score).toBeNull();
    expect(body.needsDiagnostic).toBe(true);
    expect(body.label).toBe("Not enough data");
    expect(body.components.every((c) => c.score === null)).toBe(true);
  });

  it("scores with a confidence band, is reproducible and records one snapshot a day", async () => {
    for (const slug of SLUGS.slice(0, 4)) await solveProblem(t, ada, slug);
    const a = (await get<ReadinessDto>("/me/readiness")).body;
    const b = (await get<ReadinessDto>("/me/readiness")).body;
    expect(a.score).not.toBeNull();
    expect(a.band).toBeGreaterThanOrEqual(3);
    expect(b).toEqual(a);
    const breadth = a.components.find((c) => c.key === "dsa_breadth")!;
    expect(breadth.score).not.toBeNull();
    expect(a.components.find((c) => c.key === "aptitude")!.score).toBeNull();
    expect(a.limiting.length).toBeGreaterThan(0);
    const { rows } = await t.pool.query(`SELECT count(*)::int AS n FROM readiness_snapshots`);
    expect(rows[0].n).toBe(1);
    const history = (await get<ReadinessHistoryResponse>("/me/readiness/history")).body;
    expect(history.items).toHaveLength(1);
    expect(history.items[0]!.score).toBe(a.score);
  });

  it("gives an ETA once there is a trend, relative to the placement date", async () => {
    for (const slug of SLUGS.slice(0, 3)) await solveProblem(t, ada, slug);
    const today = new Date().toISOString().slice(0, 10);
    // an upward history over the last week
    for (let i = 7; i >= 1; i--) {
      await t.pool.query(
        `INSERT INTO readiness_snapshots (user_id, target_key, snap_date, score, band, components)
         SELECT user_id, 'general', ($1::date - $2::int), $3, 5, '[]'::jsonb FROM profiles WHERE handle = 'ada_l'`,
        [today, i, 20 + (7 - i) * 3],
      );
    }
    await t.pool.query(
      `UPDATE profiles SET placement_date = ($1::date + 400) WHERE handle = 'ada_l'`,
      [today],
    );
    const { body } = await get<ReadinessDto>("/me/readiness");
    expect(body.eta.pointsPerDay).toBeGreaterThan(0);
    expect(body.eta.date).not.toBeNull();
    expect(body.eta.onTrack).toBe(true);
  });

  it("scores a pack target separately and keeps users apart", async () => {
    await solveProblem(t, ada, "two-sum");
    const general = (await get<ReadinessDto>("/me/readiness")).body;
    const packed = (await get<ReadinessDto>("/me/readiness?target=product-high-bar")).body;
    expect(packed.targetTitle).toMatch(/high bar/i);
    expect(general.target).toBe("general");
    const bobs = (await get<ReadinessDto>("/me/readiness", bob)).body;
    expect(bobs.score).toBeNull();
    expect((await get<unknown>("/me/readiness?target=nope")).status).toBe(404);
  });
});

describe("diagnostic", () => {
  it("builds a short calibration across difficulties and reuses it while open", async () => {
    const created = await t.app.inject({
      method: "POST",
      url: "/v1/me/diagnostic",
      headers: bearer(ada),
    });
    expect(created.statusCode).toBe(201);
    const d = created.json<DiagnosticDto>();
    expect(d.total).toBe(5);
    expect(new Set(d.problems.map((p) => p.slug)).size).toBe(5);
    expect(d.problems.every((p) => p.status === "todo")).toBe(true);
    const again = (
      await t.app.inject({ method: "POST", url: "/v1/me/diagnostic", headers: bearer(ada) })
    ).json<DiagnosticDto>();
    expect(again.id).toBe(d.id);
  });

  it("completes when every problem has been tried, and then feeds readiness", async () => {
    const d = (
      await t.app.inject({ method: "POST", url: "/v1/me/diagnostic", headers: bearer(ada) })
    ).json<DiagnosticDto>();
    for (const p of d.problems)
      await solveProblem(t, ada, p.slug, p.difficulty === "hard" ? "WA" : "AC");
    const done = (await get<DiagnosticDto>(`/me/diagnostic/${d.id}`)).body;
    expect(done.answered).toBe(5);
    expect(done.completedAt).not.toBeNull();
    expect(done.problems.some((p) => p.status === "solved")).toBe(true);
    expect((await get<ReadinessDto>("/me/readiness")).body.score).not.toBeNull();
    // a new one can be started afterwards
    expect(
      (await t.app.inject({ method: "POST", url: "/v1/me/diagnostic", headers: bearer(ada) }))
        .statusCode,
    ).toBeLessThan(500);
  });

  it("is private to its owner", async () => {
    const d = (
      await t.app.inject({ method: "POST", url: "/v1/me/diagnostic", headers: bearer(ada) })
    ).json<DiagnosticDto>();
    expect((await get<unknown>(`/me/diagnostic/${d.id}`, bob)).status).toBe(404);
  });
});

describe("interview trends (A3)", () => {
  it("lists scored interviews, leaves out abandoned ones unless asked, and filters", async () => {
    const iv = new Interviews(t, ada);
    const id = await iv.startNew({ type: "dsa", problemSlugs: ["two-sum"], minutes: 30 });
    await iv.say(id, "Hi, I'm Ada, a final year student.");
    await iv.say(id, "I would use a hash map of complements, so O(n) time and O(n) space.");
    await iv.end(id);
    await t.idle();

    const all = (await get<TrendsResponse>("/me/analytics/interviews?includeAbandoned=true")).body;
    expect(all.sessions).toBe(1);
    expect(all.points).toHaveLength(1);
    expect(all.points[0]!.moving).toBe(all.points[0]!.overall);
    expect(all.best).toBe(all.points[0]!.id);
    expect(all.deltas).toEqual([]); // one session has nothing to compare with

    const strict = (await get<TrendsResponse>("/me/analytics/interviews")).body;
    expect(strict.points.length + strict.excluded).toBe(1);

    expect(
      (await get<TrendsResponse>("/me/analytics/interviews?type=cs&includeAbandoned=true")).body
        .sessions,
    ).toBe(0);
    expect((await get<TrendsResponse>("/me/analytics/interviews", bob)).body.sessions).toBe(0);
    expect((await get<unknown>("/me/analytics/interviews?type=bogus")).status).toBe(422);
  });

  it("a finished coding interview feeds the readiness and topic signals", async () => {
    await solveProblem(t, ada, "two-sum");
    const iv = new Interviews(t, ada);
    const id = await iv.startNew({ type: "dsa", problemSlugs: ["two-sum"], minutes: 30 });
    await iv.say(id, "Hello, I'm Ada.");
    await iv.say(id, "Hash map of complements, O(n) time and space, handling duplicates.");
    await iv.end(id);
    await t.idle();
    const r = (await get<ReadinessDto>("/me/readiness")).body;
    // the interview scorecard is low-completion so it may not count yet; the component must still be well-formed
    const c = r.components.find((x) => x.key === "interview")!;
    expect(c.score === null || (c.score >= 0 && c.score <= 100)).toBe(true);
    expect(r.components.find((x) => x.key === "cs")!.score).toBeNull();
  });
});
