import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedContent } from "../../test/content.js";
import { Interviews, resetClock, setClock } from "../../test/interviews.js";
import { makeTestApp, signupAndLogin, verifyAllEmails, type TestApp } from "../../test/helpers.js";

let t: TestApp;
let ada: Interviews;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses"]);
  const token = (await signupAndLogin(t)).accessToken;
  await verifyAllEmails(t);
  ada = new Interviews(t, token);
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

const base = new Date("2031-03-01T10:00:00Z");
const at = (sec: number) => new Date(base.getTime() + sec * 1000);
const STARTER = "class Solution:\n    def twoSum(self, nums, target):\n        pass\n";
const NESTED =
  "class Solution:\n    def twoSum(self, nums, target):\n        for i in range(len(nums)):\n            for j in range(i + 1, len(nums)):\n                if nums[i] + nums[j] == target:\n                    return [i, j]\n";

const snapshot = (id: string, code: string) =>
  ada.call("POST", `/interviews/${id}/events`, { kind: "snapshot", language: "python", code });

async function toCoding(body: Record<string, unknown> = {}) {
  setClock(t, base);
  const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 45, ...body });
  await ada.say(id, "Hi, I'm Ada.");
  await ada.say(id, "I would use a hash map for complements.");
  expect((await ada.say(id, "I will scan once and store each value.")).body.state).toBe("CODING");
  await snapshot(id, STARTER); // the starter code is the baseline
  return id;
}

async function submission(id: string, verdict: string, kind: "run" | "submit" = "submit") {
  const { rows } = await t.pool.query(
    `INSERT INTO submissions (id, user_id, problem_id, problem_version, language, code, code_hash, kind, mode, interview_session_id, verdict, passed, total)
     SELECT gen_random_uuid(), u.id, p.id, 1, 'python', 'class Solution: pass', 'h', $2, 'interview', $1, $3, 2, 10
     FROM users u, problems p WHERE u.email = 'ada@example.com' AND p.slug = 'two-sum' RETURNING id`,
    [id, kind, verdict],
  );
  return rows[0].id as string;
}

const proactive = async (id: string) => {
  const { rows } = await t.pool.query(
    "SELECT text, meta FROM interview_turns WHERE session_id = $1 AND meta->>'proactive' IS NOT NULL ORDER BY seq",
    [id],
  );
  return rows as { text: string; meta: { proactive: string } }[];
};

const sweepAt = async (sec: number) => {
  setClock(t, at(sec));
  await t.app.interviews.sweep();
  await t.idle();
};

