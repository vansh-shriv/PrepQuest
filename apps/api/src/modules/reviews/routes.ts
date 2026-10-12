import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  reviewGradeSchema,
  reviewSettingsSchema,
  reviewSnoozeSchema,
  reviewSuspendSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.string().uuid() });

/** Spaced repetition of solved problems (D6): today's queue, grading, snooze, pause and the daily cap. */
export const reviewRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  app.addHook("preHandler", app.authenticate);
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;

  app.get("/me/reviews", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.getReviews(ctx.db, uid(req), ctx.now());
  });

  app.put("/me/reviews/settings", async (req) => {
    const { cap } = parse(reviewSettingsSchema, req.body);
    return svc.setReviewCap(ctx.db, uid(req), cap);
  });

  app.post("/me/reviews/:id/grade", async (req) => {
    const { id } = parse(idParams, req.params);
    const { rating } = parse(reviewGradeSchema, req.body);
    return svc.gradeReview(ctx.db, uid(req), id, rating, ctx.now());
  });

  app.post("/me/reviews/:id/snooze", async (req) => {
    const { id } = parse(idParams, req.params);
    const { days } = parse(reviewSnoozeSchema, req.body);
    return svc.snoozeReview(ctx.db, uid(req), id, days, ctx.now());
  });

  app.post("/me/reviews/:id/suspend", async (req) => {
    const { id } = parse(idParams, req.params);
    const { suspended } = parse(reviewSuspendSchema, req.body);
    return svc.suspendReview(ctx.db, uid(req), id, suspended);
  });
};
