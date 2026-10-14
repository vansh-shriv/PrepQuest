import { z } from "zod";

// Contracts for the live peer room (X1): the socket channel, audio signalling, the shared drawing and the
// interviewer's suggestions. Shared by API and web.

export const PEER_ROOM_LIMITS = {
  /** One Yjs update (a paste of code or a long stroke) over the socket. */
  updateBytes: 48 * 1024,
  /** The whole shared document (code and drawing) kept for a session. */
  docBytes: 512 * 1024,
  /** A session description or ICE candidate. */
  signalChars: 16 * 1024,
  /** Interviewer suggestions: one every 20 s, 12 in a session, 4 shown per request. */
  suggestionGapMs: 20_000,
  suggestionsPerSession: 12,
  suggestionsPerRequest: 4,
  suggestionChars: 240,
  codeChars: 6000,
} as const;

/** Events a client sends and receives on the `/peer` socket namespace. */
export const PEER_ROOM_EVENTS = {
  hello: "room.hello",
  peerJoined: "room.peer_joined",
  peerLeft: "room.peer_left",
  docSync: "doc.sync",
  docUpdate: "doc.update",
  signal: "rtc.signal",
  ended: "room.ended",
} as const;

export const peerSignalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("offer"), sdp: z.string().max(PEER_ROOM_LIMITS.signalChars) }),
  z.object({ kind: z.literal("answer"), sdp: z.string().max(PEER_ROOM_LIMITS.signalChars) }),
  z.object({
    kind: z.literal("candidate"),
    candidate: z
      .object({
        candidate: z.string().max(2000),
        sdpMid: z.string().max(100).nullish(),
        sdpMLineIndex: z.number().int().min(0).max(64).nullish(),
        usernameFragment: z.string().max(100).nullish(),
      })
      .nullable(),
  }),
  z.object({ kind: z.literal("hangup") }),
]);
export type PeerSignal = z.infer<typeof peerSignalSchema>;

export interface PeerRoomTicket {
  wsTicket: string;
}

export interface PeerIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface PeerRtcConfig {
  iceServers: PeerIceServer[];
  /** When the TURN credentials stop working (ISO), or null when none were issued. */
  expiresAt: string | null;
}

export interface PeerSuggestion {
  text: string;
  /** Why it is worth asking, one short line. */
  why: string;
}

export interface PeerSuggestionsDto {
  items: PeerSuggestion[];
  /** How many more requests this session allows. */
  remaining: number;
}

/** What the model returns for the interviewer's suggestions (checked in code before it is shown). */
export const peerSuggestionsSchema = z.object({
  items: z
    .array(
      z.object({ text: z.string().trim().min(1), why: z.string().trim().max(300).default("") }),
    )
    .max(8),
});
