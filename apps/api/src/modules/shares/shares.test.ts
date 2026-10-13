import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CODING_RUBRIC } from "@prepquest/interview-core";
import type {
  CreatedShareDto,
  PublicReportDto,
  ScorecardReport,
  ShareDto,
} from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import { Interviews, resetClock } from "../../test/interviews.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";
import { resetLearning, solveProblem } from "../../test/solve.js";

let t: TestApp;
let ada: Interviews;
let adaToken: string;
let bobToken: string;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum"]);
  adaToken = (await signupAndLogin(t, { displayName: "Ada Lovelace" })).accessToken;
  bobToken = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
  ada = new Interviews(t, adaToken);
});
afterAll(() => t.close());
afterEach(() => resetClock(t));
beforeEach(async () => {
  await resetLearning(t);
  await t.pool.query("DELETE FROM llm_usage");
  t.mock.overrides.clear();
  t.app.ai.now = () => new Date();
});

const call = <T>(
  method: "GET" | "POST" | "DELETE",
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
    .then((r) => ({
      status: r.statusCode,
      headers: r.headers,
      raw: r.rawPayload,
      body: (r.headers["content-type"] ?? "").toString().includes("json")
        ? r.json<T>()
        : (undefined as T),
    }));

/** A finished interview whose scorecard mentions the company, the learner and an email. */
async function scoredInterview() {
  const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30, company: "Initech" });
  await ada.say(id, "Hi, I'm Ada Lovelace, a final year student who enjoys algorithms.");
  await ada.say(id, "I would use a hash map to store complements, which gives O(n) time.");
  const turns = (await ada.get(id)).turns.filter((x) => x.speaker === "candidate");
  const ev = [
    {
      type: "turn",
      ref: turns.at(-1)!.seq,
      quote: turns.at(-1)!.text.split(" ").slice(0, 6).join(" "),
    },
  ];
  t.mock.overrides.set("scorecard", [
    JSON.stringify({
      scores: CODING_RUBRIC.dimensions
        .filter((d) => !d.fromJudge)
        .map((d) => ({
          dimension: d.key,
          score: 4,
          justification: "Ada was clear.",
          evidence: ev,
        })),
      strengths: [{ text: "Ada picked a good fit for Initech", evidence: ev }],
      red_flags: [],
      next_actions: [{ kind: "topic", ref: "x", title: "Practise", why: "y" }],
      summary: "Ada Lovelace did well at Initech. Contact ada@example.com.",
    }),
  ]);
  await ada.end(id);
  return id;
}

const share = (ref: string, over: object = {}, token = adaToken) =>
  call<CreatedShareDto>("POST", "/shares", token, { entityType: "scorecard", ref, ...over });

