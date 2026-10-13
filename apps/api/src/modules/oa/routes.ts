import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { oaAnswerSchema, oaStartSchema } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.string().uuid() });
const sectionParams = z.object({
  id: z.string().uuid(),
  index: z.coerce.number().int().min(0).max(20),
});

/** Aptitude tests and the online-assessment simulator (C2): server-side section clocks and answer key. */
export const oaRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  app.addHook("preHandler", app.authenticate);
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.get("/oa", async (req) => svc.getCatalog(ctx.db, uid(req), ctx.now()));

  app.post("/oa/attempts", async (req, reply) => {
    const { template } = parse(oaStartSchema, req.body);
    return reply.status(201).send(await svc.startAttempt(ctx.db, uid(req), template, ctx.now()));
  });

  app.get("/oa/attempts/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.getAttempt(ctx.db, uid(req), id, ctx.now());
  });

  app.post("/oa/attempts/:id/sections/:index/start", async (req) => {
    const { id, index } = parse(sectionParams, req.params);
    return svc.begin(ctx.db, uid(req), id, index, ctx.now());
  });

  app.put("/oa/attempts/:id/answers", async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.answer(ctx.db, uid(req), id, parse(oaAnswerSchema, req.body), ctx.now());
  });

  app.post("/oa/attempts/:id/submit-section", async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.submitCurrent(ctx.db, uid(req), id, ctx.now());
  });

  app.post("/oa/attempts/:id/finish", async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.finish(ctx.db, uid(req), id, ctx.now());
  });
};
