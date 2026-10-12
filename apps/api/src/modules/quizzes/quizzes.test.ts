import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  QuizAnswerResult,
  QuizAttemptDto,
  QuizCatalogResponse,
  QuizResultDto,
  ReadinessDto,
} from "@prepquest/shared";
import { seedContent, seedLearning } from "../../test/content.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";
import { resetLearning } from "../../test/solve.js";

let t: TestApp;
let ada: string;
let bob: string;

const NOW = new Date("2026-03-02T09:00:00Z");

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum"]);
  await seedLearning(t);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetLearning(t);
  t.app.ai.now = () => NOW;
});

const call = <T>(method: "GET" | "POST", url: string, token: string | null, payload?: object) =>
  t.app
    .inject({
      method,
      url: `/v1${url}`,
      ...(token ? { headers: bearer(token) } : {}),
      ...(payload ? { payload } : {}),
    })
    .then((r) => ({ status: r.statusCode, body: r.json<T>() }));

const start = async (body: object, token = ada) => {
  const r = await call<QuizAttemptDto>("POST", "/quizzes/attempts", token, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};

interface KeyRow {
  id: string;
  type: string;
  answer: unknown;
}
const key = async (id: string): Promise<KeyRow> =>
  (await t.pool.query(`SELECT id, type, answer FROM quiz_questions WHERE id = $1`, [id]))
    .rows[0] as KeyRow;
/** A response that is right for the question, taken from the database key (never sent to the browser). */
const right = (k: KeyRow): unknown =>
  k.type === "blank" || k.type === "output" ? (k.answer as string[])[0] : k.answer;
const wrong = (k: KeyRow): unknown => {
  if (k.type === "tf") return !(k.answer as boolean);
  if (k.type === "multi") return ["a"];
  if (k.type === "single") return k.answer === "a" ? "b" : "a";
  return "definitely not it";
};

const answerAll = async (
  attempt: QuizAttemptDto,
  pick: (k: KeyRow, i: number) => unknown,
  token = ada,
) => {
  for (const [i, q] of attempt.questions.entries()) {
    const r = await call<QuizAnswerResult>(
      "POST",
      `/quizzes/attempts/${attempt.id}/answers`,
      token,
      {
        questionId: q.id,
        response: pick(await key(q.id), i),
        timeMs: 3000,
      },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
};

const finish = async (id: string, token = ada) => {
  const r = await call<QuizResultDto>("POST", `/quizzes/attempts/${id}/finish`, token);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};

describe("quizzes (C1)", () => {
  it("lists the subjects with their topics", async () => {
    const r = await call<QuizCatalogResponse>("GET", "/quizzes", ada);
    expect(r.status).toBe(200);
    expect(r.body.subjects.map((s) => s.subject).sort()).toEqual(["cn", "dbms", "oop", "os"]);
    const os = r.body.subjects.find((s) => s.subject === "os")!;
    expect(os.label).toBe("Operating systems");
    expect(os.questions).toBeGreaterThanOrEqual(10);
    expect(os.topics.length).toBeGreaterThan(2);
    expect(r.body.weakCount).toBe(0);
  });

  it("a practice quiz never sends the answers, and shows them after each answer", async () => {
    const attempt = await start({ mode: "practice", subject: "os", count: 4 });
    expect(attempt.questions).toHaveLength(4);
    expect(attempt.deadlineAt).toBeNull();
    expect(JSON.stringify(attempt)).not.toMatch(/"answer"|explanation|interview_line/);

    const q = attempt.questions[0]!;
    const k = await key(q.id);
    const bad = await call<QuizAnswerResult>(
      "POST",
      `/quizzes/attempts/${attempt.id}/answers`,
      ada,
      {
        questionId: q.id,
        response: wrong(k),
      },
    );
    expect(bad.body.feedback?.correct).toBe(false);
    expect(bad.body.feedback?.answer).toEqual(k.answer);
    expect(bad.body.feedback?.explanation.length).toBeGreaterThan(10);
    // an answer is final in practice mode
    const again = await call<{ error: { code: string } }>(
      "POST",
      `/quizzes/attempts/${attempt.id}/answers`,
      ada,
      { questionId: q.id, response: right(k) },
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_ANSWERED");
  });

  it("scores the attempt and pays XP only for questions answered correctly for the first time", async () => {
    const first = await start({ mode: "practice", subject: "cn", count: 5 });
    await answerAll(first, (k, i) => (i === 0 ? wrong(k) : right(k)));
    const result = await finish(first.id);
    expect(result).toMatchObject({
      correct: 4,
      total: 5,
      percent: 80,
      xpAwarded: 8,
      expired: false,
    });
    expect(result.review).toHaveLength(5);
    expect(result.review.filter((r) => r.correct)).toHaveLength(4);
    expect(result.review[0]!.explanation).toBeTruthy();

    const xp = await t.pool.query(
      `SELECT xp FROM profiles WHERE user_id = (SELECT id FROM users WHERE email = 'ada@example.com')`,
    );
    expect(Number(xp.rows[0].xp)).toBe(8);
    expect((await t.pool.query(`SELECT sum(quizzes)::int AS n FROM activity_days`)).rows[0].n).toBe(
      1,
    );

    // finishing again changes nothing
    expect((await finish(first.id)).xpAwarded).toBe(8);
    expect(Number((await t.pool.query(`SELECT xp FROM profiles WHERE xp > 0`)).rows[0].xp)).toBe(8);

    // answering the same questions correctly again earns nothing new
    const second = await start({ mode: "practice", subject: "cn", count: 12 });
    const ids = new Set(first.questions.map((q) => q.id));
    await answerAll(second, (k) => right(k));
    const r2 = await finish(second.id);
    const repeats = second.questions.filter((q) => ids.has(q.id)).length;
    expect(r2.xpAwarded).toBe((12 - Math.min(repeats, 4)) * 2);
  });

  it("caps the XP one attempt can pay", async () => {
    const a = await start({ mode: "practice", count: 30 });
    await answerAll(a, (k) => right(k));
    expect((await finish(a.id)).xpAwarded).toBe(30);
  });

  it("a timed test hides the answers, lets you change them, and ends on the server's clock", async () => {
    const attempt = await start({ mode: "timed", subject: "dbms", count: 5, minutes: 2 });
    expect(attempt.deadlineAt).toBe(new Date(NOW.getTime() + 120_000).toISOString());
    const [q1, q2] = attempt.questions;
    const k1 = await key(q1!.id);

    const saved = await call<QuizAnswerResult>(
      "POST",
      `/quizzes/attempts/${attempt.id}/answers`,
      ada,
      {
        questionId: q1!.id,
        response: wrong(k1),
      },
    );
    expect(saved.body).toEqual({ saved: true, feedback: null });
    // change it before time is up
    await call("POST", `/quizzes/attempts/${attempt.id}/answers`, ada, {
      questionId: q1!.id,
      response: right(k1),
    });
    await call("POST", `/quizzes/attempts/${attempt.id}/answers`, ada, {
      questionId: q2!.id,
      response: right(await key(q2!.id)),
    });

    // the browser is closed and the clock runs out
    t.app.ai.now = () => new Date(NOW.getTime() + 121_000);
    const late = await call<{ error: { code: string } }>(
      "POST",
      `/quizzes/attempts/${attempt.id}/answers`,
      ada,
      { questionId: attempt.questions[2]!.id, response: "a" },
    );
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("QUIZ_EXPIRED");

    const reopened = await call<{ attempt: QuizAttemptDto }>(
      "GET",
      `/quizzes/attempts/${attempt.id}`,
      ada,
    );
    expect(reopened.body.attempt.answered.sort()).toEqual([q1!.id, q2!.id].sort());

    const result = await finish(attempt.id);
    expect(result).toMatchObject({ correct: 2, total: 5, percent: 40, expired: true });
    expect(result.review.filter((r) => !r.answered)).toHaveLength(3);
  });

  it("only the owner can use an attempt, and only its own questions", async () => {
    const attempt = await start({ mode: "practice", subject: "os", count: 3 });
    const other = await call("POST", `/quizzes/attempts/${attempt.id}/answers`, bob, {
      questionId: attempt.questions[0]!.id,
      response: "a",
    });
    expect(other.status).toBe(404);
    expect((await call("GET", `/quizzes/attempts/${attempt.id}`, bob)).status).toBe(404);
    expect((await call("POST", `/quizzes/attempts/${attempt.id}/finish`, bob)).status).toBe(404);

    const foreign = await start({ mode: "practice", subject: "oop", count: 3 });
    const notInQuiz = foreign.questions[0]!.id;
    const mine = await start({ mode: "practice", subject: "os", count: 3 });
    const r = await call("POST", `/quizzes/attempts/${mine.id}/answers`, ada, {
      questionId: notInQuiz,
      response: "a",
    });
    expect(r.status).toBe(422);
  });

  it("a finished quiz cannot take more answers", async () => {
    const attempt = await start({ mode: "practice", subject: "os", count: 3 });
    await finish(attempt.id);
    const r = await call<{ error: { code: string } }>(
      "POST",
      `/quizzes/attempts/${attempt.id}/answers`,
      ada,
      { questionId: attempt.questions[0]!.id, response: "a" },
    );
    expect(r.body.error.code).toBe("QUIZ_FINISHED");
  });

  it("a topic drill needs a topic and stays inside it", async () => {
    const missing = await call("POST", "/quizzes/attempts", ada, { mode: "drill" });
    expect(missing.status).toBe(422);
    const a = await start({ mode: "drill", subject: "os", topic: "deadlocks", count: 5 });
    expect(a.questions.length).toBeGreaterThan(0);
    expect(a.questions.every((q) => q.topic === "deadlocks")).toBe(true);
    const none = await call<{ error: { code: string } }>("POST", "/quizzes/attempts", ada, {
      mode: "drill",
      topic: "no-such-topic",
    });
    expect(none.body.error.code).toBe("NO_QUESTIONS");
  });

  it("a weak-area quiz is built from the questions you last got wrong", async () => {
    const none = await call<{ error: { code: string } }>("POST", "/quizzes/attempts", ada, {
      mode: "weak",
    });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe("NO_WEAK_QUESTIONS");

    const a = await start({ mode: "practice", subject: "os", count: 6 });
    await answerAll(a, (k, i) => (i < 3 ? wrong(k) : right(k)));
    await finish(a.id);
    const missed = new Set(a.questions.slice(0, 3).map((q) => q.id));
    expect((await call<QuizCatalogResponse>("GET", "/quizzes", ada)).body.weakCount).toBe(3);

    const weak = await start({ mode: "weak", count: 10 });
    expect(weak.questions).toHaveLength(3);
    expect(weak.questions.every((q) => missed.has(q.id))).toBe(true);

    // getting them right clears them from the weak list
    await answerAll(weak, (k) => right(k));
    await finish(weak.id);
    expect((await call<QuizCatalogResponse>("GET", "/quizzes", ada)).body.weakCount).toBe(0);
  });

  it("quiz results feed the CS fundamentals part of readiness", async () => {
    const before = await call<ReadinessDto>("GET", "/me/readiness", ada);
    expect(before.body.components.find((c) => c.key === "cs")?.score).toBeNull();
    const a = await start({ mode: "practice", subject: "os", count: 10 });
    await answerAll(a, (k) => right(k));
    await finish(a.id);
    const after = await call<ReadinessDto>("GET", "/me/readiness", ada);
    const cs = after.body.components.find((c) => c.key === "cs")!;
    expect(cs.score).not.toBeNull();
    expect(cs.score!).toBeGreaterThan(30);
  });

  it("validates the request and requires signing in", async () => {
    expect((await call("POST", "/quizzes/attempts", ada, { mode: "marathon" })).status).toBe(422);
    expect(
      (await call("POST", "/quizzes/attempts", ada, { mode: "practice", count: 1 })).status,
    ).toBe(422);
    expect((await call("GET", "/quizzes", null)).status).toBe(401);
  });
});
