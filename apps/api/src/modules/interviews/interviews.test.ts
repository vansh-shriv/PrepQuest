import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedContent } from "../../test/content.js";
import { Interviews, readyResume, resetClock, setClock } from "../../test/interviews.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";

let t: TestApp;
let ada: Interviews;
let bob: Interviews;
let adaToken: string;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses", "three-sum", "climbing-stairs"]);
  adaToken = (await signupAndLogin(t)).accessToken;
  const bobToken = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" }))
    .accessToken;
  await verifyAllEmails(t);
  ada = new Interviews(t, adaToken);
  bob = new Interviews(t, bobToken);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.pool.query("DELETE FROM interview_sessions");
  await t.pool.query("DELETE FROM question_memory");
  await t.pool.query("DELETE FROM submissions");
  await t.pool.query("DELETE FROM llm_usage");
  t.mock.overrides.clear();
  t.mock.calls.length = 0;
});
afterEach(() => resetClock(t));

describe("plan and create", () => {
  it("lists the templates", async () => {
    const res = await ada.call("GET", "/interview/templates");
    const items = res.json<{ items: { type: string; defaultMinutes: number }[] }>().items;
    expect(items.map((i) => i.type).sort()).toEqual([
      "behavioral",
      "cs",
      "dsa",
      "hld",
      "lld",
      "project",
      "resume",
    ]);
  });

  it("previews a DSA plan without creating anything", async () => {
    const res = await ada.call("POST", "/interviews/plan", { type: "dsa", difficulty: 3 });
    expect(res.statusCode, res.body).toBe(200);
    const plan = res.json<{
      minutes: number;
      questions: { slug: string }[];
      segments: unknown[];
    }>();
    expect(plan.minutes).toBe(45);
    expect(plan.questions).toHaveLength(2);
    expect(new Set(plan.questions.map((q) => q.slug)).size).toBe(2);
    const { rows } = await t.pool.query("SELECT count(*)::int AS n FROM interview_sessions");
    expect(rows[0].n).toBe(0);
  });

  it("lets the user pick the problems", async () => {
    const res = await ada.call("POST", "/interviews/plan", {
      type: "dsa",
      problemSlugs: ["valid-parentheses"],
    });
    expect(res.json<{ questions: { slug: string }[] }>().questions.map((q) => q.slug)).toEqual([
      "valid-parentheses",
    ]);
    const bad = await ada.call("POST", "/interviews/plan", { type: "dsa", problemSlugs: ["nope"] });
    expect(bad.statusCode).toBe(422);
  });

  it("scales the plan to a shorter interview", async () => {
    const res = await ada.call("POST", "/interviews/plan", { type: "dsa", minutes: 30 });
    const plan = res.json<{ questions: unknown[]; segments: { endMs: number }[] }>();
    expect(plan.questions).toHaveLength(1);
    expect(plan.segments.at(-1)?.endMs).toBe(30 * 60_000);
    expect(
      (await ada.call("POST", "/interviews/plan", { type: "dsa", minutes: 5 })).statusCode,
    ).toBe(422);
  });

  it("a project interview needs a confirmed resume", async () => {
    const res = await ada.call("POST", "/interviews/plan", { type: "project" });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("RESUME_REQUIRED");
  });

  it("previews a project plan from the resume without calling the model", async () => {
    await readyResume(t, adaToken);
    t.mock.calls.length = 0;
    const res = await ada.call("POST", "/interviews/plan", { type: "project" });
    expect(res.statusCode, res.body).toBe(200);
    expect(
      res.json<{ questions: { kind: string; sourceRef: string }[] }>().questions[0],
    ).toMatchObject({
      kind: "project",
      sourceRef: "projects[0]",
    });
    expect(t.mock.calls).toHaveLength(0);
    await t.pool.query("DELETE FROM resumes");
  });

  it("creates a session without leaking the questions", async () => {
    const { res, body } = await ada.create({ persona: "strict", difficulty: 4 });
    expect(res.statusCode).toBe(201);
    expect(body.session.state).toBe("SETUP");
    expect(body.wsTicket.length).toBeGreaterThan(20);
    expect(body.session.questions.every((q) => q.hidden)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/two-sum|valid-parentheses|three-sum|climbing/);
  });

  it("is idempotent for the same key and replaces an unstarted plan", async () => {
    const a = await ada.create({}, { "idempotency-key": "k1" });
    const b = await ada.create({}, { "idempotency-key": "k1" });
    expect(b.body.session.id).toBe(a.body.session.id);
    const c = await ada.create({});
    expect(c.body.session.id).not.toBe(a.body.session.id);
    const { rows } = await t.pool.query("SELECT state FROM interview_sessions WHERE id = $1", [
      a.body.session.id,
    ]);
    expect(rows[0].state).toBe("ABANDONED");
  });

  it("validates the input", async () => {
    for (const bad of [
      { difficulty: 9 },
      { hintBudget: 7 },
      { persona: "pirate" },
      { type: "bogus" },
    ]) {
      expect((await ada.create(bad)).res.statusCode, JSON.stringify(bad)).toBe(422);
    }
  });

  it("needs a verified email", async () => {
    await t.pool.query("UPDATE users SET email_verified_at = NULL WHERE email = 'bob@example.com'");
    expect((await bob.create()).res.statusCode).toBe(403);
    await verifyAllEmails(t);
  });

  it("keeps sessions private", async () => {
    const id = await ada.startNew();
    expect((await bob.call("GET", `/interviews/${id}`)).statusCode).toBe(404);
    expect(
      (await bob.call("POST", `/interviews/${id}/messages`, { clientMsgId: "x", text: "hi" }))
        .statusCode,
    ).toBe(404);
    expect((await bob.call("POST", `/interviews/${id}/end`)).statusCode).toBe(404);
    expect((await bob.call("GET", `/interviews/${id}/review`)).statusCode).toBe(404);
    const list = await bob.call("GET", "/interviews");
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(0);
  });
});

