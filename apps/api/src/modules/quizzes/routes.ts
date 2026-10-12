import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createQuizAttemptSchema, quizAnswerSchema } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.string().uuid() });

/** CS fundamentals quizzes (C1): practice, timed tests, topic drills and weak-area quizzes. */
export const quizRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  app.addHook("preHandler", app.authenticate);
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;

  app.get("/quizzes", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.getCatalog(ctx.db, uid(req));
  });

  app.post("/quizzes/attempts", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const body = parse(createQuizAttemptSchema, req.body);
    return reply.status(201).send(await svc.startAttempt(ctx.db, uid(req), body, ctx.now()));
  });

  app.get("/quizzes/attempts/:id", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const { id } = parse(idParams, req.params);
    return svc.getAttempt(ctx.db, uid(req), id);
  });

  app.post("/quizzes/attempts/:id/answers", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const { id } = parse(idParams, req.params);
    return svc.answer(ctx.db, uid(req), id, parse(quizAnswerSchema, req.body), ctx.now());
  });

  app.post("/quizzes/attempts/:id/finish", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const { id } = parse(idParams, req.params);
    return svc.finish(ctx.db, uid(req), id, ctx.now());
  });
};
