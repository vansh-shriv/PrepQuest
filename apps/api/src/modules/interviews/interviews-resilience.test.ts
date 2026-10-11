import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedContent } from "../../test/content.js";
import { Interviews } from "../../test/interviews.js";
import { makeTestApp, signupAndLogin, verifyAllEmails, type TestApp } from "../../test/helpers.js";
import {
  MockProvider,
  TransientLlmError,
  type LlmRequest,
  type LlmResult,
} from "../../lib/llm/index.js";

/** The scripted model with switches for failures and refusals. */
class FlakyProvider extends MockProvider {
  failures = 0;
  refuseNext = 0;
  readonly models: string[] = [];

  override async generate(
    req: LlmRequest,
    model: string,
    opts: Parameters<MockProvider["generate"]>[2],
  ): Promise<LlmResult> {
    this.models.push(model);
    if (this.failures > 0) {
      this.failures--;
      throw new TransientLlmError("upstream 503");
    }
    const res = await super.generate(req, model, opts);
    if (this.refuseNext > 0) {
      this.refuseNext--;
      return { ...res, text: "", refused: true };
    }
    return res;
  }
}

const provider = new FlakyProvider();
let t: TestApp;
let ada: Interviews;

beforeAll(async () => {
  t = await makeTestApp({
    llmProvider: provider,
    env: {
      RL_INTERVIEWS_PER_HOUR: "2",
      RL_INTERVIEWS_PER_DAY: "50",
      LLM_DAILY_TOKEN_BUDGET_PER_USER: "400000",
    },
  });
  await seedContent(t, ["two-sum", "valid-parentheses"]);
  const token = (await signupAndLogin(t)).accessToken;
  await verifyAllEmails(t);
  ada = new Interviews(t, token);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.pool.query("DELETE FROM interview_sessions");
  await t.pool.query("DELETE FROM llm_usage");
  await t.kv.del(
    "rl:interview:h:" + (await t.pool.query("SELECT id FROM users LIMIT 1")).rows[0].id,
  );
  provider.failures = 0;
  provider.refuseNext = 0;
  provider.models.length = 0;
  provider.overrides.clear();
});

describe("model outages", () => {
  it("retries the same model, then the fallback model", async () => {
    const id = await ada.startNew({ minutes: 30 });
    provider.models.length = 0;
    provider.failures = 2; // primary twice
    const r = await ada.say(id, "Hello there");
    expect(r.res.statusCode, r.res.body).toBe(200);
    expect(provider.models.slice(0, 3)).toEqual([
      "claude-sonnet-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
    const { rows } = await t.pool.query(
      "SELECT ok, model FROM llm_usage WHERE session_id = $1 AND task = 'interviewer_turn' ORDER BY id",
      [id],
    );
    expect(rows.filter((x) => !x.ok)).toHaveLength(2);
    expect(rows.some((x) => x.ok && x.model === "claude-haiku-5-5")).toBe(true);
  });

  it("falls back when the model declines", async () => {
    const id = await ada.startNew({ minutes: 30 });
    provider.refuseNext = 1;
    provider.models.length = 0;
    const r = await ada.say(id, "Hello there");
    expect(r.res.statusCode).toBe(200);
    expect(r.body.replies[0]?.text.length).toBeGreaterThan(5);
    expect(provider.models).toContain("claude-haiku-5-5");
  });

  it("answers 503 when every model is down, keeps the message, and answers the retry once", async () => {
    const id = await ada.startNew({ minutes: 30 });
    provider.failures = 99;
    const down = await ada.say(id, "Hello, I'm Ada.", "msg-1");
    expect(down.res.statusCode).toBe(503);
    expect(down.res.json<{ error: { code: string } }>().error.code).toBe("UPSTREAM_AI_UNAVAILABLE");
    // the interviewer still has its greeting only; the candidate turn is stored
    let turns = (await ada.get(id)).turns;
    expect(turns.filter((x) => x.speaker === "candidate")).toHaveLength(1);
    expect(turns.at(-1)?.speaker).toBe("candidate");

    provider.failures = 0;
    const retry = await ada.say(id, "Hello, I'm Ada.", "msg-1");
    expect(retry.res.statusCode, retry.res.body).toBe(200);
    expect(retry.body.replay).toBe(true);
    expect(retry.body.replies.length).toBeGreaterThan(0);
    turns = (await ada.get(id)).turns;
    expect(turns.filter((x) => x.speaker === "candidate")).toHaveLength(1);
    // a further retry does not call the model again
    const calls = provider.models.length;
    const again = await ada.say(id, "Hello, I'm Ada.", "msg-1");
    expect(again.body.replies.length).toBeGreaterThan(0);
    expect(provider.models.length).toBe(calls);
  });

  it("the timer keeps running and the session still ends during an outage", async () => {
    const id = await ada.startNew({ minutes: 20 });
    provider.failures = 99;
    await ada.say(id, "Hello", "m");
    t.app.ai.now = () => new Date(Date.now() + 21 * 60_000);
    await t.app.interviews.sweep();
    await t.idle();
    t.app.ai.now = () => new Date();
    expect((await ada.get(id)).session.endReason).toBe("timer");
  });
});

describe("limits", () => {
  it("limits how many interviews can be created per hour", async () => {
    expect((await ada.create()).res.statusCode).toBe(201);
    expect((await ada.create()).res.statusCode).toBe(201);
    const third = await ada.create();
    expect(third.res.statusCode).toBe(429);
    expect(third.res.headers["retry-after"]).toBeDefined();
  });

  it("stops at the session token cap", async () => {
    const capped = await makeTestApp({
      llmProvider: new FlakyProvider(),
      env: { LLM_SESSION_TOKEN_CAP: "200" },
    });
    try {
      await seedContent(capped, ["two-sum"]);
      const tok = (await signupAndLogin(capped)).accessToken;
      await verifyAllEmails(capped);
      const client = new Interviews(capped, tok);
      const id = await client.startNew({ minutes: 30 });
      const r = await client.say(id, "Hello");
      expect(r.res.statusCode).toBe(429);
      expect(r.res.json<{ error: { code: string } }>().error.code).toBe("QUOTA_EXCEEDED");
    } finally {
      await capped.close();
    }
  });
});
