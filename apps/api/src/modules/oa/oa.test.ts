import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OaAttemptDto, OaCatalogResponse } from "@prepquest/shared";
import { seedAssess, seedLearning } from "../../test/content.js";
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

const T0 = new Date("2026-03-02T09:00:00Z");
let clock = T0;
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

beforeAll(async () => {
  t = await makeTestApp();
  await seedLearning(t);
  await seedAssess(t);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetLearning(t);
  clock = T0;
  t.app.ai.now = () => clock;
});

const call = <T>(
  method: "GET" | "POST" | "PUT",
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

const start = async (template: string, token = ada) => {
  const r = await call<OaAttemptDto>("POST", "/oa/attempts", token, { template });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};
const begin = (id: string, index: number, token = ada) =>
  call<OaAttemptDto>("POST", `/oa/attempts/${id}/sections/${index}/start`, token);
const submitSection = (id: string, token = ada) =>
  call<OaAttemptDto>("POST", `/oa/attempts/${id}/submit-section`, token);
const getAttempt = (id: string, token = ada) =>
  call<OaAttemptDto>("GET", `/oa/attempts/${id}`, token);

interface Key {
  type: string;
  answer: unknown;
  options: Array<{ id: string }> | null;
}
const keyOf = async (id: string): Promise<Key> => {
  for (const table of ["aptitude_items", "quiz_questions"]) {
    const r = await t.pool.query(`SELECT type, answer, options FROM ${table} WHERE id = $1`, [id]);
    if (r.rows[0]) return r.rows[0] as Key;
  }
  throw new Error("no such item");
};
const rightOf = (k: Key): string =>
  k.type === "blank" || k.type === "output"
    ? (k.answer as string[])[0]!
    : k.type === "multi"
      ? (k.answer as string[]).join(",")
      : String(k.answer);
const wrongOf = (k: Key): string => {
  if (k.type === "tf") return String(!(k.answer as boolean));
  if (k.type === "multi") return "a";
  if (k.type === "single") return k.options!.find((o) => o.id !== k.answer)!.id;
  return "zzz";
};
const answerItem = (id: string, itemId: string, response: string | null, token = ada) =>
  call<{ saved: boolean; secondsLeft: number }>("PUT", `/oa/attempts/${id}/answers`, token, {
    itemId,
    response,
  });
/** Answers the first `right` items correctly and the next `wrong` ones wrongly in the running section. */
const fill = async (a: OaAttemptDto, right: number, wrong: number) => {
  const items = a.current!.items;
  for (const [i, it] of items.entries()) {
    if (i < right) await answerItem(a.id, it.id, rightOf(await keyOf(it.id)));
    else if (i < right + wrong) await answerItem(a.id, it.id, wrongOf(await keyOf(it.id)));
  }
};
const xp = async () =>
  Number(
    (
      await t.pool.query(
        `SELECT p.xp FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.email = 'ada@example.com'`,
      )
    ).rows[0].xp,
  );

describe("online assessments", () => {
  it("lists the test templates with their layout", async () => {
    expect((await call("GET", "/oa", null)).status).toBe(401);
    const r = await call<OaCatalogResponse>("GET", "/oa", ada);
    expect(r.body.templates.map((x) => x.slug)).toContain("campus-oa");
    const campus = r.body.templates.find((x) => x.slug === "campus-oa")!;
    expect(campus).toMatchObject({ negativeMarking: 0.25, totalQuestions: 36, totalMinutes: 47 });
    expect(campus.sections).toHaveLength(5);
    expect(r.body.open).toBeNull();
  });

  it("builds the paper on start, and sections open only when begun, in order", async () => {
    const a = await start("cs-fundamentals-test");
    expect(a).toMatchObject({ step: "between", index: 0, current: null, report: null });
    expect(a.sections.map((s) => [s.key, s.count, s.status])).toEqual([
      ["os", 6, "pending"],
      ["dbms", 6, "pending"],
      ["cn", 6, "pending"],
      ["oop", 6, "pending"],
    ]);
    expect((await begin(a.id, 1)).status).toBe(409); // out of order
    const running = await begin(a.id, 0);
    expect(running.body).toMatchObject({ step: "section", index: 0 });
    expect(running.body.current!.secondsLeft).toBe(360);
    expect(running.body.current!.items).toHaveLength(6);
    expect((await begin(a.id, 1)).status).toBe(409); // one running at a time
  });

  it("never sends the answer key while the test runs", async () => {
    const a = await start("cs-fundamentals-test");
    const running = (await begin(a.id, 0)).body;
    const text = JSON.stringify(running);
    expect(text).not.toContain('"answer"');
    expect(text).not.toContain("explanation");
    expect(running.report).toBeNull();
  });

  it("starts only one test at a time", async () => {
    const a = await start("cs-fundamentals-test");
    const second = await call<{ error: { code: string } }>("POST", "/oa/attempts", ada, {
      template: "speed-quant",
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("OA_OPEN");
    const catalog = await call<OaCatalogResponse>("GET", "/oa", ada);
    expect(catalog.body.open?.id).toBe(a.id);
    // another learner is not blocked
    await start("speed-quant", bob);
  });

  it("keeps the clock on the server and refuses late answers", async () => {
    const a = await start("speed-reasoning"); // one section, 6 minutes
    const running = (await begin(a.id, 0)).body;
    const [first, second] = running.current!.items;
    clock = at(120);
    const saved = await answerItem(a.id, first!.id, rightOf(await keyOf(first!.id)));
    expect(saved.body.secondsLeft).toBe(240);
    // reopening the page later still shows the remaining time and the saved answer
    clock = at(200);
    const again = (await getAttempt(a.id)).body;
    expect(again.current!.secondsLeft).toBe(160);
    expect(Object.keys(again.current!.answers)).toEqual([first!.id]);

    clock = at(361);
    const late = await call<{ error: { code: string } }>(
      "PUT",
      `/oa/attempts/${a.id}/answers`,
      ada,
      { itemId: second!.id, response: "a" },
    );
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("OA_SECTION_CLOSED");
    // the only section ended by the clock, so the test is finished and scored without the late answer
    const done = (await getAttempt(a.id)).body;
    expect(done.step).toBe("finished");
    expect(done.sections[0]).toMatchObject({ status: "done", endedBy: "time", answered: 1 });
    expect(done.report!.sections[0]).toMatchObject({ correct: 1, attempted: 1, skipped: 9 });
    expect(done.report!.rushed).toEqual(["Logical reasoning"]);
  });

  it("locks a finished section and scores with negative marking", async () => {
    const a = await start("cs-fundamentals-test"); // negative marking 0.25, 6 items per section
    let cur = (await begin(a.id, 0)).body;
    await fill(cur, 6, 0);
    cur = (await submitSection(a.id)).body;
    expect(cur).toMatchObject({ step: "between", index: 1 });
    expect((await begin(a.id, 0)).status).toBe(409); // cannot reopen
    const locked = await answerItem(a.id, (await firstItem(a.id, 0))!, "a");
    expect(locked.status).toBe(409);

    cur = (await begin(a.id, 1)).body;
    await fill(cur, 3, 3);
    await submitSection(a.id);
    await begin(a.id, 2); // left blank
    await submitSection(a.id);
    cur = (await begin(a.id, 3)).body;
    await fill(cur, 0, 2);
    const done = (await submitSection(a.id)).body;

    expect(done.step).toBe("finished");
    const r = done.report!;
    expect(r.sections.map((s) => s.marks)).toEqual([6, 2.25, 0, 0]);
    expect(r.sections[1]).toMatchObject({ correct: 3, wrong: 3, skipped: 0, accuracy: 50 });
    expect(r.sections[2]).toMatchObject({ attempted: 0, skipped: 6, accuracy: null });
    expect(r.marks).toBe(8.25);
    expect(r.maxMarks).toBe(24);
    expect(r.percent).toBe(34);
    expect(r.percentile).toBeNull(); // not enough other attempts yet
    expect(r.xpAwarded).toBe(4); // 9 correct answers, half in XP
    expect(await xp()).toBe(4);

    expect(r.review).toHaveLength(24);
    const missed = r.review.find((x) => x.answered && !x.correct)!;
    expect(missed.answer).toBeTruthy();
    expect(missed.explanation).toBeTruthy();
  });

  it("scores typed answers and true/false items", async () => {
    const a = await start("speed-quant");
    const cur = (await begin(a.id, 0)).body;
    const blank = cur.current!.items.find((i) => i.type === "blank");
    expect(blank).toBeDefined();
    const k = await keyOf(blank!.id);
    // typed answers ignore case and spacing
    await answerItem(a.id, blank!.id, `  ${rightOf(k).toUpperCase()}  `);
    const done = (await call<OaAttemptDto>("POST", `/oa/attempts/${a.id}/finish`, ada)).body;
    expect(done.report!.sections[0]).toMatchObject({ correct: 1, wrong: 0, attempted: 1 });
  });

  it("ending early scores the sections not reached as zero", async () => {
    const a = await start("cs-fundamentals-test");
    const cur = (await begin(a.id, 0)).body;
    await fill(cur, 4, 0);
    const done = (await call<OaAttemptDto>("POST", `/oa/attempts/${a.id}/finish`, ada)).body;
    expect(done.step).toBe("finished");
    expect(done.report!.sections.map((s) => s.marks)).toEqual([4, 0, 0, 0]);
    expect(done.report!.weakTopics.length).toBeGreaterThanOrEqual(0);
    // a finished test accepts nothing more
    const late = await answerItem(a.id, cur.current!.items[0]!.id, "a");
    expect(late.status).toBe(409);
    // and a new one can start
    await start("speed-quant");
  });

  it("closes a forgotten test so it cannot block the next one", async () => {
    const a = await start("cs-fundamentals-test");
    await begin(a.id, 0);
    clock = at(25 * 3600);
    const next = await start("speed-quant");
    expect(next.template.slug).toBe("speed-quant");
    const old = (await getAttempt(a.id)).body;
    expect(old.step).toBe("finished");
    expect(old.report).not.toBeNull();
  });

  it("shows a percentile once enough others have taken the test", async () => {
    for (let i = 0; i < 10; i++) {
      await t.pool.query(
        `INSERT INTO oa_attempts (id, user_id, template_id, state, report, finished_at, marks, max_marks)
         SELECT gen_random_uuid(), u.id, tpl.id, '{"sections":[]}'::jsonb,
                jsonb_build_object('percent', $1::int, 'sections', jsonb_build_array(jsonb_build_object('key','quant','percent',$1::int))),
                now(), 1, 10
         FROM users u, oa_templates tpl WHERE u.email = 'bob@example.com' AND tpl.slug = 'speed-quant'`,
        [(i + 1) * 10],
      );
    }
    const a = await start("speed-quant");
    await begin(a.id, 0);
    const done = (await call<OaAttemptDto>("POST", `/oa/attempts/${a.id}/finish`, ada)).body;
    // zero percent beats nobody
    expect(done.report!.percent).toBe(0);
    expect(done.report!.percentile).toBe(0);
    expect(done.report!.sections[0]!.percentile).toBe(0);
  });

  it("keeps attempts private", async () => {
    const a = await start("speed-quant");
    expect((await getAttempt(a.id, bob)).status).toBe(404);
    expect((await begin(a.id, 0, bob)).status).toBe(404);
  });
});

async function firstItem(id: string, section: number): Promise<string | undefined> {
  const r = await t.pool.query(`SELECT state FROM oa_attempts WHERE id = $1`, [id]);
  return r.rows[0].state.sections[section].itemIds[0];
}
