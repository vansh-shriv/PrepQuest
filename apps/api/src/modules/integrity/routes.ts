import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  INTEGRITY_REVIEW_ROLES,
  appealSchema,
  flagDecisionSchema,
  flagListQuerySchema,
  scanContestSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.string().uuid() });

/**
 * Integrity review (X2). Reviewers, admins and moderators work the queue; every decision is audited. Learners
 * see only the outcome and can appeal once.
 */
export const integrityRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  const reviewer = { preHandler: app.requireRole(...INTEGRITY_REVIEW_ROLES) };
  const actor = (req: { auth?: { userId: string; role: string }; ip: string }): svc.Actor => ({
    id: req.auth!.userId,
    role: req.auth!.role,
    ip: req.ip,
  });

  app.post("/admin/integrity/scan", reviewer, async (req) =>
    svc.scanContest(ctx.db, parse(scanContestSchema, req.body).contestSlug),
  );

  app.get("/admin/integrity/flags", reviewer, async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.listFlags(ctx.db, parse(flagListQuerySchema, req.query));
  });

  app.get("/admin/integrity/flags/:id", reviewer, async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.getFlag(ctx.db, parse(idParams, req.params).id);
  });

  app.patch("/admin/integrity/flags/:id", reviewer, async (req) =>
    svc.decide(
      ctx.db,
      actor(req),
      parse(idParams, req.params).id,
      parse(flagDecisionSchema, req.body),
      ctx.now(),
    ),
  );

  app.get("/me/integrity", { preHandler: app.authenticate }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    return { items: await svc.myNotices(ctx.db, req.auth!.userId) };
  });

  app.post("/me/integrity/:id/appeal", { preHandler: app.authenticate }, async (req) =>
    svc.appeal(
      ctx.db,
      req.auth!.userId,
      parse(idParams, req.params).id,
      parse(appealSchema, req.body).text,
      ctx.now(),
    ),
  );
};
