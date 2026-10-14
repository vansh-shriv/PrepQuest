import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import * as Y from "yjs";
import { seedBank, seedContent } from "../../test/content.js";
import { Interviews, resetClock, setClock } from "../../test/interviews.js";
import { makeTestApp, signupAndLogin, verifyAllEmails, type TestApp } from "../../test/helpers.js";
import { rtcConfig } from "../../lib/turn.js";

// Phase 19: the live room of a peer mock: ticket, shared editor relay, call signalling, suggestions.

let t: TestApp;
let ada: Interviews;
let bob: Interviews;
let cyd: Interviews;
let url: string;
const ids: Record<string, string> = {};
const sockets: Socket[] = [];

const MIN = 60_000;
const real = () => Date.now();
const at = (minutes: number) => new Date(real() + minutes * MIN).toISOString();

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses", "three-sum", "climbing-stairs"]);
  await seedBank(t);
  const make = async (email: string, handle: string) => {
    const login = await signupAndLogin(t, { email, handle });
    return { token: login.accessToken, id: (login.body as { user: { id: string } }).user.id };
  };
  const a = await make("ada@example.com", "ada_h");
  const b = await make("bob@example.com", "bob_h");
  const c = await make("cyd@example.com", "cyd_h");
  await verifyAllEmails(t);
  ada = new Interviews(t, a.token);
  bob = new Interviews(t, b.token);
  cyd = new Interviews(t, c.token);
  Object.assign(ids, { ada: a.id, bob: b.id, cyd: c.id });
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = t.app.server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await t.close();
});
afterEach(() => {
  sockets.splice(0).forEach((s) => s.close());
  resetClock(t);
});
beforeEach(async () => {
  (t.kv as unknown as { data: Map<string, unknown> }).data.clear();
  await t.pool.query("DELETE FROM peer_reports");
  await t.pool.query("DELETE FROM peer_feedback");
  await t.pool.query("UPDATE peer_invites SET session_id = NULL");
  await t.pool.query("DELETE FROM peer_sessions");
  await t.pool.query("DELETE FROM peer_invites");
  await t.pool.query("DELETE FROM peer_blocks");
  await t.pool.query("DELETE FROM peer_availability");
});

interface Session {
  id: string;
  scheduledAt: string;
  clock: { you: string } | null;
}

/** A booked 60 minute session between ada and bob, both inside the room, the clock just after the start. */
async function live(): Promise<Session> {
  const w = (from: number, to: number) => ({
    startsAt: at(from),
    endsAt: at(to),
    topics: ["dsa"],
    difficulty: 2,
    language: "python",
  });
  expect((await ada.call("POST", "/peer/availability", w(60, 240))).statusCode).toBe(201);
  expect((await bob.call("POST", "/peer/availability", w(90, 300))).statusCode).toBe(201);
  const s = (await ada.call("POST", "/peer/match", { minutes: 60 })).json<Session>();
  const start = new Date(s.scheduledAt).getTime();
  setClock(t, new Date(start - 5 * MIN));
  expect((await ada.call("POST", `/peer/sessions/${s.id}/open`)).statusCode).toBe(200);
  expect((await bob.call("POST", `/peer/sessions/${s.id}/open`)).statusCode).toBe(200);
  setClock(t, new Date(start + MIN));
  return s;
}
const startOf = (s: Session) => new Date(s.scheduledAt).getTime();

async function ticket(who: Interviews, id: string) {
  const res = await who.call("POST", `/peer/sessions/${id}/room-ticket`);
  return { res, ticket: res.statusCode === 200 ? res.json<{ wsTicket: string }>().wsTicket : "" };
}

/** What the room sends, as these tests read it. */
interface Payload {
  update: ArrayBuffer;
  partnerOnline: boolean;
  signal: unknown;
}

