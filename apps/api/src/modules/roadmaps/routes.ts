import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const slugParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(80),
});

/** Topic roadmaps (P3) with the learner's progress through each node. */
export const roadmapRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/roadmaps", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.listRoadmaps(ctx.db, req.auth!.userId, ctx.now());
  });

  app.get("/roadmaps/:slug", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const { slug } = parse(slugParams, req.params);
    return svc.getRoadmap(ctx.db, req.auth!.userId, slug, ctx.now());
  });
};
