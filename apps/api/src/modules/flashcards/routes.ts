import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createCardSchema,
  createDeckSchema,
  flashcardSettingsSchema,
  importDeckSchema,
  mistakesSchema,
  studyQuerySchema,
  syncReviewsSchema,
  updateCardSchema,
  updateDeckSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.string().uuid() });
const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/) });

/** Flashcards (X6): decks, cards, the study queue, offline-safe review sync, import and export. */
export const flashcardRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  app.addHook("preHandler", app.authenticate);
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;

  app.get("/flashcards", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.overview(ctx.db, uid(req), ctx.now());
  });

  app.put("/flashcards/settings", async (req) =>
    svc.saveSettings(ctx.db, uid(req), parse(flashcardSettingsSchema, req.body)),
  );

  app.post("/flashcards/decks", async (req, reply) => {
    const deck = await svc.createDeck(ctx.db, uid(req), parse(createDeckSchema, req.body));
    return reply.status(201).send(await svc.getDeck(ctx.db, uid(req), deck.id, ctx.now()));
  });

  app.get("/flashcards/decks/:id", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    reply.header("cache-control", "no-store");
    return svc.getDeck(ctx.db, uid(req), id, ctx.now());
  });

  app.patch("/flashcards/decks/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.updateDeck(ctx.db, uid(req), id, parse(updateDeckSchema, req.body));
  });

  app.delete("/flashcards/decks/:id", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await svc.deleteDeck(ctx.db, uid(req), id);
    return reply.status(204).send();
  });

  app.get("/flashcards/decks/:id/export", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const deck = await svc.exportDeck(ctx.db, uid(req), id);
    const name =
      deck.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "deck";
    reply.header("content-disposition", `attachment; filename="${name}.deck.json"`);
    return deck;
  });

  app.post("/flashcards/decks/:id/cards", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(createCardSchema, req.body);
    return reply.status(201).send(await svc.addCard(ctx.db, uid(req), id, body, ctx.now()));
  });

  app.patch("/flashcards/cards/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.updateCard(ctx.db, uid(req), id, parse(updateCardSchema, req.body));
  });

  app.delete("/flashcards/cards/:id", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await svc.deleteCard(ctx.db, uid(req), id);
    return reply.status(204).send();
  });

  app.post("/flashcards/starters/:slug/adopt", async (req, reply) => {
    const { slug } = parse(slugParams, req.params);
    return reply.status(201).send(await svc.adoptStarter(ctx.db, uid(req), slug, ctx.now()));
  });

  app.get("/flashcards/study", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return svc.study(ctx.db, uid(req), parse(studyQuerySchema, req.query), ctx.now());
  });

  app.post("/flashcards/sync", async (req) => {
    const { reviews } = parse(syncReviewsSchema, req.body);
    return svc.sync(ctx.db, uid(req), reviews, ctx.now());
  });

  app.post("/flashcards/import", async (req, reply) =>
    reply
      .status(201)
      .send(await svc.importDeck(ctx.db, uid(req), parse(importDeckSchema, req.body), ctx.now())),
  );

  app.post("/flashcards/from-quiz", async (req) =>
    svc.addMistakes(ctx.db, uid(req), parse(mistakesSchema, req.body), ctx.now()),
  );
};
