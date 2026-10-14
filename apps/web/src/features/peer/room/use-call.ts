"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerRtcConfig, PeerSignal } from "@prepquest/shared";
import { api } from "@/lib/api";
import {
  CallController,
  PendingSignals,
  type CallState,
  type PeerConnectionLike,
  type StreamLike,
} from "./call";

export interface CallOptions {
  sessionId: string;
  /** Both sides must agree who gives way when two offers cross: the lower user id does. */
  polite: boolean;
  send(signal: PeerSignal): void;
}

/** The audio call: joining asks for the microphone, and nothing is sent until the person does. */
export function useCall(opts: CallOptions) {
  const [state, setState] = useState<CallState>("idle");
  const [muted, setMuted] = useState(false);
  const [ringing, setRinging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const controller = useRef<CallController | null>(null);
  const pending = useRef(new PendingSignals());
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const join = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setError("The microphone is blocked or missing. Allow it in the browser and try again.");
      return;
    }
    let config: PeerRtcConfig;
    try {
      config = await api<PeerRtcConfig>(`/peer/sessions/${optsRef.current.sessionId}/rtc-config`);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError("Couldn't set up the call. Try again in a moment.");
      return;
    }
    const call = new CallController({
      createConnection: () =>
        new RTCPeerConnection({ iceServers: config.iceServers }) as unknown as PeerConnectionLike,
      send: (s) => optsRef.current.send(s),
      polite: optsRef.current.polite,
      onRemoteStream: (s) => setRemote(s as MediaStream),
      onState: (s) => {
        setState(s);
        if (s === "idle") setRemote(null);
      },
    });
    controller.current = call;
    call.start(stream as unknown as StreamLike);
    setMuted(false);
    setRinging(false);
    // an offer that arrived before this person joined is answered now
    for (const signal of pending.current.take()) void call.receive(signal);
  }, []);

  const leave = useCallback(() => {
    controller.current?.hangup();
    controller.current = null;
    setMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    const c = controller.current;
    if (!c) return;
    c.setMuted(!c.isMuted);
    setMuted(c.isMuted);
  }, []);

  /** A call signal from the partner. */
  const receive = useCallback((signal: PeerSignal) => {
    const c = controller.current;
    if (c) {
      void c.receive(signal);
      return;
    }
    pending.current.add(signal);
    setRinging(pending.current.ringing);
  }, []);

  /** The partner reconnected: if we are in the call, build it again. */
  const partnerBack = useCallback(() => controller.current?.restart(), []);

  useEffect(
    () => () => {
      controller.current?.hangup();
      controller.current = null;
    },
    [],
  );

  return { state, muted, ringing, error, remote, join, leave, toggleMute, receive, partnerBack };
}
