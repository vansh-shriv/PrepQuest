"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import * as Y from "yjs";
import { PEER_ROOM_EVENTS, type PeerSignal } from "@prepquest/shared";
import { API_URL, api } from "@/lib/api";

export type RoomStatus = "connecting" | "online" | "offline" | "ended";

export interface RoomOptions {
  sessionId: string;
  /** The room is only joined while the session is running. */
  enabled: boolean;
  onSignal(signal: PeerSignal): void;
  onPartnerJoined(): void;
  onPartnerLeft(): void;
  onEnded(): void;
}

/** What `Y.encodeStateAsUpdate` returns for a document with nothing in it. */
const EMPTY_UPDATE_BYTES = 2;

/**
 * The live connection to a peer room: the shared document (editor text, language, drawing) and the small
 * messages that set up the audio call. The document is a CRDT, so an edit made while the connection was down
 * is sent after it comes back and merges with whatever the partner did meanwhile.
 */
export function useRoom(opts: RoomOptions) {
  const doc = useMemo(() => new Y.Doc(), [opts.sessionId]);
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [partnerOnline, setPartnerOnline] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!opts.enabled) return;
    const socket = io(`${API_URL}/peer`, {
      path: "/ws",
      transports: ["websocket"],
      // a fresh single-use ticket for every (re)connection
      auth: (cb) => {
        api<{ wsTicket: string }>(`/peer/sessions/${opts.sessionId}/room-ticket`, {
          method: "POST",
          json: {},
        })
          .then((r) => cb({ ticket: r.wsTicket }))
          .catch(() => cb({}));
      },
    });
    socketRef.current = socket;

    // local edits go out; the partner's (origin "remote") are not echoed back
    const onLocal = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || !socket.connected) return;
      socket.emit(PEER_ROOM_EVENTS.docUpdate, { update });
    };
    doc.on("update", onLocal);

    socket.on("connect", () => setStatus("online"));
    socket.on("disconnect", () => {
      setStatus((s) => (s === "ended" ? s : "offline"));
      setPartnerOnline(false);
    });
    socket.on("connect_error", (err: Error) => {
      // the session is over, or this person has no place in it: stop trying
      if (err.message === "CONFLICT" || err.message === "NOT_FOUND") {
        setStatus("ended");
        optsRef.current.onEnded();
        return;
      }
      setStatus("offline");
      if (!socket.active) {
        setTimeout(() => {
          if (socketRef.current === socket) socket.connect();
        }, 2000);
      }
    });
    socket.on(PEER_ROOM_EVENTS.hello, (e: { partnerOnline: boolean }) =>
      setPartnerOnline(e.partnerOnline),
    );
    socket.on(PEER_ROOM_EVENTS.docSync, (e: { update: ArrayBuffer }) => {
      const server = new Uint8Array(e.update);
      Y.applyUpdate(doc, server, "remote");
      // anything typed while offline that the server has not seen
      const missing = Y.encodeStateAsUpdate(doc, Y.encodeStateVectorFromUpdate(server));
      if (missing.length > EMPTY_UPDATE_BYTES)
        socket.emit(PEER_ROOM_EVENTS.docUpdate, { update: missing });
    });
    socket.on(PEER_ROOM_EVENTS.docUpdate, (e: { update: ArrayBuffer }) =>
      Y.applyUpdate(doc, new Uint8Array(e.update), "remote"),
    );
    socket.on(PEER_ROOM_EVENTS.signal, (e: { signal: PeerSignal }) =>
      optsRef.current.onSignal(e.signal),
    );
    socket.on(PEER_ROOM_EVENTS.peerJoined, () => {
      setPartnerOnline(true);
      optsRef.current.onPartnerJoined();
    });
    socket.on(PEER_ROOM_EVENTS.peerLeft, () => {
      setPartnerOnline(false);
      optsRef.current.onPartnerLeft();
    });
    socket.on(PEER_ROOM_EVENTS.ended, () => {
      setStatus("ended");
      optsRef.current.onEnded();
    });

    return () => {
      doc.off("update", onLocal);
      socketRef.current = null;
      socket.close();
    };
  }, [opts.enabled, opts.sessionId, doc]);

  const sendSignal = (signal: PeerSignal) => {
    socketRef.current?.emit(PEER_ROOM_EVENTS.signal, signal);
  };

  return { doc, status, partnerOnline, sendSignal };
}
