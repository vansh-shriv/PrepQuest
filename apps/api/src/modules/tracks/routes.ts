import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { trackCompareQuery } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const slugParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(80),
});

/** Company-specific prep tracks (P4). */
export const trackRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  app.addHook("preHandler", app.authenticate);
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;

  app.get("/tracks", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.listTracks(ctx.db, uid(req), ctx.now());
  });

  // registered before /tracks/:slug so "compare" is not read as a slug
  app.get("/tracks/compare", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const { a, b } = parse(trackCompareQuery, req.query);
    return svc.compareTracks(ctx.db, uid(req), a, b, ctx.now());
  });

  app.get("/tracks/:slug", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const { slug } = parse(slugParams, req.params);
    return svc.getTrack(ctx.db, uid(req), slug, ctx.now());
  });

  app.post("/tracks/:slug/start", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const { slug } = parse(slugParams, req.params);
    return reply.status(201).send(await svc.startTrack(ctx, uid(req), slug));
  });
};