function connect(wsTicket: string) {
  const socket = io(`${url}/peer`, {
    path: "/ws",
    auth: { ticket: wsTicket },
    transports: ["websocket"],
    reconnection: false,
  });
  sockets.push(socket);
  const got: { type: string; payload: Payload }[] = [];
  socket.onAny((type: string, payload: Payload) => got.push({ type, payload }));
  return { socket, got };
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

/** Ada and bob connected and in sync. */
async function both(s: Session) {
  const a = connect((await ticket(ada, s.id)).ticket);
  await opened(a.socket);
  await until(() => a.got.some((e) => e.type === "doc.sync"));
  const b = connect((await ticket(bob, s.id)).ticket);
  await opened(b.socket);
  await until(() => b.got.some((e) => e.type === "doc.sync"));
  return { a, b };
}

/** A Yjs update that types `text` into the shared code. */
function typing(text: string, doc = new Y.Doc()) {
  let update: Uint8Array = new Uint8Array();
  doc.on("update", (u: Uint8Array) => (update = u));
  doc.getText("code").insert(0, text);
  return update;
}

describe("room access", () => {
  it("opens only while the session is running, and only for its two people", async () => {
    // booked but not started: no ticket
    const w = (from: number, to: number) => ({
      startsAt: at(from),
      endsAt: at(to),
      topics: ["dsa"],
      difficulty: 2,
      language: "python",
    });
    await ada.call("POST", "/peer/availability", w(60, 240));
    await bob.call("POST", "/peer/availability", w(90, 300));
    const s = (await ada.call("POST", "/peer/match", { minutes: 60 })).json<Session>();
    expect((await ticket(ada, s.id)).res.statusCode).toBe(409);
    expect((await ada.call("GET", `/peer/sessions/${s.id}/rtc-config`)).statusCode).toBe(409);

    setClock(t, new Date(startOf(s) - 5 * MIN));
    await ada.call("POST", `/peer/sessions/${s.id}/open`);
    expect((await ticket(ada, s.id)).res.statusCode).toBe(200);
    // somebody else cannot even tell the session exists
    expect((await ticket(cyd, s.id)).res.statusCode).toBe(404);
    // the partner has not opened the room yet: opening it is what records that they came
    const early = await ticket(bob, s.id);
    expect(early.res.statusCode).toBe(409);
    expect(early.res.json().error.message).toMatch(/Open the room first/);
  });

  it("gives a ticket that works once", async () => {
    const s = await live();
    const { ticket: tk } = await ticket(ada, s.id);
    const first = connect(tk);
    await opened(first.socket);
    const second = connect(tk);
    await expect(opened(second.socket)).rejects.toThrow("UNAUTHENTICATED");
    const none = connect("not-a-ticket");
    await expect(opened(none.socket)).rejects.toThrow("UNAUTHENTICATED");
  });

  it("refuses a socket for a session that is no longer running", async () => {
    const s = await live();
    const { ticket: tk } = await ticket(ada, s.id);
    await ada.call("POST", `/peer/sessions/${s.id}/complete`);
    await expect(opened(connect(tk).socket)).rejects.toThrow("CONFLICT");
  });
});

describe("shared editor", () => {
  it("relays an edit to the partner, and a later joiner gets everything", async () => {
    const s = await live();
    const { a, b } = await both(s);
    const doc = new Y.Doc();
    const res = await ack<{ ok: boolean }>(a.socket, "doc.update", {
      update: typing("def f(): pass", doc),
    });
    expect(res.ok).toBe(true);
    await until(() => b.got.some((e) => e.type === "doc.update"));
    const mirror = new Y.Doc();
    Y.applyUpdate(
      mirror,
      new Uint8Array(b.got.find((e) => e.type === "doc.update")!.payload.update),
    );
    expect(mirror.getText("code").toString()).toBe("def f(): pass");
    // the sender does not get its own edit back
    expect(a.got.filter((e) => e.type === "doc.update")).toHaveLength(0);

    // a reconnecting browser gets the whole document from the server
    b.socket.close();
    const again = connect((await ticket(bob, s.id)).ticket);
    await opened(again.socket);
    await until(() => again.got.some((e) => e.type === "doc.sync"));
    const full = new Y.Doc();
    Y.applyUpdate(
      full,
      new Uint8Array(again.got.find((e) => e.type === "doc.sync")!.payload.update),
    );
    expect(full.getText("code").toString()).toBe("def f(): pass");
  });

  it("tells the partner who is here, and when they leave", async () => {
    const s = await live();
    const a = connect((await ticket(ada, s.id)).ticket);
    await opened(a.socket);
    await until(() => a.got.some((e) => e.type === "room.hello"));
    expect(a.got.find((e) => e.type === "room.hello")!.payload.partnerOnline).toBe(false);
    const b = connect((await ticket(bob, s.id)).ticket);
    await opened(b.socket);
    await until(() => a.got.some((e) => e.type === "room.peer_joined"));
    await until(() => b.got.some((e) => e.type === "room.hello"));
    expect(b.got.find((e) => e.type === "room.hello")!.payload.partnerOnline).toBe(true);
    b.socket.close();
    await until(() => a.got.some((e) => e.type === "room.peer_left"));
  });

  it("refuses a huge update and garbage, and keeps working", async () => {
    const s = await live();
    const { a, b } = await both(s);
    const big = typing("x".repeat(60_000));
    expect(
      (await ack<{ ok: boolean; code: string }>(a.socket, "doc.update", { update: big })).ok,
    ).toBe(false);
    expect((await ack<{ ok: boolean }>(a.socket, "doc.update", { update: "text" })).ok).toBe(false);
    expect(
      (await ack<{ ok: boolean }>(a.socket, "doc.update", { update: Buffer.from([1, 2, 3, 4]) }))
        .ok,
    ).toBe(false);
    expect((await ack<{ ok: boolean }>(a.socket, "doc.update", undefined)).ok).toBe(false);
    expect(b.got.filter((e) => e.type === "doc.update")).toHaveLength(0);
    expect((await ack<{ ok: boolean }>(a.socket, "doc.update", { update: typing("ok") })).ok).toBe(
      true,
    );
  });

  it("saves the document and brings it back after the room was closed", async () => {
    const s = await live();
    const { a, b } = await both(s);
    await ack(a.socket, "doc.update", { update: typing("print(1)") });
    await t.app.peerRooms.saveAll();
    const [row] = (await t.pool.query("SELECT room_state FROM peer_sessions WHERE id = $1", [s.id]))
      .rows;
    expect(row.room_state).toBeTruthy();
    a.socket.close();
    b.socket.close();
    await until(() => t.app.peerRooms.activeIds().length === 0);

    const again = connect((await ticket(bob, s.id)).ticket);
    await opened(again.socket);
    await until(() => again.got.some((e) => e.type === "doc.sync"));
    const doc = new Y.Doc();
    Y.applyUpdate(
      doc,
      new Uint8Array(again.got.find((e) => e.type === "doc.sync")!.payload.update),
    );
    expect(doc.getText("code").toString()).toBe("print(1)");
  });
});

describe("call signalling", () => {
  it("passes offers, answers and candidates to the partner only", async () => {
    const s = await live();
    const { a, b } = await both(s);
    expect(
      (await ack<{ ok: boolean }>(a.socket, "rtc.signal", { kind: "offer", sdp: "v=0 offer" })).ok,
    ).toBe(true);
    await until(() => b.got.some((e) => e.type === "rtc.signal"));
    expect(b.got.find((e) => e.type === "rtc.signal")!.payload.signal).toEqual({
      kind: "offer",
      sdp: "v=0 offer",
    });
    expect(a.got.filter((e) => e.type === "rtc.signal")).toHaveLength(0);
    expect(
      (
        await ack<{ ok: boolean }>(b.socket, "rtc.signal", {
          kind: "candidate",
          candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 },
        })
      ).ok,
    ).toBe(true);
    expect((await ack<{ ok: boolean }>(b.socket, "rtc.signal", { kind: "hangup" })).ok).toBe(true);
  });

  it("refuses a signal that is not one", async () => {
    const s = await live();
    const { a } = await both(s);
    for (const bad of [
      { kind: "offer" },
      { kind: "offer", sdp: "x".repeat(20_000) },
      { kind: "nope" },
      "hi",
      null,
    ]) {
      const r = await ack<{ ok: boolean; code: string }>(a.socket, "rtc.signal", bad);
      expect(r).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    }
  });
});

