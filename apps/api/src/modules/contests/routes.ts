import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  contestEventSchema,
  createContestSchema,
  registerContestSchema,
  standingsQuerySchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const slugParams = z.object({ slug: z.string().min(2).max(90) });
const listQuery = z.object({ status: z.enum(["upcoming", "running", "past"]).optional() });
const codeQuery = z.object({ code: z.string().max(32).optional() });

/** Timed contests (D7): list, create, register, standings, virtual runs and integrity events. */
export const contestRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  app.addHook("preHandler", app.authenticate);
  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
  });
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;

  app.get("/contests", async (req) => {
    const { status } = parse(listQuery, req.query);
    return svc.listContests(ctx.db, uid(req), status, ctx.now());
  });

  app.post("/contests", { preHandler: app.requireVerifiedEmail }, async (req, reply) => {
    const body = parse(createContestSchema, req.body);
    const auth = req.auth!;
    const created = await svc.createContest(
      ctx.db,
      auth.userId,
      { role: auth.role, mfa: Boolean(auth.mfa) },
      body,
      ctx.now(),
    );
    return reply.status(201).send(created);
  });

  app.get("/contests/:slug", async (req) => {
    const { slug } = parse(slugParams, req.params);
    const { code } = parse(codeQuery, req.query);
    return svc.getContest(ctx.db, uid(req), slug, ctx.now(), code);
  });

  app.post("/contests/:slug/register", async (req) => {
    const { slug } = parse(slugParams, req.params);
    const { inviteCode } = parse(registerContestSchema, req.body ?? {});
    return svc.register(ctx.db, uid(req), slug, inviteCode, ctx.now());
  });

  app.get("/contests/:slug/standings", async (req) => {
    const { slug } = parse(slugParams, req.params);
    const { page } = parse(standingsQuerySchema, req.query);
    const { code } = parse(codeQuery, req.query);
    return svc.standings(ctx.db, uid(req), slug, page, ctx.now(), code);
  });

  app.get("/contests/:slug/me", async (req) => {
    const { slug } = parse(slugParams, req.params);
    return svc.me(ctx.db, uid(req), slug, ctx.now());
  });

  app.post("/contests/:slug/virtual", async (req) => {
    const { slug } = parse(slugParams, req.params);
    return svc.startVirtual(ctx.db, uid(req), slug, ctx.now());
  });

  app.post("/contests/:slug/events", async (req) => {
    const { slug } = parse(slugParams, req.params);
    const { type } = parse(contestEventSchema, req.body);
    return svc.recordEvent(ctx.db, uid(req), slug, type, ctx.now());
  });
};
