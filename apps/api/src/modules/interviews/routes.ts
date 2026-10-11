import type { FastifyPluginAsync } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  createInterviewSchema,
  interviewCodeEventSchema,
  interviewFeedbackSchema,
  interviewMessageSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { Kv } from "../../lib/kv.js";
import type { AiContext } from "../ai-context.js";
import type { InterviewEngine } from "./engine.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.uuid() });
const WS_TICKET_TTL_SEC = 60;

export const wsTicketKey = (ticket: string) => `wsticket:${ticket}`;

/** Single-use, short-lived ticket binding a socket connection to one user and one session. */
export async function issueWsTicket(kv: Kv, userId: string, sessionId: string): Promise<string> {
  const ticket = randomBytes(24).toString("base64url");
  await kv.set(wsTicketKey(ticket), `${userId}:${sessionId}`, WS_TICKET_TTL_SEC);
  return ticket;
}

/**
 * AI interview endpoints (I1-I8, E1, E2, E5). Everything here requires a verified email: a session
 * costs real money. The live conversation runs over the WebSocket gateway; the REST `messages`
 * route is the equivalent fallback (and what the tests drive).
 */
export const interviewRoutes: FastifyPluginAsync<{
  ctx: AiContext;
  engine: InterviewEngine;
  kv: Kv;
}> = async (app, { ctx, engine, kv }) => {
  app.addHook("preHandler", app.requireVerifiedEmail);
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;

  app.get("/interviews/access", async () => ({ allowed: true }));
  app.get("/interview/templates", async () => ({ items: svc.templatesDto() }));

  app.post("/interviews/plan", async (req) =>
    svc.previewPlan(ctx, uid(req), parse(createInterviewSchema, req.body)),
  );

  app.post("/interviews", async (req, reply) => {
    const key = req.headers["idempotency-key"];
    const row = await svc.createSession(
      ctx,
      uid(req),
      parse(createInterviewSchema, req.body),
      typeof key === "string" && key.length <= 100 ? key : undefined,
    );
    const wsTicket = await issueWsTicket(kv, uid(req), row.id);
    return reply.status(201).send({ session: svc.toSessionDto(row, ctx.now()), wsTicket });
  });

  app.get("/interviews", async (req) => {
    const q = parse(
      z.object({
        cursor: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
      req.query,
    );
    return svc.listSessions(ctx.db, uid(req), q.cursor, q.limit);
  });

  app.get("/interviews/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const snap = await engine.snapshot(uid(req), id);
    return {
      session: svc.toSessionDto(snap.session, ctx.now()),
      turns: await svc.getTurns(ctx.db, id),
      state: snap.state,
    };
  });

  app.post("/interviews/:id/start", async (req) => {
    const { id } = parse(idParams, req.params);
    return { session: svc.toSessionDto(await engine.start(uid(req), id), ctx.now()) };
  });
  app.post("/interviews/:id/pause", async (req) => {
    const { id } = parse(idParams, req.params);
    return { session: svc.toSessionDto(await engine.pause(uid(req), id), ctx.now()) };
  });
  app.post("/interviews/:id/resume", async (req) => {
    const { id } = parse(idParams, req.params);
    return { session: svc.toSessionDto(await engine.resume(uid(req), id), ctx.now()) };
  });
  app.post("/interviews/:id/end", async (req) => {
    const { id } = parse(idParams, req.params);
    return { session: svc.toSessionDto(await engine.end(uid(req), id), ctx.now()) };
  });

  app.post("/interviews/:id/ws-ticket", async (req) => {
    const { id } = parse(idParams, req.params);
    await engine.getSession(id, uid(req));
    return { wsTicket: await issueWsTicket(kv, uid(req), id) };
  });

  app.post("/interviews/:id/messages", async (req) => {
    const { id } = parse(idParams, req.params);
    await ctx.limiter.enforce(`interview-msg:${uid(req)}`, 40, 60, "messages");
    return engine.sendMessage(uid(req), id, parse(interviewMessageSchema, req.body));
  });

  app.post("/interviews/:id/events", async (req) => {
    const { id } = parse(idParams, req.params);
    await ctx.limiter.enforce(`interview-evt:${uid(req)}`, 120, 60, "code events");
    return engine.codeEvent(uid(req), id, parse(interviewCodeEventSchema, req.body));
  });

  app.get("/interviews/:id/events", async (req) => {
    const { id } = parse(idParams, req.params);
    await engine.getSession(id, uid(req));
    const q = parse(
      z.object({
        from: z.coerce.number().int().min(0).default(0),
        to: z.coerce.number().int().optional(),
      }),
      req.query,
    );
    return { items: await svc.getEvents(ctx.db, id, q.from, q.to) };
  });

  app.get("/interviews/:id/review", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const s = await engine.getSession(id, uid(req));
    if (!s.startedAt)
      throw new AppError("INTERVIEW_NOT_ACTIVE", 409, "This interview has not started.");
    if (!s.endedAt)
      throw new AppError("INTERVIEW_NOT_ACTIVE", 409, "The interview is still in progress.");
    const review = await svc.getReview(ctx.db, s, ctx.now());
    return reply.status(review.status === "generating" ? 202 : 200).send(review);
  });

  app.post("/interviews/:id/review/retry", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await engine.getSession(id, uid(req));
    await svc.retryScorecard(ctx.db, id);
    ctx.jobs.run(`scorecard:${id}`, async () => engine.regenerateScorecard(id));
    return reply.status(202).send({ status: "generating" });
  });

  app.get("/interviews/:id/transcript", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { format } = parse(
      z.object({ format: z.enum(["json", "md"]).default("json") }),
      req.query,
    );
    const s = await engine.getSession(id, uid(req));
    if (format === "md") {
      reply.header("content-type", "text/markdown; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="interview-${id.slice(0, 8)}.md"`);
      return svc.transcriptMarkdown(ctx.db, s, ctx.now());
    }
    return { transcript: await svc.getTurns(ctx.db, id) };
  });

  app.post("/interviews/:id/annotations/:annId/note", async (req, reply) => {
    const { id, annId } = parse(idParams.extend({ annId: z.uuid() }), req.params);
    await engine.getSession(id, uid(req));
    const { note } = parse(z.object({ note: z.string().trim().max(1000).nullable() }), req.body);
    await svc.setAnnotationNote(ctx.db, id, annId, note);
    return reply.status(204).send();
  });

  app.post("/interviews/:id/feedback", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await engine.getSession(id, uid(req));
    const body = parse(interviewFeedbackSchema, req.body);
    await svc.saveFeedback(ctx.db, id, body.helpful, body.text ?? null);
    return reply.status(204).send();
  });
};
