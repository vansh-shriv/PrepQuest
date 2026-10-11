import type { InterviewSessionDto, InterviewTurnDto } from "@prepquest/shared";

// Pure state for the interview room: a reducer over server events, so reconnects, retractions and
// duplicate deliveries are easy to test. The server owns the truth; this only mirrors it.

export interface ChatItem {
  /** Stable React key: the turn id for interviewer text, the client id for the candidate's. */
  key: string;
  speaker: "interviewer" | "candidate" | "system";
  text: string;
  seq: number | null;
  offsetMs: number | null;
  streaming: boolean;
  hint: boolean;
  /** Sent but not yet confirmed by the server. */
  pending: boolean;
  failed: boolean;
}

export interface LiveState {
  state: string;
  segment: string;
  remainingMs: number;
  hintsLeft: number;
  paused: boolean;
  questionIndex: number;
  questionCount: number;
}

export interface RoomState {
  items: ChatItem[];
  live: LiveState | null;
  /** Wall-clock time (ms) at which `live.remainingMs` was true. */
  liveAt: number;
  typing: boolean;
  ended: { reason: string; scorecardStatus: string } | null;
  scorecardReady: boolean;
  lastSeq: number;
  error: string | null;
}

export const initialRoom: RoomState = {
  items: [],
  live: null,
  liveAt: 0,
  typing: false,
  ended: null,
  scorecardReady: false,
  lastSeq: 0,
  error: null,
};

export type RoomAction =
  | { type: "load"; turns: InterviewTurnDto[]; session: InterviewSessionDto; now: number }
  | { type: "merge"; turns: InterviewTurnDto[] }
  | { type: "sending"; clientMsgId: string; text: string }
  | { type: "send_failed"; clientMsgId: string; message: string }
  | { type: "candidate"; clientMsgId: string; seq: number; text: string; offsetMs: number }
  | { type: "token"; turnId: string; delta: string }
  | { type: "retract"; turnId: string }
  | { type: "message"; turnId: string; seq: number; text: string; offsetMs: number; hint: boolean }
  | { type: "typing"; on: boolean }
  | { type: "state"; live: LiveState; now: number }
  | { type: "tick"; remainingMs: number; now: number }
  | { type: "notice"; text: string; id: string }
  | { type: "ended"; reason: string; scorecardStatus: string }
  | { type: "scorecard_ready" }
  | { type: "error"; message: string | null };

const fromTurn = (t: InterviewTurnDto): ChatItem => ({
  key: t.speaker === "candidate" ? `seq-${t.seq}` : t.turnId,
  speaker: t.speaker,
  text: t.text,
  seq: t.seq,
  offsetMs: t.offsetMs,
  streaming: false,
  hint: t.hintUsed,
  pending: false,
  failed: false,
});

const liveFromSession = (s: InterviewSessionDto): LiveState => ({
  state: s.state,
  segment: "",
  remainingMs: s.remainingMs,
  hintsLeft: s.hintsLeft,
  paused: s.paused,
  questionIndex: s.questionIndex,
  questionCount: s.questions.length,
});

