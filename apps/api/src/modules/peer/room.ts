import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { peerSessions } from "@prepquest/db";
import { acceptUpdate } from "@prepquest/analytics-core";
import type { AiContext } from "../ai-context.js";

interface Room {
  doc: Y.Doc;
  /** Size of the whole document as one update: the cap applies to this, not to the sum of updates. */
  bytes: number;
  dirty: boolean;
  /** Open sockets per user, so a second tab does not count as a second person. */
  sockets: Map<string, number>;
}

const SAVE_EVERY_MS = 10_000;

/**
 * The shared editor and drawing of every live peer session, held in memory as a Yjs document. The server
 * keeps its own copy so a late joiner or a reconnecting browser gets everything, and saves it to the
 * session row every few seconds and when the room closes. Updates go through `acceptUpdate` first.
 */
export class RoomHub {
  private rooms = new Map<string, Room>();
  private loading = new Map<string, Promise<Room>>();

  constructor(private readonly ctx: AiContext) {}

  private async room(sessionId: string): Promise<Room> {
    const have = this.rooms.get(sessionId);
    if (have) return have;
    const pending = this.loading.get(sessionId);
    if (pending) return pending;
    const p = (async () => {
      const doc = new Y.Doc();
      const [row] = await this.ctx.db
        .select({ roomState: peerSessions.roomState })
        .from(peerSessions)
        .where(eq(peerSessions.id, sessionId));
      if (row?.roomState) Y.applyUpdate(doc, Buffer.from(row.roomState, "base64"));
      const room: Room = {
        doc,
        bytes: Y.encodeStateAsUpdate(doc).length,
        dirty: false,
        sockets: new Map(),
      };
      this.rooms.set(sessionId, room);
      return room;
    })().finally(() => this.loading.delete(sessionId));
    this.loading.set(sessionId, p);
    return p;
  }

  /** A person connected. Returns the whole document for them and whether this is their first connection. */
  async join(sessionId: string, userId: string) {
    const room = await this.room(sessionId);
    const n = room.sockets.get(userId) ?? 0;
    room.sockets.set(userId, n + 1);
    return { state: Y.encodeStateAsUpdate(room.doc), first: n === 0 };
  }

  /** A socket closed. Returns whether that person has no other connection, and saves when the room is empty. */
  async leave(sessionId: string, userId: string): Promise<boolean> {
    const room = this.rooms.get(sessionId);
    if (!room) return true;
    const n = (room.sockets.get(userId) ?? 1) - 1;
    if (n > 0) {
      room.sockets.set(userId, n);
      return false;
    }
    room.sockets.delete(userId);
    if (room.sockets.size === 0) await this.close(sessionId);
    return true;
  }

  /** Applies one client update. Returns false when it was refused (too big, or the document is full). */
  async apply(sessionId: string, update: Uint8Array): Promise<boolean> {
    const room = await this.room(sessionId);
    if (!acceptUpdate(room.bytes, update.length)) return false;
    try {
      Y.applyUpdate(room.doc, update);
    } catch {
      return false;
    }
    room.bytes = Y.encodeStateAsUpdate(room.doc).length;
    room.dirty = true;
    return true;
  }

  /** The shared code as text, for the interviewer's suggestions. */
  async code(sessionId: string): Promise<{ text: string; language: string | null }> {
    const room = await this.room(sessionId);
    const lang = room.doc.getMap("meta").get("language");
    return {
      text: room.doc.getText("code").toString(),
      language: typeof lang === "string" ? lang : null,
    };
  }

  /** Saves every room that changed since the last save. */
  async saveAll(): Promise<void> {
    for (const id of [...this.rooms.keys()]) await this.save(id);
  }

  async save(sessionId: string): Promise<void> {
    const room = this.rooms.get(sessionId);
    if (!room?.dirty) return;
    room.dirty = false;
    try {
      await this.ctx.db
        .update(peerSessions)
        .set({ roomState: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64") })
        .where(eq(peerSessions.id, sessionId));
    } catch (err) {
      room.dirty = true;
      this.ctx.log.warn({ err: String(err), sessionId }, "saving a peer room failed");
    }
  }

  /** Saves and forgets a room (everyone left, or the session ended). */
  async close(sessionId: string): Promise<void> {
    await this.save(sessionId);
    const room = this.rooms.get(sessionId);
    // someone joined while it was being saved: keep it
    if (!room || room.sockets.size > 0) return;
    room.doc.destroy();
    this.rooms.delete(sessionId);
  }

  activeIds(): string[] {
    return [...this.rooms.keys()];
  }

  /** Who is connected right now, by user id. */
  online(sessionId: string): string[] {
    return [...(this.rooms.get(sessionId)?.sockets.keys() ?? [])];
  }

  static saveEveryMs = SAVE_EVERY_MS;
}
