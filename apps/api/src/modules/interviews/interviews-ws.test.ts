import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { seedContent } from "../../test/content.js";
import { Interviews } from "../../test/interviews.js";
import { makeTestApp, signupAndLogin, verifyAllEmails, type TestApp } from "../../test/helpers.js";

let t: TestApp;
let ada: Interviews;
let bob: Interviews;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses"]);
  const a = (await signupAndLogin(t)).accessToken;
  const b = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
  ada = new Interviews(t, a);
  bob = new Interviews(t, b);
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = t.app.server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await t.close();
});
beforeEach(async () => {
  await t.pool.query("DELETE FROM interview_sessions");
});

function connect(ticket: string) {
  const socket = io(`${url}/interview`, {
    path: "/ws",
    auth: { ticket },
    transports: ["websocket"],
    reconnection: false,
  });
  sockets.push(socket);
  const received: { type: string; payload: Record<string, unknown> }[] = [];
  socket.onAny((type: string, payload: Record<string, unknown>) =>
    received.push({ type, payload }),
  );
  return { socket, received };
}

const opened = (s: Socket) =>
  new Promise<void>((resolve, reject) => {
    s.once("connect", () => resolve());
    s.once("connect_error", (e) => reject(e));
  });

const ack = <T = Record<string, unknown>>(s: Socket, event: string, payload?: unknown) =>
  new Promise<T>((resolve) => s.emit(event, payload, (res: T) => resolve(res)));

async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for a socket event");
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe("interview socket", () => {
  it("streams the interviewer's reply token by token, then the final message", async () => {
    const { body } = await ada.create({ minutes: 30, problemSlugs: ["two-sum"] });
    const id = body.session.id;
    const { socket, received } = connect(body.wsTicket);
    await opened(socket);
    await until(() => received.some((e) => e.type === "session.state"));
    await ada.call("POST", `/interviews/${id}/start`);
    await until(() => received.some((e) => e.type === "interviewer.message"));
    await t.idle();

    received.length = 0;
    const res = await ack<{ ok: boolean; replies: { text: string }[] }>(socket, "user.message", {
      clientMsgId: "w1",
      text: "Hi, I'm Ada.",
    });
    expect(res.ok).toBe(true);
    expect(res.replies.length).toBe(2);
    const types = received.map((e) => e.type);
    expect(types).toContain("candidate.message");
    expect(types.filter((x) => x === "interviewer.token").length).toBeGreaterThan(3);
    expect(types.filter((x) => x === "interviewer.message")).toHaveLength(2);
    // tokens arrive before the final message of the same turn
    const msg = received.find((e) => e.type === "interviewer.message")!;
    const firstToken = received.findIndex(
      (e) => e.type === "interviewer.token" && e.payload.turnId === msg.payload.turnId,
    );
    expect(firstToken).toBeGreaterThanOrEqual(0);
    expect(firstToken).toBeLessThan(received.indexOf(msg));
    expect(received.every((e) => e.payload.sessionId === id)).toBe(true);
    const streamed = received
      .filter((e) => e.type === "interviewer.token" && e.payload.turnId === msg.payload.turnId)
      .map((e) => e.payload.delta)
      .join("");
    expect(streamed).toBe(msg.payload.text);
    expect(streamed).not.toContain("<control>");
    expect(types).toContain("session.state");
  });

  it("a ticket works once and only for its own session", async () => {
    const { body } = await ada.create({ minutes: 30 });
    const first = connect(body.wsTicket);
    await opened(first.socket);
    const second = connect(body.wsTicket);
    await expect(opened(second.socket)).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(opened(connect("not-a-ticket").socket)).rejects.toThrow();
    // a ticket cannot be minted for someone else's session
    expect((await bob.call("POST", `/interviews/${body.session.id}/ws-ticket`)).statusCode).toBe(
      404,
    );
  });

  it("a connection only sees and drives its own session", async () => {
    const mine = (await ada.create({ minutes: 30 })).body;
    const c = connect(mine.wsTicket);
    await opened(c.socket);
    await ada.call("POST", `/interviews/${mine.session.id}/start`);
    await t.idle();
    const other = (await bob.create({ minutes: 30 })).body;
    await bob.call("POST", `/interviews/${other.session.id}/start`);
    await t.idle();
    // bob's session activity never reaches ada's socket
    await until(() => c.received.some((e) => e.type === "interviewer.message"));
    expect(c.received.every((e) => e.payload.sessionId === mine.session.id)).toBe(true);
  });

  it("reconnects with a fresh ticket and syncs only the missed turns", async () => {
    const { body } = await ada.create({ minutes: 30 });
    const id = body.session.id;
    const c1 = connect(body.wsTicket);
    await opened(c1.socket);
    await ada.call("POST", `/interviews/${id}/start`);
    await t.idle();
    await ack(c1.socket, "user.message", { clientMsgId: "a", text: "Hello there" });
    const seen = (await ada.get(id)).turns.at(-1)!.seq;
    c1.socket.close();

    // while disconnected the conversation goes on over REST
    await ada.say(id, "I'm back, over REST.");
    const ticket = (await ada.call("POST", `/interviews/${id}/ws-ticket`)).json<{
      wsTicket: string;
    }>().wsTicket;
    const c2 = connect(ticket);
    await opened(c2.socket);
    const sync = await ack<{
      ok: boolean;
      turns: { seq: number }[];
      session: { remainingMs: number };
    }>(c2.socket, "sync", { lastSeq: seen });
    expect(sync.ok).toBe(true);
    expect(sync.turns.length).toBeGreaterThan(0);
    expect(sync.turns.every((x) => x.seq > seen)).toBe(true);
    // the clock was not reset by reconnecting
    expect(sync.session.remainingMs).toBeLessThanOrEqual(30 * 60_000);
  });

  it("answers invalid input and controls with an error ack", async () => {
    const { body } = await ada.create({ minutes: 30, realistic: true });
    const c = connect(body.wsTicket);
    await opened(c.socket);
    const early = await ack<{ ok: boolean; code: string }>(c.socket, "user.message", {
      clientMsgId: "x",
      text: "hi",
    });
    expect(early).toMatchObject({ ok: false, code: "INTERVIEW_NOT_ACTIVE" });
    await ada.call("POST", `/interviews/${body.session.id}/start`);
    await t.idle();
    const bad = await ack<{ ok: boolean; code: string }>(c.socket, "user.message", {
      clientMsgId: "",
      text: "",
    });
    expect(bad.ok).toBe(false);
    const pause = await ack<{ ok: boolean; code: string }>(c.socket, "session.pause");
    expect(pause).toMatchObject({ ok: false, code: "CONFLICT" }); // realistic mode
  });

  it("ends the session from the socket and announces it", async () => {
    const { body } = await ada.create({ minutes: 30 });
    const c = connect(body.wsTicket);
    await opened(c.socket);
    await ada.call("POST", `/interviews/${body.session.id}/start`);
    await t.idle();
    await ack(c.socket, "user.message", { clientMsgId: "q", text: "Hello" });
    const res = await ack<{ ok: boolean }>(c.socket, "session.end");
    expect(res.ok).toBe(true);
    await until(() => c.received.some((e) => e.type === "session.ended"));
    await t.idle();
    await until(() => c.received.some((e) => e.type === "scorecard.ready"));
  });
});
