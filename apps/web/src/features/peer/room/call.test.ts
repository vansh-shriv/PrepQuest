import { describe, expect, it } from "vitest";
import type { PeerSignal } from "@prepquest/shared";
import {
  CallController,
  PendingSignals,
  type CallState,
  type PeerConnectionLike,
  type StreamLike,
  type TrackLike,
} from "./call";

/** A connection that follows the offer/answer rules closely enough to test the negotiation. */
class FakePc implements PeerConnectionLike {
  signalingState = "stable";
  connectionState = "new";
  localDescription: { sdp: string } | null = null;
  onicecandidate: PeerConnectionLike["onicecandidate"] = null;
  ontrack: PeerConnectionLike["ontrack"] = null;
  onnegotiationneeded: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  tracks: TrackLike[] = [];
  remote: string[] = [];
  candidates: unknown[] = [];
  closed = false;
  constructor(readonly name: string) {}
  addTrack(track: TrackLike) {
    this.tracks.push(track);
    queueMicrotask(() => this.onnegotiationneeded?.());
  }
  async setLocalDescription(desc?: { type: "offer" | "answer"; sdp: string }) {
    const type = desc?.type ?? (this.signalingState === "have-remote-offer" ? "answer" : "offer");
    this.localDescription = { sdp: `${type} from ${this.name}` };
    this.signalingState = type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(desc: { type: "offer" | "answer"; sdp: string }) {
    if (desc.type === "offer" && this.signalingState === "have-local-offer")
      throw new Error("glare: rollback needed");
    this.remote.push(desc.sdp);
    this.signalingState = desc.type === "offer" ? "have-remote-offer" : "stable";
  }
  async addIceCandidate(c: unknown) {
    this.candidates.push(c);
  }
  close() {
    this.closed = true;
  }
  setConnection(s: string) {
    this.connectionState = s;
    this.onconnectionstatechange?.();
  }
}

const stream = (): StreamLike & { stopped: number; track: TrackLike } => {
  const track = { enabled: true, stop: () => void (s.stopped += 1) };
  const s = { stopped: 0, track, getAudioTracks: () => [track], getTracks: () => [track] };
  return s;
};

function side(name: string, polite: boolean) {
  const sent: PeerSignal[] = [];
  const states: CallState[] = [];
  const pcs: FakePc[] = [];
  const call = new CallController({
    createConnection: () => {
      const pc = new FakePc(name);
      pcs.push(pc);
      return pc;
    },
    send: (s) => sent.push(s),
    polite,
    onRemoteStream: () => undefined,
    onState: (s) => states.push(s),
  });
  return { call, sent, states, pcs, pc: () => pcs[pcs.length - 1]! };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("CallController", () => {
  it("offers when it starts, and the partner answers", async () => {
    const a = side("ada", true);
    const b = side("bob", false);
    a.call.start(stream());
    b.call.start(stream());
    await flush();
    // both offered at once; the impolite side (bob) ignores ada's offer, the polite side accepts bob's
    expect(a.sent[0]).toEqual({ kind: "offer", sdp: "offer from ada" });
    expect(b.sent[0]).toEqual({ kind: "offer", sdp: "offer from bob" });
    await b.call.receive(a.sent[0]!); // bob is mid-offer: ignored
    expect(b.pc().remote).toEqual([]);
    expect(b.pc().signalingState).toBe("have-local-offer");
  });

  it("the polite side gives way and answers the other's offer", async () => {
    const polite = side("ada", true);
    polite.call.start(stream());
    await flush();
    // ada has an offer out and bob's offer arrives: ada accepts it (a real browser rolls its own back)
    polite.pc().signalingState = "stable";
    await polite.call.receive({ kind: "offer", sdp: "offer from bob" });
    expect(polite.pc().remote).toEqual(["offer from bob"]);
    expect(polite.sent.at(-1)).toEqual({ kind: "answer", sdp: "answer from ada" });
  });

  it("a clean exchange ends connected", async () => {
    const a = side("ada", true);
    a.call.start(stream());
    await flush();
    await a.call.receive({ kind: "answer", sdp: "answer from bob" });
    expect(a.pc().signalingState).toBe("stable");
    await a.call.receive({
      kind: "candidate",
      candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 },
    });
    expect(a.pc().candidates).toHaveLength(1);
    a.pc().setConnection("connecting");
    a.pc().setConnection("connected");
    expect(a.states.at(-1)).toBe("connected");
    a.pc().setConnection("failed");
    expect(a.states.at(-1)).toBe("problem");
  });

  it("sends the candidates the connection finds", async () => {
    const a = side("ada", true);
    a.call.start(stream());
    a.pc().onicecandidate?.({
      candidate: { candidate: "candidate:9", sdpMid: "0", sdpMLineIndex: 0 },
    });
    a.pc().onicecandidate?.({ candidate: null });
    expect(a.sent).toEqual([
      {
        kind: "candidate",
        candidate: {
          candidate: "candidate:9",
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: null,
        },
      },
    ]);
  });

  it("mutes by switching the track, without any signal", async () => {
    const a = side("ada", true);
    const s = stream();
    a.call.start(s);
    await flush();
    const before = a.sent.length;
    a.call.setMuted(true);
    expect(s.track.enabled).toBe(false);
    expect(a.call.isMuted).toBe(true);
    a.call.setMuted(false);
    expect(s.track.enabled).toBe(true);
    expect(a.sent.length).toBe(before);
  });

  it("hanging up tells the partner, closes the connection and releases the microphone", async () => {
    const a = side("ada", true);
    const b = side("bob", false);
    const sa = stream();
    a.call.start(sa);
    b.call.start(stream());
    await flush();
    a.call.hangup();
    expect(a.sent.at(-1)).toEqual({ kind: "hangup" });
    expect(a.pcs[0]!.closed).toBe(true);
    expect(sa.stopped).toBe(1);
    expect(a.states.at(-1)).toBe("idle");
    // the partner is still in the call: it goes back to waiting and offers nothing to someone who left
    const offersBefore = b.sent.filter((x) => x.kind === "offer").length;
    await b.call.receive({ kind: "hangup" });
    await flush();
    expect(b.pcs[0]!.closed).toBe(true);
    expect(b.pcs).toHaveLength(1);
    expect(b.states.at(-1)).toBe("waiting");
    expect(b.sent.filter((x) => x.kind === "offer")).toHaveLength(offersBefore);
    // when the other comes back and offers, it builds a connection and answers
    await b.call.receive({ kind: "offer", sdp: "offer from ada again" });
    expect(b.pcs).toHaveLength(2);
    expect(b.pcs[1]!.remote).toEqual(["offer from ada again"]);
    expect(b.sent.at(-1)).toEqual({ kind: "answer", sdp: "answer from bob" });
  });

  it("restarts with a fresh connection when the partner comes back", async () => {
    const a = side("ada", true);
    a.call.start(stream());
    await flush();
    a.call.restart();
    await flush();
    expect(a.pcs).toHaveLength(2);
    expect(a.pcs[0]!.closed).toBe(true);
    expect(a.sent.filter((s) => s.kind === "offer")).toHaveLength(2);
    // restarting a call that was never started, or already left, does nothing
    const idle = side("bob", false);
    idle.call.restart();
    expect(idle.pcs).toHaveLength(0);
  });

  it("reports a problem when a description is refused, and ignores signals after hanging up", async () => {
    const a = side("ada", true);
    a.call.start(stream());
    await flush();
    a.pc().setRemoteDescription = async () => {
      throw new Error("bad sdp");
    };
    await a.call.receive({ kind: "answer", sdp: "garbage" });
    expect(a.states.at(-1)).toBe("problem");
    a.call.hangup();
    const n = a.sent.length;
    await a.call.receive({ kind: "offer", sdp: "late" });
    expect(a.sent.length).toBe(n);
  });
});

describe("PendingSignals", () => {
  const offer = (sdp: string): PeerSignal => ({ kind: "offer", sdp });
  const cand: PeerSignal = { kind: "candidate", candidate: { candidate: "candidate:1" } };
  it("keeps the latest offer and the candidates after it", () => {
    const p = new PendingSignals();
    p.add(cand); // before any offer: nothing to attach it to
    expect(p.ringing).toBe(false);
    p.add(offer("one"));
    p.add(cand);
    p.add(offer("two"));
    p.add(cand);
    expect(p.ringing).toBe(true);
    expect(p.take()).toEqual([offer("two"), cand]);
    expect(p.ringing).toBe(false);
  });
  it("forgets everything when the partner hangs up", () => {
    const p = new PendingSignals();
    p.add(offer("one"));
    p.add({ kind: "hangup" });
    expect(p.take()).toEqual([]);
  });
});