function sortItems(items: ChatItem[]): ChatItem[] {
  // confirmed turns by seq; anything still in flight stays at the end in arrival order
  const confirmed = items
    .filter((i) => i.seq !== null)
    .sort((a, b) => (a.seq as number) - (b.seq as number));
  const inflight = items.filter((i) => i.seq === null);
  return [...confirmed, ...inflight];
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case "load": {
      const items = action.turns.filter((t) => t.speaker !== "system").map(fromTurn);
      // a reload must not wipe what is still arriving: keep in-flight bubbles the stored turns don't cover yet
      const stored = new Set(items.map((i) => i.key));
      const newest = action.turns.at(-1)?.seq ?? 0;
      // also keep anything newer than this snapshot: a slow reload can finish after live events
      const inflight = state.items.filter(
        (i) => !stored.has(i.key) && (i.seq === null || i.seq > newest),
      );
      return {
        ...state,
        items: [...items, ...inflight],
        lastSeq: Math.max(state.lastSeq, newest),
        live: liveFromSession(action.session),
        liveAt: action.now,
        ended: action.session.endedAt
          ? { reason: action.session.endReason ?? "", scorecardStatus: "" }
          : null,
      };
    }
    case "merge": {
      const seen = new Set(state.items.map((i) => i.seq).filter((s): s is number => s !== null));
      const add = action.turns
        .filter((t) => t.speaker !== "system" && !seen.has(t.seq))
        .map(fromTurn);
      // a streaming bubble for the same turn id is replaced by its stored version
      const ids = new Set(add.map((a) => a.key));
      const kept = state.items.filter((i) => !(i.streaming && ids.has(i.key)));
      return {
        ...state,
        items: sortItems([...kept, ...add]),
        lastSeq: Math.max(state.lastSeq, ...action.turns.map((t) => t.seq)),
      };
    }
    case "sending":
      return {
        ...state,
        error: null,
        items: [
          ...state.items.filter((i) => i.key !== action.clientMsgId),
          {
            key: action.clientMsgId,
            speaker: "candidate",
            text: action.text,
            seq: null,
            offsetMs: null,
            streaming: false,
            hint: false,
            pending: true,
            failed: false,
          },
        ],
      };
    case "send_failed":
      return {
        ...state,
        error: action.message,
        items: state.items.map((i) =>
          i.key === action.clientMsgId ? { ...i, pending: false, failed: true } : i,
        ),
      };
    case "candidate": {
      const mine = state.items.find((i) => i.key === action.clientMsgId);
      const confirmed: ChatItem = {
        key: action.clientMsgId,
        speaker: "candidate",
        text: action.text,
        seq: action.seq,
        offsetMs: action.offsetMs,
        streaming: false,
        hint: false,
        pending: false,
        failed: false,
      };
      const exists = state.items.some((i) => i.seq === action.seq);
      const items = mine
        ? state.items.map((i) => (i.key === action.clientMsgId ? confirmed : i))
        : exists
          ? state.items
          : [...state.items, confirmed];
      return { ...state, items: sortItems(items), lastSeq: Math.max(state.lastSeq, action.seq) };
    }
    case "token": {
      const found = state.items.some((i) => i.key === action.turnId);
      const items = found
        ? state.items.map((i) =>
            i.key === action.turnId ? { ...i, text: i.text + action.delta, streaming: true } : i,
          )
        : [
            ...state.items,
            {
              key: action.turnId,
              speaker: "interviewer" as const,
              text: action.delta,
              seq: null,
              offsetMs: null,
              streaming: true,
              hint: false,
              pending: false,
              failed: false,
            },
          ];
      return { ...state, items };
    }
    case "retract":
      return { ...state, items: state.items.filter((i) => i.key !== action.turnId) };
    case "message": {
      const exists = state.items.some((i) => i.key === action.turnId);
      const done: ChatItem = {
        key: action.turnId,
        speaker: "interviewer",
        text: action.text,
        seq: action.seq,
        offsetMs: action.offsetMs,
        streaming: false,
        hint: action.hint,
        pending: false,
        failed: false,
      };
      const items = exists
        ? state.items.map((i) => (i.key === action.turnId ? done : i))
        : state.items.some((i) => i.seq === action.seq)
          ? state.items
          : [...state.items, done];
      return { ...state, items: sortItems(items), lastSeq: Math.max(state.lastSeq, action.seq) };
    }
    case "typing":
      return { ...state, typing: action.on };
    case "state":
      return { ...state, live: action.live, liveAt: action.now };
    case "tick":
      return state.live
        ? { ...state, live: { ...state.live, remainingMs: action.remainingMs }, liveAt: action.now }
        : state;
    case "notice":
      return {
        ...state,
        items: [
          ...state.items,
          {
            key: `notice-${action.id}`,
            speaker: "system",
            text: action.text,
            seq: null,
            offsetMs: null,
            streaming: false,
            hint: false,
            pending: false,
            failed: false,
          },
        ],
      };
    case "ended":
      return {
        ...state,
        ended: { reason: action.reason, scorecardStatus: action.scorecardStatus },
        typing: false,
      };
    case "scorecard_ready":
      return { ...state, scorecardReady: true };
    case "error":
      return { ...state, error: action.message };
  }
}

/** Remaining time right now, extrapolated from the last server reading (frozen while paused). */
export function remainingNow(s: RoomState, now: number): number {
  if (!s.live) return 0;
  if (s.live.paused || s.ended) return s.live.remainingMs;
  return Math.max(0, s.live.remainingMs - (now - s.liveAt));
}
