import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Database } from "@prepquest/db";
import { giveUpSchema, ratingSchema } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as svc from "./service.js";

const slugParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60),
});
const tierParams = slugParams.extend({ tier: z.coerce.number().int().min(1).max(3) });

/** Hints, editorial and self-rating (D4, D5). All of it is signed-in only and enforced server side. */
export const practiceRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/problems/:slug/hints", async (req, reply) => {
    const { slug } = parse(slugParams, req.params);
    reply.header("cache-control", "no-store");
    return svc.getHints(db, req.auth!.userId, slug);
  });

  app.post("/problems/:slug/hints/:tier/unlock", async (req, reply) => {
    const { slug, tier } = parse(tierParams, req.params);
    reply.header("cache-control", "no-store");
    return svc.unlockHint(db, req.auth!.userId, slug, tier);
  });

  app.get("/problems/:slug/editorial", async (req, reply) => {
    const { slug } = parse(slugParams, req.params);
    reply.header("cache-control", "no-store");
    return svc.getEditorial(db, req.auth!.userId, slug);
  });

  app.get("/problems/:slug/editorial/status", async (req, reply) => {
    const { slug } = parse(slugParams, req.params);
    reply.header("cache-control", "no-store");
    return svc.editorialStatus(db, req.auth!.userId, slug);
  });

  app.post("/problems/:slug/editorial/give-up", async (req) => {
    const { slug } = parse(slugParams, req.params);
    parse(giveUpSchema, req.body);
    return svc.giveUp(db, req.auth!.userId, slug);
  });

  app.post("/problems/:slug/rating", async (req) => {
    const { slug } = parse(slugParams, req.params);
    const { rating } = parse(ratingSchema, req.body);
    return svc.rateSolve(db, req.auth!.userId, slug, rating);
  });
};
