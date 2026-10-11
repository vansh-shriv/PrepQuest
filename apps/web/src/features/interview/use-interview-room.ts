"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { InterviewSessionDto, InterviewTurnDto } from "@prepquest/shared";
import { API_URL, api, ApiError } from "@/lib/api";
import { initialRoom, remainingNow, roomReducer, type LiveState } from "./room-state";

export type Connection = "connecting" | "online" | "offline";

interface Ack {
  ok: boolean;
  code?: string;
  message?: string;
  replies?: { seq: number; turnId: string; text: string; hintUsed: boolean }[];
}

/**
 * Live connection to one interview. Streaming runs over the WebSocket; if the socket is down the
 * same messages go over REST (no streaming, but nothing is lost: a retry with the same client id is
 * answered once). The server owns the clock; reconnecting only re-reads it.
 */
export function useInterviewRoom(sessionId: string) {
  const [room, dispatch] = useReducer(roomReducer, initialRoom);
  const [session, setSession] = useState<InterviewSessionDto | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const socketRef = useRef<Socket | null>(null);
  const lastSeq = useRef(0);
  lastSeq.current = room.lastSeq;

  const reload = useCallback(async () => {
    const res = await api<{ session: InterviewSessionDto; turns: InterviewTurnDto[] }>(
      `/interviews/${sessionId}`,
    );
    setSession(res.session);
    dispatch({ type: "load", turns: res.turns, session: res.session, now: Date.now() });
    return res;
  }, [sessionId]);

  // initial load
  useEffect(() => {
    let alive = true;
    reload().catch((err: unknown) => {
      if (alive)
        setLoadError(err instanceof ApiError && err.status === 404 ? "not_found" : "failed");
    });
    return () => {
      alive = false;
    };
  }, [reload]);

  // questions are revealed as they are asked: re-read the session when the interview moves on
  const stage = room.live
    ? `${room.live.questionIndex}:${room.live.state === "WARMUP" ? "w" : "x"}`
    : "";
  useEffect(() => {
    if (!stage || !session) return;
    api<{ session: InterviewSessionDto }>(`/interviews/${sessionId}`)
      .then((r) => setSession(r.session))
      .catch(() => undefined);
    // only the stage matters here, not the session object itself
  }, [stage, sessionId]);

  // the countdown redraws four times a second; the value itself comes from the server reading
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // the socket
  useEffect(() => {
    if (!session || session.endedAt) return;
    const socket = io(`${API_URL}/interview`, {
      path: "/ws",
      transports: ["websocket"],
      // a fresh single-use ticket for every (re)connection
      auth: (cb) => {
        api<{ wsTicket: string }>(`/interviews/${sessionId}/ws-ticket`, {
          method: "POST",
          json: {},
        })
          .then((r) => cb({ ticket: r.wsTicket }))
          .catch(() => cb({}));
      },
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnection("online");
      socket.emit(
        "sync",
        { lastSeq: lastSeq.current },
        (res: { ok: boolean; turns?: InterviewTurnDto[]; session?: InterviewSessionDto }) => {
          if (res.ok && res.turns) dispatch({ type: "merge", turns: res.turns });
          if (res.ok && res.session) setSession(res.session);
        },
      );
    });
    socket.on("disconnect", () => setConnection("offline"));
    socket.on("connect_error", () => {
      setConnection("offline");
      // a rejected handshake (expired ticket) is not retried by socket.io itself: try again with a new ticket
      if (!socket.active) {
        setTimeout(() => {
          if (socketRef.current === socket) socket.connect();
        }, 2000);
      }
    });
    socket.on("session.state", (e: { state: LiveState }) =>
      dispatch({ type: "state", live: e.state, now: Date.now() }),
    );
    socket.on("timer.tick", (e: { remainingMs: number }) =>
      dispatch({ type: "tick", remainingMs: e.remainingMs, now: Date.now() }),
    );
    socket.on(
      "candidate.message",
      (e: { clientMsgId: string; seq: number; text: string; offsetMs: number }) =>
        dispatch({ type: "candidate", ...e }),
    );
    socket.on("interviewer.token", (e: { turnId: string; delta: string }) =>
      dispatch({ type: "token", ...e }),
    );
    socket.on("interviewer.retract", (e: { turnId: string }) =>
      dispatch({ type: "retract", turnId: e.turnId }),
    );
    socket.on(
      "interviewer.message",
      (e: {
        turnId: string;
        seq: number;
        text: string;
        offsetMs: number;
        meta: { hintUsed?: boolean };
      }) =>
        dispatch({
          type: "message",
          turnId: e.turnId,
          seq: e.seq,
          text: e.text,
          offsetMs: e.offsetMs,
          hint: Boolean(e.meta?.hintUsed),
        }),
    );
    socket.on("interviewer.typing", (e: { on: boolean }) => dispatch({ type: "typing", on: e.on }));
    socket.on("system.notice", (e: { text: string; ts: number }) =>
      dispatch({ type: "notice", text: e.text, id: String(e.ts) }),
    );
    socket.on("session.ended", (e: { reason: string; scorecardStatus: string }) => {
      dispatch({ type: "ended", ...e });
      void reload();
    });
    socket.on("scorecard.ready", () => dispatch({ type: "scorecard_ready" }));
    socket.on("error", (e: { message: string }) => dispatch({ type: "error", message: e.message }));
    return () => {
      socket.close();
      socketRef.current = null;
    };
    // the session object changes on every sync; only its identity-defining fields matter here
  }, [sessionId, Boolean(session), Boolean(session?.endedAt)]);

  const emit = useCallback(
    (event: string, payload?: unknown): Promise<Ack> =>
      new Promise((resolve) => {
        const s = socketRef.current;
        if (!s?.connected) return resolve({ ok: false, code: "OFFLINE" });
        s.timeout(60_000).emit(event, payload, (err: Error | null, res: Ack) =>
          resolve(
            err
              ? { ok: false, code: "TIMEOUT", message: "The server took too long to answer." }
              : res,
          ),
        );
      }),
    [],
  );

  const send = useCallback(
    async (text: string, retryId?: string) => {
      const clientMsgId = retryId ?? crypto.randomUUID();
      dispatch({ type: "sending", clientMsgId, text });
      let res = await emit("user.message", { clientMsgId, text });
      if (!res.ok && (res.code === "OFFLINE" || res.code === "TIMEOUT")) {
        // fall back to REST: same client id, so the server answers each message once
        try {
          const rest = await api<{
            candidateSeq: number;
            replies: { seq: number; turnId: string; text: string; hintUsed: boolean }[];
          }>(`/interviews/${sessionId}/messages`, { method: "POST", json: { clientMsgId, text } });
          await reload();
          res = { ok: true, replies: rest.replies };
        } catch (err) {
          res = {
            ok: false,
            code: err instanceof ApiError ? err.code : "NETWORK",
            message: err instanceof ApiError ? err.message : "Couldn't reach the server.",
          };
        }
      }
      if (!res.ok)
        dispatch({
          type: "send_failed",
          clientMsgId,
          message: res.message ?? "Your message wasn't delivered. Try again.",
        });
      return { ok: res.ok, clientMsgId };
    },
    [emit, reload, sessionId],
  );

  const control = useCallback(
    async (action: "pause" | "resume" | "end") => {
      const viaSocket = await emit(`session.${action}`);
      if (viaSocket.ok) return viaSocket;
      if (viaSocket.code !== "OFFLINE") {
        dispatch({ type: "error", message: viaSocket.message ?? "That didn't work." });
        return viaSocket;
      }
      try {
        await api(`/interviews/${sessionId}/${action}`, { method: "POST", json: {} });
        await reload();
        return { ok: true } as Ack;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Couldn't reach the server.";
        dispatch({ type: "error", message });
        return { ok: false, message } as Ack;
      }
    },
    [emit, reload, sessionId],
  );

  /** Code events go over REST: the payloads are large and ordering against messages does not matter. */
  const codeEvent = useCallback(
    (body: Record<string, unknown>) =>
      api(`/interviews/${sessionId}/events`, { method: "POST", json: body }).catch(() => undefined),
    [sessionId],
  );

  const start = useCallback(async () => {
    const res = await api<{ session: InterviewSessionDto }>(`/interviews/${sessionId}/start`, {
      method: "POST",
      json: {},
    });
    setSession(res.session);
    await reload();
  }, [reload, sessionId]);

  return {
    room,
    session,
    connection,
    loadError,
    remainingMs: remainingNow(room, now),
    send,
    control,
    codeEvent,
    start,
    reload,
    clearError: () => dispatch({ type: "error", message: null }),
  };
}