describe("ending", () => {
  it("tells everyone in the room when the session is over and closes the sockets", async () => {
    const s = await live();
    const { a, b } = await both(s);
    expect((await ada.call("POST", `/peer/sessions/${s.id}/complete`)).statusCode).toBe(200);
    await until(
      () =>
        a.got.some((e) => e.type === "room.ended") && b.got.some((e) => e.type === "room.ended"),
      9000,
    );
    await until(() => !a.socket.connected && !b.socket.connected);
    expect(t.app.peerRooms.activeIds()).toEqual([]);
  }, 15_000);
});

describe("ice servers", () => {
  const base = {
    PEER_STUN_URLS: "stun:one.example:3478",
    PEER_TURN_URLS: "",
    PEER_TURN_SECRET: "",
  };
  it("gives only STUN when no TURN server is set", async () => {
    const s = await live();
    const res = await ada.call("GET", `/peer/sessions/${s.id}/rtc-config`);
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      iceServers: { urls: string[]; credential?: string }[];
      expiresAt: string | null;
    }>();
    expect(body.iceServers[0]!.urls.length).toBeGreaterThan(0);
    expect(body.iceServers.some((i) => i.credential)).toBe(false);
    expect(body.expiresAt).toBeNull();
  });
  it("signs short-lived TURN credentials per person", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const env = {
      ...base,
      PEER_TURN_URLS: "turn:t.example:3478, turns:t.example:5349",
      PEER_TURN_SECRET: "s3cret",
    };
    const a = rtcConfig(env, "user-a", now);
    const b = rtcConfig(env, "user-b", now);
    const turn = a.iceServers[1]!;
    expect(turn.urls).toEqual(["turn:t.example:3478", "turns:t.example:5349"]);
    expect(turn.username).toBe(`${Math.floor(now.getTime() / 1000) + 3600}:user-a`);
    expect(turn.credential).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(b.iceServers[1]!.credential).not.toBe(turn.credential);
    expect(a.expiresAt).toBe("2026-01-01T01:00:00.000Z");
    // an unset secret never produces credentials
    expect(rtcConfig({ ...env, PEER_TURN_SECRET: "" }, "user-a", now).iceServers).toHaveLength(1);
  });
});

