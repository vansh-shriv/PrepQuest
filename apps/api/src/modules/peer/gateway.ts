import type { Socket } from "socket.io";
import { AppError, PEER_ROOM_EVENTS, peerSignalSchema } from "@prepquest/shared";
import type { Kv } from "../../lib/kv.js";
import type { Realtime } from "../../lib/realtime.js";
import type { AiContext } from "../ai-context.js";
import type { RoomHub } from "./room.js";
import * as svc from "./service.js";

interface SocketData {
  userId: string;
  sessionId: string;
}

export const peerTicketKey = (ticket: string) => `peerticket:${ticket}`;
const SWEEP_MS = 5000;
const roomName = (sessionId: string) => `peer:${sessionId}`;

/**
 * Socket.IO namespace `/peer`: the live room of a peer mock. A single-use ticket binds a connection to one
 * person and one session, and only members of a running session get in. The server relays the shared
 * editor's Yjs updates (after size checks), keeps its own copy for late joiners, and passes audio call
 * signalling to the partner. It never sees audio: that goes straight between the browsers.
 */
export function attachPeerGateway(deps: {
  ctx: AiContext;
  kv: Kv;
  realtime: Realtime;
  rooms: RoomHub;
}): void {
  const { ctx, rooms } = deps;
  deps.realtime.use((io) => {
    const ns = io.of("/peer");

    ns.use(async (socket, next) => {
      const raw = socket.handshake.auth?.ticket ?? socket.handshake.query?.ticket;
      const ticket = Array.isArray(raw) ? raw[0] : raw;
      if (typeof ticket !== "string") return next(new Error("UNAUTHENTICATED"));
      const value = await deps.kv.take(peerTicketKey(ticket));
      const [userId, sessionId] = value?.split(":") ?? [];
      if (!userId || !sessionId) return next(new Error("UNAUTHENTICATED"));
      try {
        await svc.roomAccess(ctx.db, userId, sessionId, ctx.now());
      } catch (err) {
        return next(new Error(err instanceof AppError ? err.code : "FORBIDDEN"));
      }
      (socket.data as SocketData) = { userId, sessionId };
      next();
    });

    ns.on("connection", async (socket: Socket) => {
      const { userId, sessionId } = socket.data as SocketData;
      const room = roomName(sessionId);
      type Ack = (res: unknown) => void;

      // handlers first, before anything is awaited: an early client event is never lost
      socket.on(PEER_ROOM_EVENTS.docUpdate, async (payload: unknown, ack?: Ack) => {
        const update = asBytes(payload);
        if (!update || !(await rooms.apply(sessionId, update))) {
          ack?.({ ok: false, code: "UPDATE_REFUSED" });
          return;
        }
        socket.to(room).emit(PEER_ROOM_EVENTS.docUpdate, { update });
        ack?.({ ok: true });
      });
      socket.on(PEER_ROOM_EVENTS.signal, async (payload: unknown, ack?: Ack) => {
        const parsed = peerSignalSchema.safeParse(payload);
        if (!parsed.success) return void ack?.({ ok: false, code: "VALIDATION_ERROR" });
        try {
          await ctx.limiter.enforce(`peer-signal:${userId}`, 300, 60, "call signals");
        } catch {
          return void ack?.({ ok: false, code: "RATE_LIMITED" });
        }
        socket.to(room).emit(PEER_ROOM_EVENTS.signal, { signal: parsed.data });
        ack?.({ ok: true });
      });
      socket.on("disconnect", async () => {
        const gone = await rooms.leave(sessionId, userId);
        if (gone) socket.to(room).emit(PEER_ROOM_EVENTS.peerLeft, {});
      });

      await socket.join(room);
      const { state, first } = await rooms.join(sessionId, userId);
      const online = rooms.online(sessionId);
      socket.emit(PEER_ROOM_EVENTS.hello, {
        sessionId,
        partnerOnline: online.some((u) => u !== userId),
      });
      socket.emit(PEER_ROOM_EVENTS.docSync, { update: Buffer.from(state) });
      if (first) socket.to(room).emit(PEER_ROOM_EVENTS.peerJoined, {});
    });

    // every few seconds: save what changed, and close rooms whose session has ended
    const timer = setInterval(() => {
      void (async () => {
        try {
          await rooms.saveAll();
          for (const id of rooms.activeIds()) {
            const state = await svc.sessionState(ctx.db, id, ctx.now());
            if (state === "live") continue;
            ns.to(roomName(id)).emit(PEER_ROOM_EVENTS.ended, { state });
            ns.in(roomName(id)).disconnectSockets(true);
            await rooms.close(id);
          }
        } catch (err) {
          ctx.log.warn({ err: String(err) }, "peer room sweep failed");
        }
      })();
    }, SWEEP_MS);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await rooms.saveAll();
    };
  });
}

/** Socket.IO delivers a binary payload as a Buffer (or an ArrayBuffer); anything else is refused. */
function asBytes(payload: unknown): Uint8Array | null {
  const p = payload as { update?: unknown } | null;
  const u = p?.update;
  if (u instanceof Uint8Array) return u;
  if (u instanceof ArrayBuffer) return new Uint8Array(u);
  return null;
}
