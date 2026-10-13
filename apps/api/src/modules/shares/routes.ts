import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createShareSchema } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.string().uuid() });
const tokenParams = z.object({ token: z.string().min(1).max(200) });

/** Shared reports (U5): the owner manages links; anyone with a link reads the filtered snapshot. */
export const shareRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;

  app.post(
    "/shares",
    { preHandler: [app.authenticate, app.requireVerifiedEmail] },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          await svc.createShare(ctx.db, uid(req), parse(createShareSchema, req.body), ctx.now()),
        ),
  );

  app.get("/shares", { preHandler: app.authenticate }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    return { items: await svc.listShares(ctx.db, uid(req), ctx.now()) };
  });

  app.delete("/shares/:id", { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.revokeShare(ctx.db, uid(req), id, ctx.now());
  });

  // public: no sign-in. A tighter budget than the global one, and never cached, so a revoked link is gone at once.
  const publicLimit = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

  app.get("/r/:token", publicLimit, async (req, reply) => {
    const { token } = parse(tokenParams, req.params);
    const report = await svc.openReport(ctx.db, token, ctx.now());
    reply.header("cache-control", "no-store");
    if (report.visibility === "unlisted") reply.header("x-robots-tag", "noindex, nofollow");
    return report;
  });

  app.get("/r/:token/og.png", publicLimit, async (req, reply) => {
    const { token } = parse(tokenParams, req.params);
    const png = await svc.reportImage(ctx.db, token, ctx.now());
    return reply
      .header("content-type", "image/png")
      .header("cache-control", "no-store")
      .header("cross-origin-resource-policy", "cross-origin")
      .send(png);
  });
};
