import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  customTaskSchema,
  generatePlanSchema,
  goalTemplateSchema,
  patchPlanTaskSchema,
  patchTodayGoalsSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as goals from "./goals.js";
import * as plans from "./plan-service.js";

const idParams = z.object({ id: z.string().uuid() });
const diffQuery = z.object({
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(1).optional(),
});

/** The study plan (P1), daily goals (P2) and the dashboard quest board. Always the caller's own data. */
export const planningRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  app.addHook("preHandler", app.authenticate);
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
  const noStore = (reply: { header: (k: string, v: string) => unknown }) =>
    reply.header("cache-control", "no-store");

  app.get("/me/plan", async (req, reply) => {
    noStore(reply);
    return { plan: await plans.getPlan(ctx, uid(req)) };
  });

  app.post("/me/plan", async (req, reply) => {
    noStore(reply);
    const body = parse(generatePlanSchema, req.body ?? {});
    return reply.status(201).send({ plan: await plans.generateUserPlan(ctx, uid(req), body) });
  });

  app.post("/me/plan/replan", async (req, reply) => {
    noStore(reply);
    return { plan: await plans.replanUser(ctx, uid(req), "manual") };
  });

  app.get("/me/plan/diff", async (req, reply) => {
    noStore(reply);
    const q = parse(diffQuery, req.query);
    return { diff: await plans.getPlanDiff(ctx.db, uid(req), q.from, q.to) };
  });

  app.post("/me/plan/tasks", async (req, reply) => {
    const body = parse(customTaskSchema, req.body);
    return reply.status(201).send({ task: await plans.addCustomTask(ctx, uid(req), body) });
  });

  app.patch("/me/plan/tasks/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(patchPlanTaskSchema, req.body);
    return { task: await plans.patchTask(ctx, uid(req), id, body) };
  });

  app.get("/me/goals/template", async (req, reply) => {
    noStore(reply);
    return goals.getTemplate(ctx.db, uid(req));
  });

  app.put("/me/goals/template", async (req) => {
    const body = parse(goalTemplateSchema, req.body);
    return goals.putTemplate(ctx.db, uid(req), body);
  });

  app.get("/me/goals/today", async (req, reply) => {
    noStore(reply);
    return goals.getToday(ctx, uid(req));
  });

  app.patch("/me/goals/today", async (req) => {
    const body = parse(patchTodayGoalsSchema, req.body);
    return goals.patchToday(ctx, uid(req), body.items);
  });

  app.get("/me/quest-board", async (req, reply) => {
    noStore(reply);
    return goals.questBoard(ctx, uid(req));
  });
};
