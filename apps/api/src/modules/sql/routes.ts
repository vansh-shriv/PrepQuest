import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { sqlQuerySchema } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const slugParams = z.object({ slug: z.string().min(2).max(80) });

/** SQL practice (C1): schema explorer, run and submit against an isolated in-memory dataset. */
export const sqlRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  app.addHook("preHandler", app.authenticate);
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
  // Each run starts a worker, so it gets its own, tighter budget than the global one.
  const limited = { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } };

  app.get("/sql/problems", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.listProblems(ctx.db, uid(req));
  });

  app.get("/sql/problems/:slug", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const { slug } = parse(slugParams, req.params);
    return svc.getProblem(ctx.db, uid(req), slug);
  });

  app.post("/sql/problems/:slug/run", limited, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const { slug } = parse(slugParams, req.params);
    const { query } = parse(sqlQuerySchema, req.body);
    return svc.run(ctx.db, slug, query);
  });

  app.post("/sql/problems/:slug/submit", limited, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const { slug } = parse(slugParams, req.params);
    const { query } = parse(sqlQuerySchema, req.body);
    return svc.submit(ctx.db, uid(req), slug, query, ctx.now());
  });
};
