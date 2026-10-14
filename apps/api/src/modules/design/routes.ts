import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createDesignCanvasSchema, saveDesignCanvasSchema } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.string().uuid() });
const slugParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60),
});

/** System design practice (C3). */
export const designRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  app.addHook("preHandler", app.authenticate);
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;

  app.get("/design/prompts", async (req) => ({ items: await svc.listPrompts(ctx.db, uid(req)) }));

  app.get("/design/prompts/:slug", async (req) =>
    svc.getPrompt(ctx.db, uid(req), parse(slugParams, req.params).slug),
  );

  app.get("/design/prompts/:slug/reference", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.reference(ctx.db, uid(req), parse(slugParams, req.params).slug);
  });

  app.get("/design/canvases", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return { items: await svc.listCanvases(ctx.db, uid(req)) };
  });

  app.post("/design/canvases", async (req, reply) =>
    reply
      .status(201)
      .send(
        await svc.createCanvas(
          ctx.db,
          uid(req),
          parse(createDesignCanvasSchema, req.body).promptSlug,
        ),
      ),
  );

  app.get("/design/canvases/:id", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.getCanvas(ctx.db, uid(req), parse(idParams, req.params).id);
  });

  app.put("/design/canvases/:id", async (req) =>
    svc.saveCanvas(
      ctx.db,
      uid(req),
      parse(idParams, req.params).id,
      parse(saveDesignCanvasSchema, req.body),
    ),
  );

  app.delete("/design/canvases/:id", async (req, reply) => {
    await svc.deleteCanvas(ctx.db, uid(req), parse(idParams, req.params).id);
    return reply.status(204).send();
  });

  // a review costs a model call: verified email like the other AI features
  app.post(
    "/design/canvases/:id/review",
    { preHandler: app.requireVerifiedEmail },
    async (req, reply) =>
      reply
        .status(202)
        .send(await svc.requestReview(ctx, uid(req), parse(idParams, req.params).id)),
  );
};