describe("sharing a scorecard", () => {
  it("makes a link whose page shows the scores with the default privacy filter", async () => {
    const id = await scoredInterview();
    const made = await share(id);
    expect(made.status).toBe(201);
    expect(made.body.token).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(made.body.path).toBe(`/r/${made.body.token}`);
    expect(made.body).toMatchObject({ visibility: "unlisted", status: "active", views: 0 });

    const page = await call<PublicReportDto>("GET", `/r/${made.body.token}`, null);
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["x-robots-tag"]).toMatch(/noindex/);
    expect(page.body.owner).toBe("Ada Lovelace");
    const r = page.body.payload as ScorecardReport;
    expect(r.kind).toBe("scorecard");
    expect(r.overall).toBeGreaterThan(0);
    expect(r.scores.length).toBeGreaterThan(3);
    // no quotes, no company, no email
    expect(r.company).toBeNull();
    expect(r.scores.every((s) => s.quotes.length === 0)).toBe(true);
    const text = JSON.stringify(page.body);
    expect(text).not.toMatch(/Initech|ada@example|evidence|nextActions/);
    expect(r.summary).toContain("the company");
  });

  it("includes quotes and the company only when the learner chose to, and can hide the name", async () => {
    const id = await scoredInterview();
    const open = await share(id, {
      options: { hideTranscript: false, hideCode: true, hideCompany: false, hideName: false },
      visibility: "public",
    });
    const page = await call<PublicReportDto>("GET", `/r/${open.body.token}`, null);
    const r = page.body.payload as ScorecardReport;
    expect(r.company).toBe("Initech");
    expect(r.scores[0]!.quotes.length).toBeGreaterThan(0);
    expect(page.headers["x-robots-tag"]).toBeUndefined();
    expect(JSON.stringify(page.body)).not.toContain("ada@example.com");

    const anon = await share(id, {
      options: { hideTranscript: true, hideCode: true, hideCompany: true, hideName: true },
    });
    const hidden = await call<PublicReportDto>("GET", `/r/${anon.body.token}`, null);
    expect(hidden.body.owner).toBe("A PrepQuest learner");
    expect(JSON.stringify(hidden.body)).not.toMatch(/Ada|Lovelace|ada_l|Initech/);
  });

  it("counts views on the page, not on the preview image", async () => {
    const id = await scoredInterview();
    const { body } = await share(id);
    await call("GET", `/r/${body.token}`, null);
    await call("GET", `/r/${body.token}`, null);
    const img = await call("GET", `/r/${body.token}/og.png`, null);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["cache-control"]).toBe("no-store");
    expect(img.raw.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const list = await call<{ items: ShareDto[] }>("GET", "/shares", adaToken);
    expect(list.body.items[0]).toMatchObject({ views: 2, status: "active" });
  });

  it("a revoked link is gone at once, page and image alike", async () => {
    const id = await scoredInterview();
    const { body } = await share(id);
    expect((await call("GET", `/r/${body.token}`, null)).status).toBe(200);
    const revoked = await call<ShareDto>("DELETE", `/shares/${body.id}`, adaToken);
    expect(revoked.body.status).toBe("revoked");
    expect((await call("GET", `/r/${body.token}`, null)).status).toBe(404);
    expect((await call("GET", `/r/${body.token}/og.png`, null)).status).toBe(404);
    // revoking twice is harmless
    expect((await call("DELETE", `/shares/${body.id}`, adaToken)).status).toBe(200);
  });

  it("an expired link answers 404 and lists as expired", async () => {
    const id = await scoredInterview();
    const { body } = await share(id, { expiresIn: "7d" });
    expect(body.expiresAt).not.toBeNull();
    await t.pool.query(`UPDATE shared_reports SET expires_at = now() - interval '1 minute'`);
    expect((await call("GET", `/r/${body.token}`, null)).status).toBe(404);
    const list = await call<{ items: ShareDto[] }>("GET", "/shares", adaToken);
    expect(list.body.items[0]!.status).toBe("expired");
    const never = await share(id, { expiresIn: "never" });
    expect(never.body.expiresAt).toBeNull();
  });

  it("unknown, malformed and guessed tokens are all the same 404", async () => {
    for (const token of ["nope", "x".repeat(40), "../../etc/passwd", "a".repeat(90)]) {
      const r = await call<{ error: { code: string } }>(
        "GET",
        `/r/${encodeURIComponent(token)}`,
        null,
      );
      expect(r.status, token).toBe(404);
    }
  });

  it("stores only a hash of the token", async () => {
    const id = await scoredInterview();
    const { body } = await share(id);
    const rows = await t.pool.query(
      `SELECT token_hash, payload::text AS payload FROM shared_reports`,
    );
    expect(rows.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0].token_hash).not.toContain(body.token);
    expect(rows.rows[0].payload).not.toContain(body.token);
  });

  it("only the owner can share or manage a report", async () => {
    const id = await scoredInterview();
    expect((await share(id, {}, bobToken)).status).toBe(404);
    const mine = await share(id);
    expect((await call("DELETE", `/shares/${mine.body.id}`, bobToken)).status).toBe(404);
    expect((await call<{ items: ShareDto[] }>("GET", "/shares", bobToken)).body.items).toHaveLength(
      0,
    );
    expect((await call("POST", "/shares", null, { entityType: "readiness" })).status).toBe(401);
  });

  it("refuses an interview that is still running and checks the request", async () => {
    const running = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    expect((await share(running)).status).toBe(409);
    expect((await call("POST", "/shares", adaToken, { entityType: "scorecard" })).status).toBe(422);
    expect(
      (await call("POST", "/shares", adaToken, { entityType: "poster", ref: "x" })).status,
    ).toBe(422);
    expect((await share("11111111-1111-4111-8111-111111111111")).status).toBe(404);
  });

  it("the snapshot does not change when the interview is later removed", async () => {
    const id = await scoredInterview();
    const { body } = await share(id);
    await t.pool.query(`DELETE FROM interview_sessions`);
    expect((await call("GET", `/r/${body.token}`, null)).status).toBe(200);
  });

  it("deleting the account removes its links", async () => {
    const carol = await signupAndLogin(t, { email: "carol@example.com", handle: "carol_c" });
    expect(carol.accessToken).toBeTruthy();
    await t.pool.query(
      `INSERT INTO shared_reports (id, owner_id, entity_type, token_hash, options, payload)
       SELECT gen_random_uuid(), id, 'readiness', 'hash-for-carol', '{}'::jsonb, '{}'::jsonb
       FROM users WHERE email = 'carol@example.com'`,
    );
    await t.pool.query(`DELETE FROM users WHERE email = 'carol@example.com'`);
    const left = await t.pool.query(`SELECT count(*)::int AS n FROM shared_reports`);
    expect(left.rows[0].n).toBe(0);
  });
});

