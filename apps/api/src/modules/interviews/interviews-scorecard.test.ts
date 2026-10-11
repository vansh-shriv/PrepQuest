import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CODING_RUBRIC } from "@prepquest/interview-core";
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
let adaToken: string;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses"]);
  adaToken = (await signupAndLogin(t)).accessToken;
  await verifyAllEmails(t);
  ada = new Interviews(t, adaToken);
});
afterAll(() => t.close());
afterEach(() => resetClock(t));
beforeEach(async () => {
  await t.pool.query("DELETE FROM interview_sessions");
  await t.pool.query("DELETE FROM submissions");
  await t.pool.query("DELETE FROM llm_usage");
  t.mock.overrides.clear();
  t.mock.calls.length = 0;
});

interface Review {
  status: string;
  scorecard: null | {
    overall: number | null;
    band: string | null;
    summary: string;
    strengths: { text: string; evidence: { ref: number | string; quote: string }[] }[];
    redFlags: { evidence: unknown[]; remedy: string }[];
    nextActions: unknown[];
    coverage: { rubric: number; session: number; lowConfidence: boolean };
    scores: {
      dimension: string;
      score: number | null;
      weight: number;
      evidence: { type: string; ref: number | string; quote: string }[];
    }[];
  };
  annotations: { id: string; turnSeq: number; kind: string; offsetMs: number }[];
  transcript: { seq: number; speaker: string; text: string }[];
}

async function review(id: string) {
  const res = await ada.call("GET", `/interviews/${id}/review`);
  return { res, body: res.json<Review>() };
}

async function finishedSession(slug = "two-sum") {
  const id = await ada.startNew({ problemSlugs: [slug], minutes: 30 });
  await ada.say(id, "Hi, I'm Ada, a final year student who enjoys algorithms.");
  await ada.say(id, "Can the array contain duplicates or negative numbers?");
  await ada.say(
    id,
    "I would use a hash map to store complements, which gives O(n) time and O(n) space.",
  );
  await ada.say(id, "Scan once, store each value, and check the complement before inserting.");
  await ada.end(id);
  return id;
}

/** A scorecard JSON where every dimension quotes a real candidate turn. */
async function draftFor(id: string, score: number) {
  const turns = (await ada.get(id)).turns.filter((x) => x.speaker === "candidate");
  const quote = turns.at(-2)!.text.split(" ").slice(0, 8).join(" ");
  const ref = turns.at(-2)!.seq;
  const ev = [{ type: "turn", ref, quote }];
  return JSON.stringify({
    scores: CODING_RUBRIC.dimensions
      .filter((d) => !d.fromJudge)
      .map((d) => ({ dimension: d.key, score, justification: "because", evidence: ev })),
    strengths: [{ text: "Clear", evidence: ev }],
    red_flags: [],
    next_actions: [{ kind: "topic", ref: "x", title: "Practise", why: "y" }],
    summary: "Solid.",
  });
}

