import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedContent } from "../../test/content.js";
import { Interviews } from "../../test/interviews.js";
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

beforeAll(async () => {
  t = await makeTestApp({ env: { FF_VOICE: "true" } });
  await seedContent(t, ["two-sum"]);
  ada = new Interviews(t, (await signupAndLogin(t)).accessToken);
  bob = new Interviews(
    t,
    (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken,
  );
  await verifyAllEmails(t);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.pool.query("DELETE FROM interview_sessions");
  t.mock.overrides.clear();
  t.mock.calls.length = 0;
});

const send = (id: string, body: Record<string, unknown>) =>
  ada.call("POST", `/interviews/${id}/messages`, body);

describe("voice interviews", () => {
  it("advertises the voice feature and stores the session mode", async () => {
    const res = await ada.call("GET", "/interview/templates");
    expect(res.json<{ features: { voice: boolean } }>().features.voice).toBe(true);
    const { res: created, body } = await ada.create({
      mode: "voice",
      minutes: 30,
      problemSlugs: ["two-sum"],
    });
    expect(created.statusCode).toBe(201);
    const { rows } = await t.pool.query("SELECT mode FROM interview_sessions WHERE id = $1", [
      body.session.id,
    ]);
    expect(rows[0].mode).toBe("voice");
    expect((await ada.create({ mode: "telepathy" })).res.statusCode).toBe(422);
  });

  it("stores spoken answers with their modality and cleaned word timestamps", async () => {
    const id = await ada.startNew({ mode: "voice", minutes: 30, problemSlugs: ["two-sum"] });
    const res = await send(id, {
      clientMsgId: "v1",
      text: "Hello I am Ada",
      modality: "voice",
      words: [
        { w: "Hello", startMs: 100, endMs: 400 },
        { w: "bogus", startMs: 900, endMs: 100 },
        { w: "I", startMs: 450, endMs: 520 },
        { w: "am", startMs: 530, endMs: 640 },
        { w: "Ada", startMs: 650, endMs: 900 },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const { rows } = await t.pool.query(
      "SELECT modality, words FROM interview_turns WHERE session_id = $1 AND speaker = 'candidate'",
      [id],
    );
    expect(rows[0].modality).toBe("voice");
    expect((rows[0].words as { w: string }[]).map((x) => x.w)).toEqual(["Hello", "I", "am", "Ada"]);
    // a typed message in a mixed session keeps its own modality
    await send(id, { clientMsgId: "v2", text: "Typed this one" });
    const turns = (await ada.get(id)).turns as { speaker: string; modality?: string }[];
    expect(turns.filter((x) => x.speaker === "candidate").map((x) => x.modality)).toEqual([
      "voice",
      "text",
    ]);
  });

  it("tells the interviewer to speak in plain sentences only for voice sessions", async () => {
    const voice = await ada.startNew({ mode: "voice", minutes: 30, problemSlugs: ["two-sum"] });
    expect(t.mock.calls.at(-1)!.system).toMatch(/VOICE MODE/);
    await ada.end(voice);
    t.mock.calls.length = 0;
    const text = await ada.startNew({ mode: "text", minutes: 30, problemSlugs: ["two-sum"] });
    expect(t.mock.calls.at(-1)!.system).not.toMatch(/VOICE MODE/);
    await ada.end(text);
  });

  it("marks an interrupted reply with what was heard, and the interviewer knows next turn", async () => {
    const id = await ada.startNew({ mode: "voice", minutes: 30, problemSlugs: ["two-sum"] });
    const r = await ada.say(id, "Hi, I'm Ada.");
    const reply = r.body.replies[1]!; // the problem statement
    const turnsBefore = (await ada.get(id)).turns;
    const res = await ada.call("POST", `/interviews/${id}/barge-in`, {
      turnId: reply.turnId,
      charIndex: 20,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { rows } = await t.pool.query("SELECT text, meta FROM interview_turns WHERE id = $1", [
      reply.turnId,
    ]);
    expect(rows[0].meta.interrupted).toBe(true);
    expect(rows[0].text).toBe(reply.text); // the transcript keeps the full reply
    expect(reply.text.startsWith(rows[0].meta.heard)).toBe(true);
    expect(rows[0].meta.heard.length).toBeLessThanOrEqual(20);
    expect((await ada.get(id)).turns).toHaveLength(turnsBefore.length);
    expect(turnsBefore.find((x) => x.seq === reply.seq)).toBeDefined();

    t.mock.calls.length = 0;
    await ada.say(id, "Sorry, can the array be empty?", "m2");
    const history = t.mock.calls
      .filter((c) => c.task === "interviewer_turn")
      .at(-1)!
      .messages.map((m) => m.content)
      .join("\n");
    expect(history).toContain("[interrupted: the candidate heard only this part]");
    expect(history).not.toContain(reply.text);
    // idempotent, and logged for the replay
    expect(
      (
        await ada.call("POST", `/interviews/${id}/barge-in`, {
          turnId: reply.turnId,
          charIndex: 20,
        })
      ).statusCode,
    ).toBe(200);
    const events = await t.pool.query(
      "SELECT kind FROM interview_events WHERE session_id = $1 AND kind = 'barge_in'",
      [id],
    );
    expect(events.rowCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects a barge-in on something that is not an interviewer message of this interview", async () => {
    const id = await ada.startNew({ mode: "voice", minutes: 30, problemSlugs: ["two-sum"] });
    const r = await ada.say(id, "Hello");
    const candidate = (await ada.get(id)).turns.find((x) => x.speaker === "candidate") as
      { seq: number } | undefined;
    const { rows } = await t.pool.query(
      "SELECT id FROM interview_turns WHERE session_id = $1 AND seq = $2",
      [id, candidate!.seq],
    );
    expect(
      (await ada.call("POST", `/interviews/${id}/barge-in`, { turnId: rows[0].id, charIndex: 1 }))
        .statusCode,
    ).toBe(404);
    expect(
      (await ada.call("POST", `/interviews/${id}/barge-in`, { turnId: "not-a-uuid", charIndex: 1 }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await bob.call("POST", `/interviews/${id}/barge-in`, {
          turnId: r.body.replies[0]!.turnId,
          charIndex: 1,
        })
      ).statusCode,
    ).toBe(404);
    void bearer;
  });
});