describe("a DSA interview from start to finish", () => {
  it("runs the whole state machine with the scripted interviewer", async () => {
    const { body: created } = await ada.create({ hintBudget: 2 });
    const id = created.session.id;
    const bus = ada.listen(id);
    await ada.call("POST", `/interviews/${id}/start`);
    await t.idle();

    let s = (await ada.get(id)).session;
    expect(s.state).toBe("WARMUP");
    const greeting = (await ada.get(id)).turns[0]!;
    expect(greeting).toMatchObject({ speaker: "interviewer" });
    expect(greeting.text).toMatch(/introduce|tell me/i);

    // warm-up -> the first problem is presented automatically
    const r1 = await ada.say(id, "Hi, I'm Ada, a final-year student.");
    expect(r1.res.statusCode, r1.res.body).toBe(200);
    expect(r1.body.replies).toHaveLength(2);
    expect(r1.body.replies[1]?.text).toMatch(/Here's the problem/);
    expect(r1.body.state).toBe("CLARIFY");

    // the question is revealed once it was asked
    s = (await ada.get(id)).session;
    expect(s.questions[0]).toMatchObject({ hidden: false, kind: "problem" });
    expect(s.questions).toHaveLength(2);
    expect(s.questions[1]?.hidden).toBe(true);

    expect((await ada.say(id, "Can the array be empty?")).body.state).toBe("CLARIFY");
    expect((await ada.say(id, "I would use a hash map for complements.")).body.state).toBe(
      "APPROACH",
    );
    expect(
      (await ada.say(id, "Scan once, store each value, check the complement.")).body.state,
    ).toBe("CODING");

    // the interviewer reacts to what the judge says about the code
    const slug = s.questions[0]!.slug!;
    const subId = await insertSubmission(slug, "AC", "submit");
    const ev = await ada.call("POST", `/interviews/${id}/events`, {
      kind: "submit",
      submissionId: subId,
    });
    expect(ev.statusCode, ev.body).toBe(200);
    s = (await ada.get(id)).session;
    expect(s.state).toBe("OPTIMIZE");
    const turns = (await ada.get(id)).turns;
    expect(turns.at(-1)?.text).toMatch(/complexity/i);

    // a second problem when the time allows
    const r2 = await ada.say(id, "O(n) time and O(n) space, because of the map.");
    expect(r2.body.state).toBe("CLARIFY");
    expect(r2.body.replies.at(-1)?.text).toMatch(/Here's the problem/);
    s = (await ada.get(id)).session;
    expect(s.questionIndex).toBe(1);

    const end = await ada.end(id);
    expect(end.statusCode).toBe(200);
    s = (await ada.get(id)).session;
    expect(s).toMatchObject({ state: "COMPLETED", endReason: "user" });
    expect(bus.of("session.ended")[0]?.reason).toBe("user");
    expect(bus.of("interviewer.message").length).toBeGreaterThanOrEqual(8);
    // every streamed reply carried its tokens first, and the control block never leaked
    const streamed = bus
      .of("interviewer.token")
      .map((e) => e.delta)
      .join("");
    expect(streamed).not.toMatch(/<control>|"intent"/);
    // the transcript is stored in order with server time offsets
    const all = (await ada.get(id)).turns;
    expect(all.map((x) => x.seq)).toEqual([...all.map((x) => x.seq)].sort((a, b) => a - b));
    bus.stop();
  });

  it("de-duplicates a retried message", async () => {
    const id = await ada.startNew();
    const a = await ada.say(id, "Hello, I'm Ada.", "same-id");
    const b = await ada.say(id, "Hello, I'm Ada.", "same-id");
    expect(b.body.replay).toBe(true);
    expect(b.body.candidateSeq).toBe(a.body.candidateSeq);
    const turns = (await ada.get(id)).turns.filter((x) => x.speaker === "candidate");
    expect(turns).toHaveLength(1);
  });

  it("refuses messages after the interview ended", async () => {
    const id = await ada.startNew();
    await ada.say(id, "Hi there");
    await ada.end(id);
    const late = await ada.say(id, "One more thing");
    expect(late.res.statusCode).toBe(409);
    expect(late.res.json<{ error: { code: string } }>().error.code).toBe("INTERVIEW_NOT_ACTIVE");
  });

  it("only one interview can be in progress", async () => {
    await ada.startNew();
    const second = await ada.create();
    expect(second.res.statusCode).toBe(409);
    expect(second.res.json<{ error: { code: string } }>().error.code).toBe("INTERVIEW_IN_PROGRESS");
  });

  it("an interview with no answers is abandoned and gets no scorecard", async () => {
    const id = await ada.startNew();
    await ada.end(id);
    const s = (await ada.get(id)).session;
    expect(s).toMatchObject({ state: "ABANDONED", endReason: "abandoned" });
    const review = await ada.call("GET", `/interviews/${id}/review`);
    expect(review.json<{ status: string; scorecard: unknown }>()).toMatchObject({
      status: "none",
      scorecard: null,
    });
  });

  it("remembers the questions it asked and avoids them next time", async () => {
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    await ada.say(id, "Hello");
    await ada.end(id);
    const { rows } = await t.pool.query("SELECT kind, ref_key, weak FROM question_memory");
    expect(rows).toEqual([{ kind: "problem", ref_key: "two-sum", weak: true }]);
    for (let i = 0; i < 5; i++) {
      const plan = await ada.call("POST", "/interviews/plan", {
        type: "dsa",
        difficulty: 1,
        minutes: 30,
      });
      expect(plan.json<{ questions: { slug: string }[] }>().questions[0]?.slug).not.toBe("two-sum");
    }
  });
});

describe("timer", () => {
  const base = new Date("2030-01-01T10:00:00Z");
  const at = (min: number) => new Date(base.getTime() + min * 60_000);

  it("is server authoritative, warns, forces the wrap-up and ends on time", async () => {
    setClock(t, base);
    const id = await ada.startNew({ minutes: 30 });
    const bus = ada.listen(id);
    await ada.say(id, "Hi, I'm Ada.");

    // 21 minutes in: a ten-minute warning is due (9 min left)
    setClock(t, at(21));
    await t.app.interviews.sweep();
    expect(bus.of("timer.tick").some((e) => e.warning === "10m")).toBe(true);
    expect(bus.of("system.notice").some((e) => e.code === "time_10m")).toBe(true);
    // not repeated
    const before = bus.of("timer.tick").filter((e) => e.warning).length;
    await t.app.interviews.sweep();
    expect(bus.of("timer.tick").filter((e) => e.warning).length).toBe(before);

    // past 85% (25.5 min) the next answer is met with the wrap-up
    setClock(t, at(26));
    const late = await ada.say(id, "Sorry, still thinking about the approach.");
    expect(late.body.state).toBe("WRAPUP");
    expect((await ada.get(id)).session.state).toBe("WRAPUP");

    // the clock runs out: the sweep ends the session within seconds, with a closing line
    setClock(t, at(30.05));
    await t.app.interviews.sweep();
    await t.idle();
    const s = (await ada.get(id)).session;
    expect(s).toMatchObject({ endReason: "timer" });
    expect(s.endedAt).not.toBeNull();
    const nope = await ada.say(id, "wait");
    expect(nope.res.statusCode).toBe(409);
    bus.stop();
  });

  it("ends within five seconds of expiry even if nobody is connected", async () => {
    setClock(t, base);
    const id = await ada.startNew({ minutes: 20 });
    await ada.say(id, "Hello");
    setClock(t, new Date(at(20).getTime() + 4000));
    await t.app.interviews.sweep();
    expect((await ada.get(id)).session.endedAt).not.toBeNull();
  });

  it("closes politely when time runs out in the middle of a question", async () => {
    setClock(t, base);
    const id = await ada.startNew({ minutes: 20 });
    await ada.say(id, "Hello there");
    setClock(t, at(20.02));
    await t.app.interviews.sweep();
    await t.idle();
    expect((await ada.get(id)).turns.at(-1)?.text).toMatch(/all the time we have/i);
  });

  it("pauses once in practice mode, freezing the clock", async () => {
    setClock(t, base);
    const id = await ada.startNew({ realistic: false, minutes: 30 });
    setClock(t, at(5));
    expect((await ada.call("POST", `/interviews/${id}/pause`)).statusCode).toBe(200);
    expect((await ada.say(id, "hi")).res.statusCode).toBe(409);
    setClock(t, at(7));
    const resumed = await ada.call("POST", `/interviews/${id}/resume`);
    expect(resumed.statusCode).toBe(200);
    // 7 minutes passed, 2 of them paused: 5 minutes elapsed
    const s = resumed.json<{ session: { elapsedMs: number; remainingMs: number } }>().session;
    expect(s.elapsedMs).toBe(5 * 60_000);
    expect(s.remainingMs).toBe(25 * 60_000);
    // a second pause is not allowed
    expect((await ada.call("POST", `/interviews/${id}/pause`)).statusCode).toBe(409);
  });

  it("does not allow pausing in realistic mode", async () => {
    const id = await ada.startNew({ realistic: true });
    const res = await ada.call("POST", `/interviews/${id}/pause`);
    expect(res.statusCode).toBe(409);
  });

  it("a pause longer than three minutes only credits three", async () => {
    setClock(t, base);
    const id = await ada.startNew({ realistic: false, minutes: 30 });
    setClock(t, at(5));
    await ada.call("POST", `/interviews/${id}/pause`);
    setClock(t, at(15));
    await t.app.interviews.sweep(); // auto-resume after the allowance
    const s = (await ada.get(id)).session;
    expect(s.paused).toBe(false);
    const res = await ada.call("GET", `/interviews/${id}`);
    expect(res.json<{ session: { elapsedMs: number } }>().session.elapsedMs).toBe(12 * 60_000);
  });

  it("prompts after a long silence, at most twice", async () => {
    setClock(t, base);
    const id = await ada.startNew({ minutes: 45 });
    await ada.say(id, "Hello");
    const count = async () =>
      (await ada.get(id)).turns.filter((x) => /take your time/i.test(x.text)).length;
    setClock(t, at(4));
    await t.app.interviews.sweep();
    await t.idle();
    expect(await count()).toBe(1);
    setClock(t, at(4.2));
    await t.app.interviews.sweep();
    expect(await count()).toBe(1); // not again right away
    setClock(t, at(8));
    await t.app.interviews.sweep();
    setClock(t, at(12));
    await t.app.interviews.sweep();
    await t.idle();
    expect(await count()).toBeLessThanOrEqual(2);
  });
});

describe("integrity around practice features", () => {
  it("disables hints and the editorial for the problem being asked", async () => {
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    for (const [method, url] of [
      ["GET", "/problems/two-sum/hints"],
      ["POST", "/problems/two-sum/hints/1/unlock"],
      ["GET", "/problems/two-sum/editorial"],
      ["GET", "/problems/two-sum/editorial/status"],
    ] as const) {
      const res = await t.app.inject({ method, url: `/v1${url}`, headers: bearer(adaToken) });
      expect(res.statusCode, url).toBe(403);
      expect(res.json<{ error: { code: string } }>().error.code).toBe("HINT_LOCKED");
    }
    // other problems stay available
    const other = await t.app.inject({
      method: "GET",
      url: "/v1/problems/valid-parentheses/hints",
      headers: bearer(adaToken),
    });
    expect(other.statusCode).toBe(200);
    await ada.say(id, "hello");
    await ada.end(id);
    const after = await t.app.inject({
      method: "GET",
      url: "/v1/problems/two-sum/hints",
      headers: bearer(adaToken),
    });
    expect(after.statusCode).toBe(200);
  });

  it("accepts interview runs only for a live session that asks the problem", async () => {
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    const run = (slug: string, sessionId?: string, token = adaToken) =>
      t.app.inject({
        method: "POST",
        url: "/v1/submissions",
        headers: bearer(token),
        payload: {
          problemSlug: slug,
          language: "python",
          code: "class Solution:\n    pass",
          kind: "run",
          mode: "interview",
          ...(sessionId ? { interviewSessionId: sessionId } : {}),
        },
      });
    expect((await run("two-sum", id)).statusCode).toBe(202);
    expect((await run("two-sum")).statusCode).toBe(422); // no session
    expect((await run("valid-parentheses", id)).statusCode).toBe(422); // not part of the interview
    expect(
      (
        await run(
          "two-sum",
          id,
          (await signupAndLogin(t, { email: "c@example.com", handle: "carl" })).accessToken,
        )
      ).statusCode,
    ).toBe(404); // someone else's interview
    await ada.end(id);
    expect((await run("two-sum", id)).statusCode).toBe(409);
    const { rows } = await t.pool.query("SELECT mode, interview_session_id FROM submissions");
    expect(rows[0]).toMatchObject({ mode: "interview", interview_session_id: id });
    await verifyAllEmails(t);
  });
});

async function insertSubmission(slug: string, verdict: string, kind: "run" | "submit") {
  const { rows: p } = await t.pool.query("SELECT id FROM problems WHERE slug = $1", [slug]);
  const { rows: u } = await t.pool.query("SELECT id FROM users WHERE email = 'ada@example.com'");
  const { rows: s } = await t.pool.query(
    "SELECT id FROM interview_sessions ORDER BY created_at DESC LIMIT 1",
  );
  const { rows } = await t.pool.query(
    `INSERT INTO submissions (id, user_id, problem_id, problem_version, language, code, code_hash, kind, mode, interview_session_id, verdict, passed, total)
     VALUES (gen_random_uuid(), $1, $2, 1, 'python', 'class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        return []', 'h', $3, 'interview', $4, $5, 10, 10)
     RETURNING id`,
    [u[0].id, p[0].id, kind, s[0].id, verdict],
  );
  return rows[0].id as string;
}