describe("scorecard generation", () => {
  it("is generated after the interview with evidence for every score", async () => {
    const id = await finishedSession();
    const { res, body } = await review(id);
    expect(res.statusCode, res.body).toBe(200);
    expect(body.status).toBe("ready");
    const sc = body.scorecard!;
    expect(sc.scores).toHaveLength(7);
    for (const s of sc.scores.filter((x) => x.score !== null && x.dimension !== "correctness")) {
      expect(s.evidence.length, s.dimension).toBeGreaterThan(0);
      // every quote really occurs in the cited turn
      for (const e of s.evidence) {
        const turn = body.transcript.find((x) => x.seq === Number(e.ref))!;
        expect(turn.text.toLowerCase()).toContain(e.quote.toLowerCase().split(" ")[0]!);
      }
    }
    expect(sc.strengths.length).toBeGreaterThan(0);
    expect(sc.nextActions).toHaveLength(3);
    expect(sc.overall).toBeGreaterThanOrEqual(0);
    expect(["Not ready", "Borderline", "Ready", "Strong"]).toContain(sc.band);
    expect(body.annotations.length).toBeGreaterThan(0);
    // annotations point at candidate turns
    const candidateSeqs = new Set(
      body.transcript.filter((x) => x.speaker === "candidate").map((x) => x.seq),
    );
    expect(body.annotations.every((a) => candidateSeqs.has(a.turnSeq))).toBe(true);
  });

  it("computes the overall score and the band in code, from the weights", async () => {
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    await ada.say(id, "Hi, I'm Ada, a final year student who enjoys algorithms.");
    await ada.say(id, "I would use a hash map to store complements, which gives O(n) time.");
    await ada.say(id, "Scan once and store each value in the map.");
    // an accepted first-try submission: correctness = 5 from the judge
    await t.pool.query(
      `INSERT INTO submissions (id, user_id, problem_id, problem_version, language, code, code_hash, kind, mode, interview_session_id, verdict, passed, total)
       SELECT gen_random_uuid(), u.id, p.id, 1, 'python', 'x', 'h', 'submit', 'interview', $1, 'AC', 10, 10
       FROM users u, problems p WHERE u.email = 'ada@example.com' AND p.slug = 'two-sum'`,
      [id],
    );
    t.mock.overrides.set("scorecard", [await draftFor(id, 3)]);
    await ada.end(id);
    const { body } = await review(id);
    // six dimensions at 3 (50%) weigh 95, correctness 5 (100%) weighs 5 -> 52.5 -> 53
    expect(body.scorecard?.overall).toBe(53);
    expect(body.scorecard?.band).toBe("Borderline");
    const correctness = body.scorecard!.scores.find((x) => x.dimension === "correctness")!;
    expect(correctness).toMatchObject({ score: 5, weight: 0.05 });

    // the same transcript scored higher gives a higher overall: the model's number is never used
    await t.pool.query("DELETE FROM interview_scorecards WHERE session_id = $1", [id]);
    await t.pool.query(
      "INSERT INTO interview_scorecards (id, session_id, rubric_id, rubric_version, status) VALUES (gen_random_uuid(), $1, 'coding', '1.0.0', 'generating')",
      [id],
    );
    t.mock.overrides.set("scorecard", [
      (await draftFor(id, 5)).replace('"summary":"Solid."', '"summary":"Overall 12/100"'),
    ]);
    await t.app.interviews.regenerateScorecard(id);
    const second = (await review(id)).body.scorecard!;
    expect(second.overall).toBe(100);
    expect(second.band).toBe("Strong");
  });

  it("repairs a draft with invented quotes, and counts the extra call", async () => {
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    await ada.say(id, "Hello, I'm Ada and I like graph problems.");
    await ada.say(id, "I would use a hash map to store complements.");
    const bad = JSON.stringify({
      scores: CODING_RUBRIC.dimensions
        .filter((d) => !d.fromJudge)
        .map((d) => ({
          dimension: d.key,
          score: 5,
          justification: "great",
          evidence: [
            { type: "turn", ref: 2, quote: "I implemented a lock-free skip list in Rust" },
          ],
        })),
      strengths: [
        {
          text: "x",
          evidence: [{ type: "turn", ref: 2, quote: "I implemented a lock-free skip list" }],
        },
      ],
      red_flags: [],
      next_actions: [],
      summary: "Amazing.",
    });
    t.mock.overrides.set("scorecard", [bad]);
    await ada.end(id);
    const { body } = await review(id);
    expect(body.status).toBe("ready");
    expect(JSON.stringify(body.scorecard)).not.toMatch(/lock-free/);
    const calls = t.mock.calls.filter((c) => c.task === "scorecard");
    expect(calls).toHaveLength(2);
    // the repair request told the model what was wrong
    expect(calls[1]!.messages.at(-1)!.content).toMatch(/quote not found/);
  });

  it("treats a score without evidence as insufficient evidence", async () => {
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    await ada.say(id, "Hello, I'm Ada and I like graph problems.");
    await ada.say(id, "I would use a hash map to store complements.");
    t.mock.overrides.set("scorecard", [
      JSON.stringify({
        scores: CODING_RUBRIC.dimensions
          .filter((d) => !d.fromJudge)
          .map((d) => ({
            dimension: d.key,
            score: null,
            justification: "insufficient evidence",
            evidence: [],
          })),
        strengths: [],
        red_flags: [],
        next_actions: [],
        summary: "Too little to judge.",
      }),
    ]);
    await ada.end(id);
    const sc = (await review(id)).body.scorecard!;
    expect(sc.scores.every((x) => x.score === null)).toBe(true);
    expect(sc.overall).toBeNull();
    expect(sc.band).toBeNull();
    expect(sc.coverage.lowConfidence).toBe(true);
  });

  it("notes reduced coverage when the interview ends early", async () => {
    const id = await finishedSession();
    const sc = (await review(id)).body.scorecard!;
    expect(sc.coverage.session).toBeLessThan(0.5);
    expect(sc.coverage.lowConfidence).toBe(true);
  });

  it("returns 202 while generating and 409 while the interview is running", async () => {
    const id = await ada.startNew();
    await ada.say(id, "Hi there, I'm Ada.");
    expect((await ada.call("GET", `/interviews/${id}/review`)).statusCode).toBe(409);
    await ada.end(id);
    await t.pool.query(
      "UPDATE interview_scorecards SET status = 'generating' WHERE session_id = $1",
      [id],
    );
    const res = await ada.call("GET", `/interviews/${id}/review`);
    expect(res.statusCode).toBe(202);
    expect(res.json<Review>().scorecard).toBeNull();
  });

  it("retries a failed generation and lets the user regenerate after giving up", async () => {
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    await ada.say(id, "Hello, I'm Ada and I like graph problems.");
    await ada.say(id, "I would use a hash map to store complements.");
    t.mock.overrides.set(
      "scorecard",
      Array.from({ length: 9 }, () => "not json at all"),
    );
    await ada.end(id);
    expect((await review(id)).body.status).toBe("generating"); // attempt 1 failed, will retry
    for (const minutes of [3, 6]) {
      setClock(t, new Date(Date.now() + minutes * 60_000));
      await t.app.interviews.sweep();
      await t.idle();
    }
    expect((await review(id)).body.status).toBe("failed");
    const retry = await ada.call("POST", `/interviews/${id}/review/retry`);
    expect(retry.statusCode).toBe(202);
    await t.idle();
    expect((await review(id)).body.status).toBe("ready");
    expect((await ada.call("POST", `/interviews/${id}/review/retry`)).statusCode).toBe(409);
  });

  it("keeps the scorecard when the annotations fail", async () => {
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    await ada.say(id, "Hello, I'm Ada and I like graph problems.");
    await ada.say(id, "I would use a hash map to store complements.");
    t.mock.overrides.set("annotations", ["nope", "nope", "nope"]);
    await ada.end(id);
    const { body } = await review(id);
    expect(body.status).toBe("ready");
    expect(body.annotations).toHaveLength(0);
  });

  it("scores a project interview with its own rubric", async () => {
    const resume = await readyResume(t, adaToken);
    const id = await ada.startNew({ type: "project", resumeId: resume, minutes: 30 });
    await ada.say(id, "Hi, I'm Ada and I build backend systems.");
    await ada.say(
      id,
      "I chose Redis instead of Kafka because of latency and the trade-off in durability.",
    );
    await ada.say(id, "It handled 10k users and we measured 120 ms at the 95th percentile.");
    await ada.end(id);
    const sc = (await review(id)).body.scorecard!;
    expect(sc.scores.map((x) => x.dimension)).toEqual([
      "ownership",
      "technical_depth",
      "decisions",
      "impact",
      "failure_analysis",
      "scalability",
      "honesty",
    ]);
    expect(sc.scores.reduce((a, b) => a + b.weight, 0)).toBeCloseTo(1, 3);
    await t.pool.query("DELETE FROM resumes");
  });
});

