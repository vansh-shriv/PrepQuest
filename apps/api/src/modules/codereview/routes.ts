import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  REVIEW_STRICTNESS,
  complexityCreateSchema,
  reviewCreateSchema,
  codeReviewSettingsSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as complexity from "./complexity.js";
import * as review from "./review.js";

const idParams = z.object({ id: z.string().uuid() });
const reviewQuery = z.object({ strictness: z.enum(REVIEW_STRICTNESS).optional() });

/** Code review mode (X3) and the complexity analyzer (X4), both started from a submission. */
export const codeReviewRoutes: FastifyPluginAsync<{ ctx: review.ReviewCtx }> = async (
  app,
  { ctx },
) => {
  app.addHook("preHandler", app.authenticate);
  const db = ctx.ai.db;
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;

  app.get("/code-review/settings", async (req) => ({
    strictness: await review.getStrictness(db, uid(req)),
  }));

  app.put("/code-review/settings", async (req) =>
    review.saveStrictness(db, uid(req), parse(codeReviewSettingsSchema, req.body).strictness),
  );

  // a review costs a model call, so it needs a verified email like the other AI features
  app.post(
    "/submissions/:id/review",
    { preHandler: app.requireVerifiedEmail },
    async (req, reply) => {
      const { id } = parse(idParams, req.params);
      const dto = await review.createReview(
        ctx,
        uid(req),
        id,
        parse(reviewCreateSchema, req.body ?? {}),
      );
      return reply.status(202).send(dto);
    },
  );

  app.get("/submissions/:id/review", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    reply.header("cache-control", "no-store");
    const { strictness } = parse(reviewQuery, req.query);
    return { review: await review.getReview(db, uid(req), id, strictness) };
  });

  app.post("/submissions/:id/complexity", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const dto = await complexity.startComplexity(
      ctx,
      uid(req),
      id,
      parse(complexityCreateSchema, req.body),
    );
    return reply.status(202).send(dto);
  });

  app.get("/submissions/:id/complexity", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    reply.header("cache-control", "no-store");
    return {
      ...(await complexity.supportsComplexity(db, uid(req), id)),
      analysis: await complexity.getComplexity(db, uid(req), id),
    };
  });
};