describe("interviewer suggestions", () => {
  const interviewerOf = async (s: Session) => {
    const mine = (await ada.call("GET", `/peer/sessions/${s.id}`)).json<Session>();
    return mine.clock!.you === "interviewer" ? ada : bob;
  };
  const candidateOf = async (s: Session) => ((await interviewerOf(s)) === ada ? bob : ada);

  it("gives the interviewer follow-ups and nobody else", async () => {
    const s = await live();
    const asker = await interviewerOf(s);
    const res = await asker.call("POST", `/peer/sessions/${s.id}/suggestions`);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: { text: string; why: string }[]; remaining: number }>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(4);
    expect(body.remaining).toBe(11);
    expect(
      (await (await candidateOf(s)).call("POST", `/peer/sessions/${s.id}/suggestions`)).statusCode,
    ).toBe(403);
    expect((await cyd.call("POST", `/peer/sessions/${s.id}/suggestions`)).statusCode).toBe(404);
  });

  it("builds on the code in the shared editor and never repeats itself", async () => {
    const s = await live();
    const { a } = await both(s);
    const asker = await interviewerOf(s);
    const first = (await asker.call("POST", `/peer/sessions/${s.id}/suggestions`)).json<{
      items: { text: string }[];
    }>();
    expect(first.items[0]!.text).toMatch(/approach|edge|inputs/i);
    await ack(a.socket, "doc.update", {
      update: typing("def solve(xs):\n    return sorted(xs)\n"),
    });
    setClock(t, new Date(startOf(s) + MIN + 25_000));
    const second = (await asker.call("POST", `/peer/sessions/${s.id}/suggestions`)).json<{
      items: { text: string }[];
    }>();
    expect(second.items.length).toBeGreaterThan(0);
    const firstTexts = new Set(first.items.map((i) => i.text));
    expect(second.items.some((i) => firstTexts.has(i.text))).toBe(false);
  });

  it("makes the interviewer wait between requests and stops at twelve", async () => {
    const s = await live();
    const asker = await interviewerOf(s);
    expect((await asker.call("POST", `/peer/sessions/${s.id}/suggestions`)).statusCode).toBe(200);
    const soon = await asker.call("POST", `/peer/sessions/${s.id}/suggestions`);
    expect(soon.statusCode).toBe(429);
    await t.pool.query(
      "UPDATE peer_sessions SET suggest_count = 12, suggest_at = NULL WHERE id = $1",
      [s.id],
    );
    const capped = await asker.call("POST", `/peer/sessions/${s.id}/suggestions`);
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error.message).toMatch(/all the suggestions/);
  });

  it("gives the slot back when the model fails", async () => {
    const s = await live();
    const asker = await interviewerOf(s);
    // three replies that are not JSON: the repair loop gives up
    t.mock.overrides.set("peer_suggest", ["no", "no", "no", "no"]);
    const res = await asker.call("POST", `/peer/sessions/${s.id}/suggestions`);
    expect(res.statusCode).toBe(503);
    const [row] = (
      await t.pool.query("SELECT suggest_count FROM peer_sessions WHERE id = $1", [s.id])
    ).rows;
    expect(row.suggest_count).toBe(0);
    t.mock.overrides.delete("peer_suggest");
  });
});
