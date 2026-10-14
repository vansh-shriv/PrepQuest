import type { Socket } from "socket.io";
import {
  AppError,
  bargeInSchema,
  interviewCodeEventSchema,
  interviewMessageSchema,
} from "@prepquest/shared";
import type { Kv } from "../../lib/kv.js";
import type { Realtime } from "../../lib/realtime.js";
import type { AiContext } from "../ai-context.js";
import type { ServerEvent } from "./bus.js";
import type { InterviewEngine } from "./engine.js";
import { wsTicketKey } from "./routes.js";
import * as svc from "./service.js";

interface SocketData {
  userId: string;
  sessionId: string;
}

function failure(err: unknown) {
  if (err instanceof AppError) return { ok: false as const, code: err.code, message: err.message };
  return { ok: false as const, code: "INTERNAL", message: "Something went wrong" };
}

/**
 * Socket.IO namespace `/interview` (doc 11 §8). A short-lived single-use ticket (`?ticket=`) binds the
 * connection to one user and session. Everything the client sees is a bus event; the server owns the
 * clock, so reconnecting never resets anything and `sync` simply replays the persisted turns.
 */
export function attachInterviewGateway(deps: {
  ctx: AiContext;
  engine: InterviewEngine;
  kv: Kv;
  realtime: Realtime;
}): void {
  deps.realtime.use((io) => {
    const ns = io.of("/interview");

    ns.use(async (socket, next) => {
      const raw = socket.handshake.auth?.ticket ?? socket.handshake.query?.ticket;
      const ticket = Array.isArray(raw) ? raw[0] : raw;
      if (typeof ticket !== "string") return next(new Error("UNAUTHENTICATED"));
      const value = await deps.kv.take(wsTicketKey(ticket));
      const [userId, sessionId] = value?.split(":") ?? [];
      if (!userId || !sessionId) return next(new Error("UNAUTHENTICATED"));
      (socket.data as SocketData) = { userId, sessionId };
      next();
    });

    ns.on("connection", async (socket: Socket) => {
      const { userId, sessionId } = socket.data as SocketData;
      const send = (e: ServerEvent) => {
        const { type, ...payload } = e;
        socket.emit(type, { sessionId, ts: Date.now(), ...payload });
      };
      const unsubscribe = deps.engine.bus.subscribe(sessionId, send);
      socket.on("disconnect", unsubscribe);
      type Ack = (res: unknown) => void;
      const handle =
        <T>(fn: (payload: T) => Promise<unknown>) =>
        async (payload: T, ack?: Ack) => {
          try {
            const result = await fn(payload);
            ack?.({ ok: true, ...(result as object) });
          } catch (err) {
            const f = failure(err);
            ack?.(f);
            send({ type: "error", code: f.code, message: f.message });
          }
        };

      socket.on(
        "user.message",
        handle(async (p: unknown) => {
          const input = interviewMessageSchema.parse(p);
          await deps.ctx.limiter.enforce(`interview-msg:${userId}`, 40, 60, "messages");
          return deps.engine.sendMessage(userId, sessionId, input);
        }),
      );
      socket.on(
        "user.barge_in",
        handle(async (p: unknown) =>
          deps.engine.bargeIn(userId, sessionId, bargeInSchema.parse(p)),
        ),
      );
      socket.on(
        "code.event",
        handle(async (p: unknown) =>
          deps.engine.codeEvent(userId, sessionId, interviewCodeEventSchema.parse(p)),
        ),
      );
      socket.on(
        "session.pause",
        handle(async () => ({
          session: svc.toSessionDto(await deps.engine.pause(userId, sessionId), deps.ctx.now()),
        })),
      );
      socket.on(
        "session.resume",
        handle(async () => ({
          session: svc.toSessionDto(await deps.engine.resume(userId, sessionId), deps.ctx.now()),
        })),
      );
      socket.on(
        "session.end",
        handle(async () => ({
          session: svc.toSessionDto(await deps.engine.end(userId, sessionId), deps.ctx.now()),
        })),
      );
      socket.on(
        "sync",
        handle(async (p: { lastSeq?: number } | undefined) => {
          const snap = await deps.engine.snapshot(userId, sessionId);
          return {
            state: snap.state,
            session: svc.toSessionDto(snap.session, deps.ctx.now()),
            turns: await svc.getTurns(deps.ctx.db, sessionId, Number(p?.lastSeq ?? 0) || 0),
          };
        }),
      );

      // handlers are registered above before anything is awaited: an early client event is never lost
      try {
        const snap = await deps.engine.snapshot(userId, sessionId);
        send({ type: "session.state", state: snap.state });
      } catch {
        socket.disconnect(true);
      }
    });
  });
}
