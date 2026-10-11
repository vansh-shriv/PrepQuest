import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedBank, seedContent } from "../../test/content.js";
import { Interviews, resetClock } from "../../test/interviews.js";
import { makeTestApp, signupAndLogin, verifyAllEmails, type TestApp } from "../../test/helpers.js";

let t: TestApp;
let ada: Interviews;
let bob: Interviews;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses"]);
  await seedBank(t);
  const a = (await signupAndLogin(t)).accessToken;
  const b = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
  ada = new Interviews(t, a);
  bob = new Interviews(t, b);
});
afterAll(() => t.close());
afterEach(() => resetClock(t));
beforeEach(async () => {
  await t.pool.query("DELETE FROM interview_sessions");
  await t.pool.query("DELETE FROM question_memory");
  t.mock.overrides.clear();
  t.mock.calls.length = 0;
});

const STORY =
  "Last summer at my internship I needed to cut our build time. I built a cache layer myself and we reduced build time by 40% over two weeks. I learned to measure first.";

async function behavioral() {
  const id = await ada.startNew({ type: "behavioral", minutes: 30 });
  await ada.say(id, "Hello, I am ready to begin.");
  await ada.say(id, STORY);
  await ada.end(id);
  await t.idle();
  return id;
}

describe("review extras", () => {
  it("produces ideal answers, STAR scores and speech metrics for a behavioural round", async () => {
    const id = await behavioral();
    const ideal = (await ada.call("GET", `/interviews/${id}/ideal-answers`)).json<{
      status: string;
      items: { starRewriteMd: string | null; addedSuggestions: string[] }[];
    }>();
    expect(ideal.status).toBe("ready");
    expect(ideal.items.length).toBeGreaterThan(0);
    expect(ideal.items[0]!.starRewriteMd).toMatch(/Situation/);

    const star = (await ada.call("GET", `/interviews/${id}/star`)).json<{
      items: { completeness: number; ownershipRatio: number | null }[];
    }>().items;
    expect(star.length).toBeGreaterThan(0);

    const speech = (await ada.call("GET", `/interviews/${id}/speech`)).json<{
      speech: { basis: string; words: number; note: string } | null;
    }>().speech;
    expect(speech?.basis).toBe("text");
    expect(speech!.words).toBeGreaterThan(10);
    expect(speech!.note).toMatch(/not a diagnosis/);
  });

  it("repairs a STAR rewrite that invents facts", async () => {
    t.mock.overrides.set("ideal", [
      JSON.stringify({
        answers: [
          {
            question_index: 0,
            user_answer_summary: "Cache story.",
            ideal_md: "Lead with the situation.",
            gaps: ["No baseline"],
            extras: [],
            star_rewrite_md: "Situation: I cut build time by 90% across 12 teams at Google.",
            added_suggestions: [],
          },
        ],
      }),
    ]);
    const id = await behavioral();
    const items = (await ada.call("GET", `/interviews/${id}/ideal-answers`)).json<{
      items: { starRewriteMd: string | null }[];
    }>().items;
    for (const i of items) expect(i.starRewriteMd ?? "").not.toMatch(/90%|Google|12 teams/);
  });

  it("keeps extras private to the owner and retries on request", async () => {
    const id = await behavioral();
    expect((await bob.call("GET", `/interviews/${id}/ideal-answers`)).statusCode).toBe(404);
    expect((await bob.call("GET", `/interviews/${id}/speech`)).statusCode).toBe(404);
    const res = await ada.call("POST", `/interviews/${id}/review/retry-extras`);
    expect(res.statusCode).toBe(202);
    await t.idle();
    const after = (await ada.call("GET", `/interviews/${id}/ideal-answers`)).json<{
      status: string;
    }>();
    expect(after.status).toBe("ready");
  });

  it("practise again starts a new interview on that question, with missed points as benchmark", async () => {
    const id = await behavioral();
    const res = await ada.call("POST", `/interviews/${id}/retry-question`, { questionIndex: 0 });
    expect(res.statusCode, res.body).toBe(201);
    const next = res.json<{ session: { id: string; type: string } }>().session;
    expect(next.type).toBe("behavioral");
    const { rows } = await t.pool.query("SELECT plan FROM interview_sessions WHERE id = $1", [
      next.id,
    ]);
    expect(rows[0].plan.questions).toHaveLength(1);
    expect(JSON.stringify(rows[0].plan.questions[0].rubricPoints)).toMatch(
      /Last time this was missed/,
    );
    expect(
      (await bob.call("POST", `/interviews/${id}/retry-question`, { questionIndex: 0 })).statusCode,
    ).toBe(404);
  });

  it("rejects practise-again while the interview is live or the index is unknown", async () => {
    const live = await ada.startNew({ type: "cs", minutes: 30 });
    expect(
      (await ada.call("POST", `/interviews/${live}/retry-question`, { questionIndex: 0 }))
        .statusCode,
    ).toBe(409);
    await ada.end(live);
    expect(
      (await ada.call("POST", `/interviews/${live}/retry-question`, { questionIndex: 9 }))
        .statusCode,
    ).toBe(422);
  });
});
