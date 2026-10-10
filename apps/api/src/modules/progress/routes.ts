import type { FastifyPluginAsync } from "fastify";
import type { Database } from "@prepquest/db";
import { dashboardQuerySchema } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as svc from "./service.js";

/** XP, badges and the dashboard (A1, A2). Always the caller's own data. */
export const progressRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/me/xp", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.getXp(db, req.auth!.userId);
  });

  app.get("/me/badges", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return { items: await svc.getBadges(db, req.auth!.userId) };
  });

  app.get("/me/dashboard", async (req, reply) => {
    const { range } = parse(dashboardQuerySchema, req.query);
    reply.header("cache-control", "no-store");
    return svc.getDashboard(db, req.auth!.userId, range);
  });
};
