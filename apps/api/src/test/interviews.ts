import { randomUUID } from "node:crypto";
import type { ServerEvent } from "../modules/interviews/bus.js";
import { bearer, type TestApp } from "./helpers.js";
import { PDF_MIME, SAMPLE_RESUME_LINES, makePdf, multipartFile } from "./documents.js";

// Helpers shared by the interview test files.

export interface SessionDto {
  id: string;
  state: string;
  hintsLeft: number;
  hintsGiven: number;
  remainingMs: number;
  endedAt: string | null;
  endReason: string | null;
  paused: boolean;
  questions: { kind: string; hidden: boolean; slug?: string; title?: string; sourceRef?: string }[];
  questionIndex: number;
}

export interface MessageResultDto {
  candidateSeq: number;
  replay: boolean;
  replies: {
    seq: number;
    turnId: string;
    text: string;
    intent: string;
    hintUsed: boolean;
    state: string;
  }[];
  state: string;
  ended: boolean;
}

export class Interviews {
  constructor(
    readonly t: TestApp,
    readonly token: string,
  ) {}

  call(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return this.t.app.inject({
      method,
      url: `/v1${url}`,
      headers: { ...bearer(this.token), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  }

  async create(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const res = await this.call("POST", "/interviews", { type: "dsa", ...body }, headers);
    return { res, body: res.json<{ session: SessionDto; wsTicket: string }>() };
  }

  /** Creates and starts a session, waiting for the greeting. */
  async startNew(body: Record<string, unknown> = {}) {
    const { res, body: created } = await this.create(body);
    if (res.statusCode !== 201) throw new Error(`create failed: ${res.body}`);
    const id = created.session.id;
    const started = await this.call("POST", `/interviews/${id}/start`);
    if (started.statusCode !== 200) throw new Error(`start failed: ${started.body}`);
    await this.t.idle();
    return id;
  }

  async say(id: string, text: string, clientMsgId: string = randomUUID()) {
    const res = await this.call("POST", `/interviews/${id}/messages`, { clientMsgId, text });
    return { res, body: res.json<MessageResultDto>() };
  }

  async get(id: string) {
    const res = await this.call("GET", `/interviews/${id}`);
    return res.json<{
      session: SessionDto;
      turns: { seq: number; speaker: string; text: string; offsetMs: number }[];
    }>();
  }

  async end(id: string) {
    const res = await this.call("POST", `/interviews/${id}/end`);
    await this.t.idle();
    return res;
  }

  /** Records every bus event of a session. */
  listen(id: string) {
    const events: ServerEvent[] = [];
    const stop = this.t.app.interviews.bus.subscribe(id, (e) => events.push(e));
    return {
      events,
      stop,
      of: <T extends ServerEvent["type"]>(type: T) =>
        events.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type),
    };
  }
}

/** Uploads, parses and confirms a resume; returns its id. */
export async function readyResume(t: TestApp, token: string): Promise<string> {
  const { payload, contentType } = multipartFile("cv.pdf", makePdf(SAMPLE_RESUME_LINES), PDF_MIME);
  const up = await t.app.inject({
    method: "POST",
    url: "/v1/resumes",
    payload,
    headers: { ...bearer(token), "content-type": contentType },
  });
  const id = up.json<{ id: string }>().id;
  await t.idle();
  const got = await t.app.inject({
    method: "GET",
    url: `/v1/resumes/${id}`,
    headers: bearer(token),
  });
  const parsed = got.json<{ parsed: unknown }>().parsed;
  await t.app.inject({
    method: "PATCH",
    url: `/v1/resumes/${id}/parsed`,
    headers: bearer(token),
    payload: { parsed, confirm: true },
  });
  return id;
}

/** Moves the application clock; the interview timer and sweeper read it. */
export function setClock(t: TestApp, at: Date | (() => Date)) {
  t.app.ai.now = typeof at === "function" ? at : () => at;
}
export function resetClock(t: TestApp) {
  t.app.ai.now = () => new Date();
}
