import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database } from "@prepquest/db";
import {
  AppError,
  customTestSchema,
  draftSaveSchema,
  languageQuerySchema,
  problemListQuerySchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as svc from "./service.js";

const slugParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60),
});

export const problemRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  /** Public routes personalise the response when a valid access token is present. */
  const viewer = async (req: FastifyRequest): Promise<string | null> => {
    await app.optionalAuth(req);
    return req.auth?.userId ?? null;
  };

  app.get("/problems", async (req) =>
    svc.listProblems(db, parse(problemListQuerySchema, req.query), await viewer(req)),
  );

  app.get("/problems/:slug", async (req, reply) => {
    const { slug } = parse(slugParams, req.params);
    // statements rarely change; let browsers revalidate quickly instead of caching signed-in state
    reply.header("cache-control", "private, no-cache");
    return svc.getProblem(db, slug, await viewer(req));
  });

  app.get("/tags", async (req, reply) => {
    const { all } = parse(z.object({ all: z.enum(["1", "true"]).optional() }), req.query);
    reply.header("cache-control", "public, max-age=60");
    return svc.tagFacets(db, all !== undefined);
  });

  app.get("/companies", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60");
    return { items: await svc.companyFacets(db) };
  });

  app.get("/sheets", async (req) => ({ items: await svc.listSheets(db, await viewer(req)) }));

  app.get("/sheets/:slug", async (req) => {
    const { slug } = parse(slugParams, req.params);
    return svc.getSheet(db, slug, await viewer(req));
  });

  // ---- signed-in editor support: drafts and custom tests ----
  app.register(async (authed) => {
    authed.addHook("preHandler", authed.authenticate);

    const problemId = async (req: FastifyRequest) => {
      const { slug } = parse(slugParams, req.params);
      return (await svc.findVisibleProblem(db, slug)).id;
    };

    authed.get("/problems/:slug/draft", async (req) => {
      const { language } = parse(languageQuerySchema, req.query);
      return { draft: await svc.getDraft(db, req.auth!.userId, await problemId(req), language) };
    });

    authed.put("/problems/:slug/draft", async (req) => {
      const { language } = parse(languageQuerySchema, req.query);
      const body = parse(draftSaveSchema, req.body);
      return {
        draft: await svc.saveDraft(db, req.auth!.userId, await problemId(req), language, body),
      };
    });

    authed.get("/problems/:slug/draft-history", async (req) => {
      const { language } = parse(languageQuerySchema, req.query);
      return {
        items: await svc.draftHistoryFor(db, req.auth!.userId, await problemId(req), language),
      };
    });

    authed.get("/problems/:slug/custom-tests", async (req) => ({
      items: await svc.listCustomTests(db, req.auth!.userId, await problemId(req)),
    }));

    authed.post("/problems/:slug/custom-tests", async (req, reply) => {
      const body = parse(customTestSchema, req.body);
      const created = await svc.addCustomTest(db, req.auth!.userId, await problemId(req), body);
      return reply.status(201).send(created);
    });

    authed.delete("/problems/:slug/custom-tests/:id", async (req, reply) => {
      const { id } = parse(z.object({ id: z.uuid() }), req.params);
      const removed = await svc.deleteCustomTest(db, req.auth!.userId, await problemId(req), id);
      if (!removed) throw new AppError("NOT_FOUND", 404, "Custom test not found");
      return reply.status(204).send();
    });
  });
};
