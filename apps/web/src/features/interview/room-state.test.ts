import { describe, expect, it } from "vitest";
import type { InterviewSessionDto, InterviewTurnDto } from "@prepquest/shared";
import {
  initialRoom,
  remainingNow,
  roomReducer,
  type RoomAction,
  type RoomState,
} from "./room-state";

const run = (actions: RoomAction[], from: RoomState = initialRoom) =>
  actions.reduce(roomReducer, from);

const turn = (
  seq: number,
  speaker: "interviewer" | "candidate",
  text: string,
): InterviewTurnDto => ({
  seq,
  speaker,
  text,
  offsetMs: seq * 1000,
  turnId: `t${seq}`,
  hintUsed: false,
  modality: "text",
  interrupted: false,
});

const session = {
  state: "CLARIFY",
  remainingMs: 600_000,
  hintsLeft: 2,
  paused: false,
  questionIndex: 0,
  questions: [{}],
  endedAt: null,
  endReason: null,
} as unknown as InterviewSessionDto;

describe("room reducer", () => {
  it("loads stored turns in order", () => {
    const s = run([
      {
        type: "load",
        turns: [turn(1, "interviewer", "Hi"), turn(2, "candidate", "Hello")],
        session,
        now: 0,
      },
    ]);
    expect(s.items.map((i) => i.text)).toEqual(["Hi", "Hello"]);
    expect(s.lastSeq).toBe(2);
    expect(s.live?.remainingMs).toBe(600_000);
  });

  it("a reload keeps a reply that is still streaming and drops one that is now stored", () => {
    const streaming = run([{ type: "token", turnId: "live", delta: "Hi, I'm" }]);
    const reloaded = roomReducer(streaming, { type: "load", turns: [], session, now: 0 });
    expect(reloaded.items.map((i) => i.text)).toEqual(["Hi, I'm"]);
    const stored = roomReducer(streaming, {
      type: "load",
      turns: [{ ...turn(1, "interviewer", "Hi, I'm Alex"), turnId: "live" }],
      session,
      now: 0,
    });
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]?.text).toBe("Hi, I'm Alex");
  });

  it("a stale reload does not erase a reply that arrived live in the meantime", () => {
    const live = run([
      {
        type: "message",
        turnId: "g",
        seq: 1,
        text: "Hello, tell me about yourself",
        offsetMs: 0,
        hint: false,
      },
    ]);
    const stale = roomReducer(live, { type: "load", turns: [], session, now: 0 });
    expect(stale.items.map((i) => i.text)).toEqual(["Hello, tell me about yourself"]);
    expect(stale.lastSeq).toBe(1);
  });

  it("streams tokens into one bubble and finalises it with the stored text", () => {
    const s = run([
      { type: "token", turnId: "a", delta: "Tell " },
      { type: "token", turnId: "a", delta: "me more." },
    ]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ text: "Tell me more.", streaming: true });
    const done = roomReducer(s, {
      type: "message",
      turnId: "a",
      seq: 3,
      text: "Tell me more.",
      offsetMs: 5,
      hint: true,
    });
    expect(done.items[0]).toMatchObject({ streaming: false, seq: 3, hint: true });
    expect(done.lastSeq).toBe(3);
  });

  it("removes a retracted reply and shows the corrected one", () => {
    const s = run([
      { type: "token", turnId: "bad", delta: "```code```" },
      { type: "retract", turnId: "bad" },
      { type: "token", turnId: "good", delta: "What is your plan?" },
      {
        type: "message",
        turnId: "good",
        seq: 4,
        text: "What is your plan?",
        offsetMs: 1,
        hint: false,
      },
    ]);
    expect(s.items.map((i) => i.text)).toEqual(["What is your plan?"]);
  });

  it("confirms an optimistic message instead of duplicating it", () => {
    const s = run([
      { type: "sending", clientMsgId: "c1", text: "My plan" },
      { type: "candidate", clientMsgId: "c1", seq: 5, text: "My plan", offsetMs: 9 },
      { type: "candidate", clientMsgId: "c1", seq: 5, text: "My plan", offsetMs: 9 }, // delivered twice
    ]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ pending: false, seq: 5 });
  });

  it("marks a failed send so it can be retried with the same id", () => {
    const s = run([
      { type: "sending", clientMsgId: "c2", text: "x" },
      { type: "send_failed", clientMsgId: "c2", message: "offline" },
    ]);
    expect(s.items[0]).toMatchObject({ failed: true, pending: false });
    expect(s.error).toBe("offline");
    const retry = roomReducer(s, { type: "sending", clientMsgId: "c2", text: "x" });
    expect(retry.items).toHaveLength(1);
    expect(retry.items[0]?.failed).toBe(false);
  });

  it("merges missed turns after a reconnect without duplicates", () => {
    const base = run([
      {
        type: "load",
        turns: [turn(1, "interviewer", "Hi"), turn(2, "candidate", "Hello")],
        session,
        now: 0,
      },
    ]);
    const s = roomReducer(base, {
      type: "merge",
      turns: [turn(2, "candidate", "Hello"), turn(3, "interviewer", "Welcome")],
    });
    expect(s.items.map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  it("extrapolates the countdown from the last server reading and freezes while paused", () => {
    const s = run([
      {
        type: "state",
        live: {
          state: "CODING",
          segment: "q1",
          remainingMs: 60_000,
          hintsLeft: 1,
          paused: false,
          questionIndex: 0,
          questionCount: 2,
        },
        now: 1000,
      },
    ]);
    expect(remainingNow(s, 11_000)).toBe(50_000);
    expect(remainingNow(s, 999_999)).toBe(0);
    const paused = roomReducer(s, { type: "state", live: { ...s.live!, paused: true }, now: 1000 });
    expect(remainingNow(paused, 30_000)).toBe(60_000);
    const resynced = roomReducer(s, { type: "tick", remainingMs: 40_000, now: 20_000 });
    expect(remainingNow(resynced, 25_000)).toBe(35_000);
  });

  it("keeps notices in the transcript and records the end", () => {
    const s = run([
      { type: "notice", text: "5 minutes left.", id: "1" },
      { type: "ended", reason: "timer", scorecardStatus: "generating" },
    ]);
    expect(s.items[0]).toMatchObject({ speaker: "system", text: "5 minutes left." });
    expect(s.ended).toEqual({ reason: "timer", scorecardStatus: "generating" });
  });
});
