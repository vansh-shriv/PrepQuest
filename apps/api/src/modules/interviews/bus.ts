import { EventEmitter } from "node:events";

// In-process event bus between the engine and the WebSocket gateway. A multi-instance deployment
// swaps this for Redis pub/sub (doc 08 §3.3); the engine only sees `publish`.

export type ServerEvent =
  | { type: "interviewer.token"; turnId: string; delta: string }
  | { type: "interviewer.retract"; turnId: string }
  | {
      type: "interviewer.message";
      turnId: string;
      seq: number;
      text: string;
      offsetMs: number;
      meta: Record<string, unknown>;
    }
  | { type: "candidate.message"; seq: number; text: string; offsetMs: number; clientMsgId: string }
  | { type: "interviewer.typing"; on: boolean }
  | { type: "session.state"; state: SessionStateEvent }
  | { type: "timer.tick"; remainingMs: number; warning?: "10m" | "5m" | "1m" }
  | { type: "system.notice"; code: string; text: string }
  | { type: "session.ended"; reason: string; scorecardStatus: string }
  | { type: "scorecard.ready" }
  | { type: "error"; code: string; message: string };

export interface SessionStateEvent {
  state: string;
  segment: string;
  remainingMs: number;
  hintsLeft: number;
  paused: boolean;
  questionIndex: number;
  questionCount: number;
}

export interface InterviewBus {
  publish(sessionId: string, event: ServerEvent): void;
  subscribe(sessionId: string, handler: (event: ServerEvent) => void): () => void;
}

export class MemoryBus implements InterviewBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(sessionId: string, event: ServerEvent): void {
    this.emitter.emit(sessionId, event);
  }

  subscribe(sessionId: string, handler: (event: ServerEvent) => void): () => void {
    this.emitter.on(sessionId, handler);
    return () => this.emitter.off(sessionId, handler);
  }
}

/** Test helper: records everything published to a session. */
export class RecordingBus extends MemoryBus {
  readonly events: { sessionId: string; event: ServerEvent }[] = [];

  override publish(sessionId: string, event: ServerEvent): void {
    this.events.push({ sessionId, event });
    super.publish(sessionId, event);
  }

  of<T extends ServerEvent["type"]>(type: T) {
    return this.events
      .map((e) => e.event)
      .filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type);
  }
}