describe("proactive reactions while coding", () => {
  it("asks about complexity after nested loops appear, once, and not while typing", async () => {
    const id = await toCoding();
    await snapshot(id, NESTED);
    // 3 seconds after the last edit: still typing, and the smell is only due after 15 seconds
    await sweepAt(3);
    expect(await proactive(id)).toHaveLength(0);
    await sweepAt(10);
    expect(await proactive(id)).toHaveLength(0);
    await sweepAt(20);
    const [r] = await proactive(id);
    expect(r?.meta.proactive).toBe("complexity_smell");
    expect(r?.text).toMatch(/time complexity/i);
    // the interviewer asked, it did not state the answer
    expect(r?.text).not.toMatch(/O\(n\^?2\)|quadratic/i);
    await sweepAt(200);
    expect(await proactive(id)).toHaveLength(1); // once per question
    expect(t.mock.calls.some((c) => c.task === "reaction")).toBe(true);
  });

  it("waits while the candidate keeps typing", async () => {
    const id = await toCoding();
    await snapshot(id, NESTED);
    setClock(t, at(40));
    await snapshot(id, `${NESTED}        # still editing\n`); // a change at 40 s
    await sweepAt(42); // due, but they typed two seconds ago
    expect(await proactive(id)).toHaveLength(0);
    await sweepAt(48);
    expect(await proactive(id)).toHaveLength(1);
  });

  it("asks what a failed run tells them, after a pause, without saying what is wrong", async () => {
    const id = await toCoding();
    setClock(t, at(30));
    const sub = await submission(id, "WA", "run");
    const ev = await ada.call("POST", `/interviews/${id}/events`, {
      kind: "run",
      submissionId: sub,
    });
    expect(ev.statusCode, ev.body).toBe(200);
    await sweepAt(35); // too soon
    expect(await proactive(id)).toHaveLength(0);
    await sweepAt(60);
    const [r] = await proactive(id);
    expect(r).toMatchObject({ meta: { proactive: "run_failed" } });
    expect(r?.text).toMatch(/failing case/i);
  });

  it("an accepted solution gets an immediate reaction and starts the cooldown", async () => {
    const id = await toCoding();
    setClock(t, at(100));
    const sub = await submission(id, "AC");
    await ada.call("POST", `/interviews/${id}/events`, { kind: "submit", submissionId: sub });
    expect((await proactive(id)).map((x) => x.meta.proactive)).toEqual(["ac_reached"]);
  });

  it("keeps a minute between proactive messages", async () => {
    const id = await toCoding();
    await snapshot(id, NESTED);
    await sweepAt(20);
    expect(await proactive(id)).toHaveLength(1); // complexity smell at ~20 s
    setClock(t, at(25));
    const sub = await submission(id, "WA", "run");
    await ada.call("POST", `/interviews/${id}/events`, { kind: "run", submissionId: sub });
    await sweepAt(50); // run_failed is due (45 s) but the last message was 30 s ago
    expect(await proactive(id)).toHaveLength(1);
    await sweepAt(85); // 65 s after the first
    expect((await proactive(id)).map((x) => x.meta.proactive)).toEqual([
      "complexity_smell",
      "run_failed",
    ]);
  });

  it("notices code written before any approach was described", async () => {
    setClock(t, base);
    const id = await ada.startNew({ problemSlugs: ["two-sum"], minutes: 45 });
    await ada.say(id, "Hi, I'm Ada.");
    await snapshot(id, STARTER);
    await snapshot(id, NESTED);
    await sweepAt(10);
    const [r] = await proactive(id);
    expect(r?.meta.proactive).toBe("no_approach_before_code");
    expect(r?.text).toMatch(/plan/i);
  });

  it("does nothing when the candidate turned interruptions off", async () => {
    const id = await toCoding({ interruptionLevel: "off" });
    await snapshot(id, NESTED);
    await sweepAt(40);
    expect(await proactive(id)).toHaveLength(0);
  });

  it("a nudge after a long silence is a question, not a hint", async () => {
    const id = await toCoding({ persona: "friendly" });
    const before = (await ada.get(id)).session;
    await sweepAt(3 * 60 + 30);
    const [r] = await proactive(id);
    expect(r?.meta.proactive).toBe("idle_coding");
    const after = (await ada.get(id)).session;
    expect(after.hintsGiven).toBe(before.hintsGiven);
    expect(after.hintsLeft).toBe(before.hintsLeft);
    // a strict interviewer waits longer
    await sweepAt(3 * 60 + 40);
    expect(await proactive(id)).toHaveLength(1);
  });

  it("stays silent when the classifier says so, and does not ask again", async () => {
    const id = await toCoding();
    await snapshot(id, NESTED);
    t.mock.overrides.set("reaction", ['{"speak": false, "reason": "candidate is thinking"}']);
    await sweepAt(20);
    expect(await proactive(id)).toHaveLength(0);
    await sweepAt(120);
    expect(await proactive(id)).toHaveLength(0);
  });

  it("speaks anyway if the classifier fails, since the rules already gated it", async () => {
    const id = await toCoding();
    await snapshot(id, NESTED);
    t.mock.overrides.set("reaction", ["garbage"]);
    await sweepAt(20);
    expect(await proactive(id)).toHaveLength(1);
  });

  it("drops a pending reaction when the candidate speaks first", async () => {
    const id = await toCoding();
    await snapshot(id, NESTED);
    setClock(t, at(5));
    await ada.say(id, "Let me think about whether this is efficient.");
    await sweepAt(60);
    expect(await proactive(id)).toHaveLength(0);
  });

  it("every proactive reply is recorded in the transcript with its trigger", async () => {
    const id = await toCoding();
    await snapshot(id, NESTED);
    await sweepAt(20);
    const turns = (await ada.get(id)).turns;
    expect(turns.at(-1)?.speaker).toBe("interviewer");
    const { rows } = await t.pool.query(
      "SELECT meta FROM interview_turns WHERE session_id = $1 ORDER BY seq DESC LIMIT 1",
      [id],
    );
    expect(rows[0].meta).toMatchObject({ proactive: "complexity_smell", event: "timer" });
  });
});