describe("review extras", () => {
  it("exports the transcript, stores notes on annotations and feedback on the scorecard", async () => {
    const id = await finishedSession();
    const { body } = await review(id);
    const md = await ada.call("GET", `/interviews/${id}/transcript?format=md`);
    expect(md.headers["content-type"]).toMatch(/markdown/);
    expect(md.body).toContain("**You**");
    expect(md.body).toContain("Scorecard");
    const json = await ada.call("GET", `/interviews/${id}/transcript`);
    expect(json.json<{ transcript: unknown[] }>().transcript.length).toBeGreaterThan(4);

    const ann = body.annotations[0]!;
    expect(
      (await ada.call("POST", `/interviews/${id}/annotations/${ann.id}/note`, { note: "revisit" }))
        .statusCode,
    ).toBe(204);
    expect((await review(id)).body.annotations[0]).toMatchObject({ id: ann.id });
    expect(
      (await ada.call("POST", `/interviews/${id}/feedback`, { helpful: true, text: "useful" }))
        .statusCode,
    ).toBe(204);
    const { rows } = await t.pool.query(
      "SELECT helpful FROM interview_scorecards WHERE session_id = $1",
      [id],
    );
    expect(rows[0].helpful).toBe(1);
  });

  it("lists the history with scores and keeps other users out", async () => {
    const id = await finishedSession();
    const list = await ada.call("GET", "/interviews");
    const item = list.json<{
      items: { id: string; overall: number; band: string; scorecardStatus: string }[];
    }>().items[0]!;
    expect(item).toMatchObject({ id, scorecardStatus: "ready" });
    expect(item.overall).toBeGreaterThanOrEqual(0);
    const other = await signupAndLogin(t, { email: "z@example.com", handle: "zed" });
    await verifyAllEmails(t);
    const res = await t.app.inject({
      method: "GET",
      url: `/v1/interviews/${id}/review`,
      headers: bearer(other.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("stores code events for the replay and serves them in order", async () => {
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    for (const code of ["def a():\n  pass", "def a():\n  return 1", "def a():\n  return 1"]) {
      const r = await ada.call("POST", `/interviews/${id}/events`, {
        kind: "snapshot",
        language: "python",
        code,
      });
      expect(r.statusCode, r.body).toBe(200);
    }
    await ada.call("POST", `/interviews/${id}/events`, { kind: "paste", meta: { chars: 400 } });
    const ev = await ada.call("GET", `/interviews/${id}/events`);
    const items = ev.json<{ items: { kind: string; offsetMs: number }[] }>().items;
    expect(items.map((x) => x.kind)).toEqual(["code_snapshot", "code_snapshot", "paste"]); // duplicate snapshot dropped
    expect(items.map((x) => x.offsetMs)).toEqual(
      [...items.map((x) => x.offsetMs)].sort((a, b) => a - b),
    );
  });

  it("rejects a run that is not the user's or not finished", async () => {
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 30 });
    const bogus = await ada.call("POST", `/interviews/${id}/events`, {
      kind: "submit",
      submissionId: "11111111-1111-4111-8111-111111111111",
    });
    expect(bogus.statusCode).toBe(404);
    await t.pool.query(
      `INSERT INTO submissions (id, user_id, problem_id, problem_version, language, code, code_hash, kind, mode, interview_session_id, verdict)
       SELECT '22222222-2222-4222-8222-222222222222', u.id, p.id, 1, 'python', 'x', 'h', 'submit', 'interview', $1, 'RUNNING'
       FROM users u, problems p WHERE u.email = 'ada@example.com' AND p.slug = 'two-sum'`,
      [id],
    );
    const pending = await ada.call("POST", `/interviews/${id}/events`, {
      kind: "submit",
      submissionId: "22222222-2222-4222-8222-222222222222",
    });
    expect(pending.statusCode).toBe(409);
  });
});
