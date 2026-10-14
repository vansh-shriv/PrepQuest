import type { PeerSignal } from "@prepquest/shared";

// The audio call between the two people, using "perfect negotiation": both sides can offer at any time, and
// when two offers cross the polite side gives way. The connection itself is injected so the logic can be
// tested without a browser. Audio never goes through our server; only these small signals do.

export interface IceCandidateLike {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface PeerConnectionLike {
  signalingState: string;
  connectionState: string;
  localDescription: { sdp: string } | null;
  onicecandidate: ((e: { candidate: IceCandidateLike | null }) => void) | null;
  ontrack: ((e: { streams: unknown[] }) => void) | null;
  onnegotiationneeded: (() => void) | null;
  onconnectionstatechange: (() => void) | null;
  addTrack(track: TrackLike, stream: unknown): unknown;
  setLocalDescription(desc?: { type: "offer" | "answer"; sdp: string }): Promise<void>;
  setRemoteDescription(desc: { type: "offer" | "answer"; sdp: string }): Promise<void>;
  addIceCandidate(c: IceCandidateLike | null): Promise<void>;
  close(): void;
}

export interface TrackLike {
  enabled: boolean;
}
export interface StreamLike {
  getAudioTracks(): TrackLike[];
  getTracks(): Array<TrackLike & { stop(): void }>;
}

export type CallState = "idle" | "waiting" | "connecting" | "connected" | "problem";

export interface CallOptions {
  createConnection(): PeerConnectionLike;
  send(signal: PeerSignal): void;
  /** The side that gives way when both offer at once. */
  polite: boolean;
  onRemoteStream(stream: unknown): void;
  onState(state: CallState): void;
}

export class CallController {
  private pc: PeerConnectionLike | null = null;
  private stream: StreamLike | null = null;
  private makingOffer = false;
  private ignoreOffer = false;
  private muted = false;
  private open = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: CallOptions) {}

  /** Starts the call with the microphone stream. */
  start(stream: StreamLike): void {
    this.stream = stream;
    this.open = true;
    this.muted = false;
    this.connect();
    this.opts.onState("waiting");
  }

  /** The partner left and came back, or the connection broke: build a fresh one and offer again. */
  restart(): void {
    if (!this.open || !this.stream) return;
    this.pc?.close();
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.connect();
    this.opts.onState("waiting");
  }

  private connect(): void {
    const pc = this.opts.createConnection();
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate)
        this.opts.send({
          kind: "candidate",
          candidate: {
            candidate: e.candidate.candidate,
            sdpMid: e.candidate.sdpMid ?? null,
            sdpMLineIndex: e.candidate.sdpMLineIndex ?? null,
            usernameFragment: e.candidate.usernameFragment ?? null,
          },
        });
    };
    pc.ontrack = (e) => {
      if (e.streams[0]) this.opts.onRemoteStream(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const s = pc.connectionState;
      if (s === "connected") this.opts.onState("connected");
      else if (s === "connecting") this.opts.onState("connecting");
      else if (s === "failed" || s === "disconnected") this.opts.onState("problem");
    };
    pc.onnegotiationneeded = () => {
      this.queue = this.queue.then(async () => {
        if (this.pc !== pc) return;
        try {
          this.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) this.opts.send({ kind: "offer", sdp: pc.localDescription.sdp });
        } catch {
          this.opts.onState("problem");
        } finally {
          this.makingOffer = false;
        }
      });
    };
    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = !this.muted;
      pc.addTrack(track, this.stream);
    }
  }

  /** A signal from the partner. Calls arrive in order; each is handled after the one before it. */
  receive(signal: PeerSignal): Promise<void> {
    this.queue = this.queue.then(() => this.handle(signal));
    return this.queue;
  }

  private async handle(signal: PeerSignal): Promise<void> {
    if (signal.kind === "hangup") {
      this.pc?.close();
      this.pc = null;
      // still in the call: wait quietly. Offering now would ring a partner who just left.
      if (this.open) this.opts.onState("waiting");
      return;
    }
    // the partner came back to the call and is offering: build a connection to answer with
    if (!this.pc && this.open && signal.kind === "offer") this.connect();
    const pc = this.pc;
    if (!pc) return;
    try {
      if (signal.kind === "offer") {
        const collision = this.makingOffer || pc.signalingState !== "stable";
        this.ignoreOffer = !this.opts.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        await pc.setLocalDescription();
        if (pc.localDescription) this.opts.send({ kind: "answer", sdp: pc.localDescription.sdp });
      } else if (signal.kind === "answer") {
        await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      } else {
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch (err) {
          // a candidate for an offer we ignored is expected to fail
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch {
      this.opts.onState("problem");
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = !muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Leaves the call: tells the partner, closes the connection and releases the microphone. */
  hangup(): void {
    if (this.open) this.opts.send({ kind: "hangup" });
    this.open = false;
    this.pc?.close();
    this.pc = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.opts.onState("idle");
  }
}

/**
 * Signals that arrive before this person has joined the call. Only the latest offer and the candidates
 * that follow it matter; a hang-up empties it, because the offer it carried is no longer wanted.
 */
export class PendingSignals {
  private items: PeerSignal[] = [];

  add(signal: PeerSignal): void {
    if (signal.kind === "offer") this.items = [signal];
    else if (signal.kind === "hangup") this.items = [];
    else if (this.items.length > 0 && signal.kind === "candidate") this.items.push(signal);
  }

  /** Whether a partner is calling (an offer is waiting). */
  get ringing(): boolean {
    return this.items.length > 0;
  }

  take(): PeerSignal[] {
    const out = this.items;
    this.items = [];
    return out;
  }
}
