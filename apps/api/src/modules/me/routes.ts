import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { z } from "zod";
import {
  AppError,
  profileUpdateSchema,
  settingsUpdateSchema,
  type ProfileUpdate,
  type SettingsUpdate,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as repo from "../auth/repo.js";

const PROFILE_COLUMNS: Record<keyof ProfileUpdate, string> = {
  displayName: "display_name",
  bio: "bio",
  college: "college",
  branch: "branch",
  gradYear: "grad_year",
  timezone: "timezone",
};

const SETTINGS_COLUMNS: Record<keyof SettingsUpdate, string> = {
  theme: "theme",
  readableMode: "readable_mode",
  retroCursor: "retro_cursor",
  sound: "sound",
  reducedMotion: "reduced_motion",
  hintMode: "hint_mode",
  defaultLanguage: "default_language",
};

function toColumns<T extends object>(
  input: T,
  map: Record<keyof T, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input) as Array<keyof T>) out[map[key]] = input[key];
  return out;
}

export const meRoutes: FastifyPluginAsync<{ pool: pg.Pool }> = async (app, { pool }) => {
  app.addHook("preHandler", app.authenticate);

  const currentUser = async (userId: string) => {
    const me = await repo.getMe(pool, userId);
    if (!me) throw new AppError("UNAUTHENTICATED", 401, "Account not found");
    return me;
  };

  app.get("/me", async (req) => currentUser(req.auth!.userId));

  app.patch("/me/profile", async (req) => {
    const userId = req.auth!.userId;
    const update = parse(profileUpdateSchema, req.body);
    await repo.updateColumns(pool, "profiles", userId, toColumns(update, PROFILE_COLUMNS));
    return currentUser(userId);
  });

  app.patch("/me/settings", async (req) => {
    const userId = req.auth!.userId;
    const update = parse(settingsUpdateSchema, req.body);
    await repo.updateColumns(pool, "user_settings", userId, toColumns(update, SETTINGS_COLUMNS));
    return currentUser(userId);
  });

  app.get("/me/sessions", async (req) => ({
    items: await repo.listActiveSessions(pool, req.auth!.userId, req.auth!.sessionId),
  }));

  app.delete("/me/sessions/:id", async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const revoked = await repo.revokeUserSession(pool, req.auth!.userId, id);
    if (!revoked) throw new AppError("NOT_FOUND", 404, "Session not found");
    return reply.status(204).send();
  });
};
