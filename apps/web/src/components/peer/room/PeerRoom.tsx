"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Chip, Window } from "@prepquest/ui";
import type { PeerSessionDetail, PeerSuggestionsDto } from "@prepquest/shared";
import type { CallState } from "@/features/peer/room/call";
import { useCall } from "@/features/peer/room/use-call";
import { useRoom } from "@/features/peer/room/use-room";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../../auth/AuthCard";
import { SharedEditor } from "./SharedEditor";
import { Whiteboard } from "./Whiteboard";

const CALL_TEXT: Record<CallState, string> = {
  idle: "Not on the call",
  waiting: "Waiting for your partner to join the call",
  connecting: "Connecting",
  connected: "Connected",
  problem: "The call has a problem",
};

/**
 * The live part of a peer session: the shared code, the whiteboard, the audio call and, for the interviewer,
 * a button for follow-up suggestions. Audio goes directly between the two browsers.
 */
export function PeerRoom({
  s,
  userId,
  onEnded,
}: {
  s: PeerSessionDetail;
  userId: string;
  onEnded: () => void;
}) {
  const [tab, setTab] = useState<"code" | "board">("code");
  const callRef = useRef<ReturnType<typeof useCall> | null>(null);
  const room = useRoom({
    sessionId: s.id,
    enabled: true,
    onSignal: (signal) => callRef.current?.receive(signal),
    onPartnerJoined: () => callRef.current?.partnerBack(),
    onPartnerLeft: () => undefined,
    onEnded,
  });
  const call = useCall({
    sessionId: s.id,
    // both sides compute the same answer from the two ids, so exactly one of them gives way
    polite: userId < s.partner.userId,
    send: room.sendSignal,
  });
  callRef.current = call;

  // the partner's voice
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (audio.current) audio.current.srcObject = call.remote;
  }, [call.remote]);

  const interviewer = s.clock?.you === "interviewer";
  const inCall = call.state !== "idle";

  return (
    <Window title="Live room" tone="sky">
      <div className="grid gap-4" data-testid="peer-room">
        <div className="flex flex-wrap items-center gap-2" data-testid="peer-room-status">
          <Chip tone={room.status === "online" ? "easy" : "info"}>
            <span data-testid="peer-room-connection">
              {room.status === "online"
                ? "Connected"
                : room.status === "ended"
                  ? "Room closed"
                  : room.status === "offline"
                    ? "Reconnecting"
                    : "Connecting"}
            </span>
          </Chip>
          <span data-testid="peer-room-partner" className="text-sm">
            {room.partnerOnline
              ? `${s.partner.handle} is here`
              : `${s.partner.handle} has not joined yet`}
          </span>
        </div>

        <section className="grid gap-2" aria-labelledby="call-h" data-testid="peer-call">
          <h3 id="call-h" className="pq-font-ui m-0 text-xs uppercase">
            Audio
          </h3>
          <p className="m-0 text-sm" role="status" data-testid="peer-call-state">
            {inCall
              ? CALL_TEXT[call.state]
              : call.ringing
                ? `${s.partner.handle} is calling`
                : CALL_TEXT.idle}
            {inCall && call.muted ? " (you are muted)" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {!inCall ? (
              <Button size="sm" onClick={() => void call.join()}>
                {call.ringing ? "Answer the call" : "Join the audio"}
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={call.toggleMute}
                  aria-pressed={call.muted}
                >
                  {call.muted ? "Unmute" : "Mute"}
                </Button>
                <Button size="sm" variant="ghost" onClick={call.leave}>
                  Leave the audio
                </Button>
              </>
            )}
          </div>
          <FormError message={call.error} />
          <p className="m-0 text-xs text-ink-soft">
            Your voice goes straight to your partner. Nothing is recorded.
          </p>
          <audio ref={audio} autoPlay data-testid="peer-remote-audio" />
        </section>

        <div className="flex gap-2" role="group" aria-label="Shared workspace">
          <Button
            size="sm"
            variant={tab === "code" ? "primary" : "ghost"}
            aria-pressed={tab === "code"}
            onClick={() => setTab("code")}
          >
            Code
          </Button>
          <Button
            size="sm"
            variant={tab === "board" ? "primary" : "ghost"}
            aria-pressed={tab === "board"}
            onClick={() => setTab("board")}
          >
            Whiteboard
          </Button>
        </div>
        <div className={tab === "code" ? "" : "hidden"}>
          <SharedEditor doc={room.doc} />
        </div>
        <div className={tab === "board" ? "" : "hidden"}>
          <Whiteboard doc={room.doc} userId={userId} />
        </div>

        {interviewer && <Suggestions sessionId={s.id} />}
      </div>
    </Window>
  );
}

function Suggestions({ sessionId }: { sessionId: string }) {
  const [items, setItems] = useState<PeerSuggestionsDto["items"]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<PeerSuggestionsDto>(`/peer/sessions/${sessionId}/suggestions`, {
        method: "POST",
        json: {},
      });
      setItems((old) => [...res.items, ...old].slice(0, 12));
      setRemaining(res.remaining);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Suggestions are not available right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-2" aria-labelledby="sugg-h" data-testid="peer-suggestions">
      <h3 id="sugg-h" className="pq-font-ui m-0 text-xs uppercase">
        Follow-up ideas (only you see these)
      </h3>
      <p className="m-0 text-sm text-ink-soft">
        Written from the question and the code on the screen. Never audio. Use them or ignore them.
      </p>
      <div>
        <Button size="sm" loading={busy} onClick={() => void ask()}>
          Suggest follow-ups
        </Button>
        {remaining !== null && (
          <span className="ml-2 text-sm text-ink-soft">{remaining} left this session</span>
        )}
      </div>
      <FormError message={error} />
      {items.length > 0 && (
        <ul className="m-0 grid gap-2 pl-5" data-testid="peer-suggestion-list">
          {items.map((i, n) => (
            <li key={`${i.text}-${n}`}>
              {i.text}
              {i.why && <span className="block text-sm text-ink-soft">{i.why}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
