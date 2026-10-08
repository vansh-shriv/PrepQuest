import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  AppError,
  deleteAccountSchema,
  prepSchema,
  profileUpdateSchema,
  settingsUpdateSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as repo from "../auth/repo.js";
import type { AuthContext } from "../auth/service.js";
import * as me from "./service.js";

export const meRoutes: FastifyPluginAsync<{ ctx: AuthContext }> = async (app, { ctx }) => {
  const { db } = ctx;
  app.addHook("preHandler", app.authenticate);

  const currentUser = async (userId: string) => {
    const user = await repo.getMe(db, userId);
    if (!user) throw new AppError("UNAUTHENTICATED", 401, "Account not found");
    return user;
  };

  app.get("/me", async (req) => currentUser(req.auth!.userId));

  app.patch("/me/profile", async (req) => {
    const userId = req.auth!.userId;
    await repo.updateProfile(db, userId, parse(profileUpdateSchema, req.body));
    return currentUser(userId);
  });

  app.patch("/me/settings", async (req) => {
    const userId = req.auth!.userId;
    await repo.updateSettings(db, userId, parse(settingsUpdateSchema, req.body));
    return currentUser(userId);
  });

  app.get("/me/prep", async (req) => me.getPrep(db, req.auth!.userId));

  app.put("/me/prep", async (req) => me.putPrep(db, req.auth!.userId, parse(prepSchema, req.body)));

  app.get("/me/sessions", async (req) => ({
    items: await repo.listActiveSessions(db, req.auth!.userId, req.auth!.sessionId),
  }));

  app.delete("/me/sessions/:id", async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const revoked = await repo.revokeUserSession(db, req.auth!.userId, id);
    if (!revoked) throw new AppError("NOT_FOUND", 404, "Session not found");
    return reply.status(204).send();
  });

  // ---- data rights (doc 14 §7) ----

  /** Full JSON export. Built inline for now; moves to a background job once the worker exists. */
  app.post("/me/export", async (req, reply) => {
    const userId = req.auth!.userId;
    await ctx.limiter.enforce(`export:${userId}`, 3, 86_400, "data exports");
    const data = await me.exportData(db, userId);
    const handle = data.profile?.handle ?? "account";
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="prepquest-export-${handle}.json"`)
      .header("cache-control", "no-store")
      .send(JSON.stringify(data, null, 2));
  });

  app.delete("/me", async (req, reply) => {
    const input = parse(deleteAccountSchema, req.body);
    const purgeOn = await me.requestDeletion(ctx, req.auth!.userId, input);
    return reply.status(202).send({ purgeOn: purgeOn.toISOString() });
  });

  app.post("/me/cancel-deletion", async (req, reply) => {
    await me.cancelDeletion(db, req.auth!.userId);
    return reply.status(204).send();
  });
};
