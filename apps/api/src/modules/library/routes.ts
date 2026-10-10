import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Database } from "@prepquest/db";
import { bookmarkSchema, noteSaveSchema, noteSearchQuerySchema } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as svc from "./service.js";

const slugParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60),
});

export const libraryRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/me/bookmarks", async (req) => ({
    items: await svc.listBookmarks(db, req.auth!.userId),
  }));

  app.put("/me/bookmarks/:slug", async (req) => {
    const { slug } = parse(slugParams, req.params);
    const { folder } = parse(bookmarkSchema, req.body ?? {});
    return svc.putBookmark(db, req.auth!.userId, slug, folder);
  });

  app.delete("/me/bookmarks/:slug", async (req, reply) => {
    const { slug } = parse(slugParams, req.params);
    await svc.removeBookmark(db, req.auth!.userId, slug);
    return reply.status(204).send();
  });

  app.get("/problems/:slug/note", async (req) => {
    const { slug } = parse(slugParams, req.params);
    return { note: await svc.getNote(db, req.auth!.userId, slug) };
  });

  app.put("/problems/:slug/note", async (req) => {
    const { slug } = parse(slugParams, req.params);
    const { bodyMd, baseVersion } = parse(noteSaveSchema, req.body);
    return svc.saveNote(db, req.auth!.userId, slug, bodyMd, baseVersion);
  });

  app.get("/me/notes", async (req) =>
    svc.searchNotes(db, req.auth!.userId, parse(noteSearchQuerySchema, req.query)),
  );
};
