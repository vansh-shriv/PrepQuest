import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Database } from "@prepquest/db";
import { targetQuery } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as svc from "./service.js";

const trendsQuery = z.object({
  type: z.enum(["dsa", "project", "resume", "cs", "behavioral", "lld", "hld"]).optional(),
  company: z.string().max(120).optional(),
  persona: z.enum(["friendly", "neutral", "strict", "rapid"]).optional(),
  includeAbandoned: z.enum(["true", "false"]).optional(),
});
const timeQuery = z.object({ difficulty: z.enum(["easy", "medium", "hard"]).optional() });
const idParams = z.object({ id: z.string().uuid() });

/** Topic mastery, recommendations, interview trends, time analysis, readiness and the diagnostic (A2 to A5). */
export const analyticsRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.addHook("preHandler", app.authenticate);
  const noStore = (reply: { header: (k: string, v: string) => unknown }) =>
    reply.header("cache-control", "no-store");
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
  const now = () => app.ai.now();

  app.get("/me/analytics/topics", async (req, reply) => {
    noStore(reply);
    const { target } = parse(targetQuery, req.query);
    return svc.getTopics(db, uid(req), target, now());
  });

  app.get("/me/analytics/interviews", async (req, reply) => {
    noStore(reply);
    const q = parse(trendsQuery, req.query);
    return svc.getTrends(
      db,
      uid(req),
      { ...q, includeAbandoned: q.includeAbandoned === "true" },
      now(),
    );
  });

  app.get("/me/analytics/time", async (req, reply) => {
    noStore(reply);
    const { difficulty } = parse(timeQuery, req.query);
    return svc.getTimeAnalytics(db, uid(req), difficulty, now());
  });

  app.get("/me/readiness", async (req, reply) => {
    noStore(reply);
    const { target } = parse(targetQuery, req.query);
    return svc.getReadiness(db, uid(req), target, now());
  });

  app.get("/me/readiness/history", async (req, reply) => {
    noStore(reply);
    const { target } = parse(targetQuery, req.query);
    return svc.getReadinessHistory(db, uid(req), target, now());
  });

  app.post("/me/diagnostic", async (req, reply) => {
    noStore(reply);
    return reply.status(201).send(await svc.startDiagnostic(db, uid(req), now()));
  });

  app.get("/me/diagnostic/:id", async (req, reply) => {
    noStore(reply);
    const { id } = parse(idParams, req.params);
    return svc.getDiagnostic(db, uid(req), id);
  });
};