describe("sharing a contest result and readiness", () => {
  async function endedContest(joined: boolean) {
    const u = await t.pool.query(`SELECT id FROM users WHERE email = 'ada@example.com'`);
    const c = await t.pool.query(
      `INSERT INTO contests (id, slug, title, kind, scoring, starts_at, ends_at, visibility, created_by)
       VALUES (gen_random_uuid(), 'friday-round', 'Friday round', 'weekly', 'icpc',
         now() - interval '3 hours', now() - interval '1 hour', 'public', $1) RETURNING id`,
      [u.rows[0].id],
    );
    await t.pool.query(
      `INSERT INTO contest_problems (contest_id, problem_id, label, points, ordinal)
       SELECT $1, id, 'A', 100, 0 FROM problems WHERE slug = 'two-sum'`,
      [c.rows[0].id],
    );
    if (joined)
      await t.pool.query(
        `INSERT INTO contest_participants (id, contest_id, user_id, kind, started_at, ends_at)
         VALUES (gen_random_uuid(), $1, $2, 'live', now() - interval '3 hours', now() - interval '1 hour')`,
        [c.rows[0].id, u.rows[0].id],
      );
  }

  it("shares a finished contest result without handles", async () => {
    await endedContest(true);
    const made = await call<CreatedShareDto>("POST", "/shares", adaToken, {
      entityType: "contest",
      ref: "friday-round",
    });
    expect(made.status).toBe(201);
    const page = await call<PublicReportDto>("GET", `/r/${made.body.token}`, null);
    expect(page.body.payload).toMatchObject({
      kind: "contest",
      title: "Friday round",
      rank: 1,
      of: 1,
    });
    const img = await call("GET", `/r/${made.body.token}/og.png`, null);
    expect(img.status).toBe(200);
  });

  it("refuses a contest that is not over or that the learner did not join", async () => {
    await endedContest(false);
    const notJoined = await call("POST", "/shares", adaToken, {
      entityType: "contest",
      ref: "friday-round",
    });
    expect(notJoined.status).toBe(409);
    await t.pool.query(`UPDATE contests SET ends_at = now() + interval '1 hour'`);
    const running = await call("POST", "/shares", adaToken, {
      entityType: "contest",
      ref: "friday-round",
    });
    expect(running.status).toBe(409);
    expect(
      (await call("POST", "/shares", adaToken, { entityType: "contest", ref: "missing-contest" }))
        .status,
    ).toBe(404);
  });

  it("shares a readiness summary once there is evidence, without the plan details", async () => {
    await solveProblem(t, adaToken, "two-sum");
    const made = await call<CreatedShareDto>("POST", "/shares", adaToken, {
      entityType: "readiness",
    });
    expect(made.status).toBe(201);
    const page = await call<PublicReportDto>("GET", `/r/${made.body.token}`, null);
    expect(page.body.payload).toMatchObject({ kind: "readiness", target: "Target hidden" });
    expect(JSON.stringify(page.body)).not.toMatch(/levers|eta|placementDate/);
    expect((await call("GET", `/r/${made.body.token}/og.png`, null)).status).toBe(200);
  });

  it("refuses a readiness report when there is not enough data", async () => {
    const r = await call<{ error: { code: string } }>("POST", "/shares", adaToken, {
      entityType: "readiness",
    });
    expect(r.status).toBe(409);
  });
});
