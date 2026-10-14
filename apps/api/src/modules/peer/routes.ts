import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createAvailabilitySchema,
  createPeerInviteSchema,
  matchRequestSchema,
  peerBlockSchema,
  peerConsentSchema,
  peerFeedbackSchema,
  peerReportSchema,
} from "@prepquest/shared";
import { randomBytes } from "node:crypto";
import type { Kv } from "../../lib/kv.js";
import { rtcConfig } from "../../lib/turn.js";
import { parse } from "../../lib/validate.js";
import { peerTicketKey } from "./gateway.js";
import type { RoomHub } from "./room.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.string().uuid() });
const tokenParams = z.object({ token: z.string().min(10).max(200) });

/** Peer mock interviews (X1). Everything needs a signed-in, verified user: partners see each other. */
const TICKET_TTL_SEC = 60;

export const peerRoutes: FastifyPluginAsync<{ ctx: AiContext; kv: Kv; rooms: RoomHub }> = async (
  app,
  { ctx, kv, rooms },
) => {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", app.requireVerifiedEmail);
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId;
  const noStore = (reply: { header: (k: string, v: string) => unknown }) =>
    reply.header("cache-control", "no-store");

  app.get("/peer/availability", async (req, reply) => {
    noStore(reply);
    return { items: await svc.listAvailability(ctx.db, uid(req), ctx.now()) };
  });
  app.post("/peer/availability", async (req, reply) =>
    reply
      .status(201)
      .send(
        await svc.addAvailability(
          ctx.db,
          uid(req),
          parse(createAvailabilitySchema, req.body),
          ctx.now(),
        ),
      ),
  );
  app.delete("/peer/availability/:id", async (req) =>
    svc.removeAvailability(ctx.db, uid(req), parse(idParams, req.params).id),
  );

  app.post("/peer/match", async (req, reply) => {
    await ctx.limiter.enforce(`peer-match:${uid(req)}`, 10, 86_400, "partner searches");
    const body = parse(matchRequestSchema, req.body);
    return reply.status(201).send(await svc.match(ctx.db, uid(req), body, ctx.now()));
  });

  app.get("/peer/invites", async (req, reply) => {
    noStore(reply);
    return { items: await svc.listInvites(ctx.db, uid(req), ctx.now()) };
  });
  app.post("/peer/invites", async (req, reply) =>
    reply
      .status(201)
      .send(
        await svc.createInvite(
          ctx.db,
          uid(req),
          parse(createPeerInviteSchema, req.body),
          ctx.now(),
        ),
      ),
  );
  app.delete("/peer/invites/:id", async (req) =>
    svc.revokeInvite(ctx.db, uid(req), parse(idParams, req.params).id, ctx.now()),
  );
  app.get("/peer/invites/:token", async (req, reply) => {
    noStore(reply);
    await ctx.limiter.enforce(`peer-invite:${uid(req)}`, 30, 3600, "invite lookups");
    return svc.previewInvite(ctx.db, uid(req), parse(tokenParams, req.params).token, ctx.now());
  });
  app.post("/peer/invites/:token/accept", async (req, reply) => {
    await ctx.limiter.enforce(`peer-invite:${uid(req)}`, 30, 3600, "invite lookups");
    return reply
      .status(201)
      .send(
        await svc.acceptInvite(ctx.db, uid(req), parse(tokenParams, req.params).token, ctx.now()),
      );
  });

  app.get("/peer/sessions", async (req, reply) => {
    noStore(reply);
    return { items: await svc.listSessions(ctx.db, uid(req), ctx.now()) };
  });
  app.get("/peer/sessions/:id", async (req, reply) => {
    noStore(reply);
    return svc.getSession(ctx.db, uid(req), parse(idParams, req.params).id, ctx.now());
  });
  app.post("/peer/sessions/:id/consent", async (req) =>
    svc.setConsent(
      ctx.db,
      uid(req),
      parse(idParams, req.params).id,
      parse(peerConsentSchema, req.body).ai,
      ctx.now(),
    ),
  );
  app.post("/peer/sessions/:id/open", async (req) =>
    svc.open(ctx.db, uid(req), parse(idParams, req.params).id, ctx.now()),
  );
  app.post("/peer/sessions/:id/complete", async (req) =>
    svc.complete(ctx.db, uid(req), parse(idParams, req.params).id, ctx.now()),
  );
  app.post("/peer/sessions/:id/cancel", async (req) =>
    svc.cancel(ctx.db, uid(req), parse(idParams, req.params).id, ctx.now()),
  );
  app.post("/peer/sessions/:id/no-show", async (req) =>
    svc.reportNoShow(ctx.db, uid(req), parse(idParams, req.params).id, ctx.now()),
  );
  app.post("/peer/sessions/:id/feedback", async (req) =>
    svc.giveFeedback(
      ctx.db,
      uid(req),
      parse(idParams, req.params).id,
      parse(peerFeedbackSchema, req.body),
    ),
  );
  // the live room: a single-use ticket for the socket, the call servers, and the interviewer's suggestions
  app.post("/peer/sessions/:id/room-ticket", async (req) => {
    const { id } = parse(idParams, req.params);
    await svc.roomAccess(ctx.db, uid(req), id, ctx.now());
    await ctx.limiter.enforce(`peer-ticket:${uid(req)}`, 60, 3600, "room connections");
    const ticket = randomBytes(24).toString("base64url");
    await kv.set(peerTicketKey(ticket), `${uid(req)}:${id}`, TICKET_TTL_SEC);
    return { wsTicket: ticket };
  });
  app.get("/peer/sessions/:id/rtc-config", async (req, reply) => {
    noStore(reply);
    const { id } = parse(idParams, req.params);
    await svc.roomAccess(ctx.db, uid(req), id, ctx.now());
    return rtcConfig(ctx.env, uid(req), ctx.now());
  });
  app.post("/peer/sessions/:id/suggestions", async (req, reply) => {
    noStore(reply);
    const { id } = parse(idParams, req.params);
    await svc.roomAccess(ctx.db, uid(req), id, ctx.now());
    return svc.suggest(ctx, uid(req), id, await rooms.code(id), ctx.now());
  });
  app.get("/peer/sessions/:id/calendar.ics", async (req, reply) => {
    const ics = await svc.calendar(
      ctx.db,
      uid(req),
      parse(idParams, req.params).id,
      ctx.now(),
      ctx.env.APP_URL,
    );
    return reply
      .header("content-type", "text/calendar; charset=utf-8")
      .header("content-disposition", 'attachment; filename="peer-mock.ics"')
      .header("cache-control", "no-store")
      .send(ics);
  });

  app.get("/peer/reputation", async (req, reply) => {
    noStore(reply);
    return svc.myReputation(ctx.db, uid(req));
  });

  app.post("/peer/report", async (req) => {
    await ctx.limiter.enforce(`peer-report:${uid(req)}`, 10, 86_400, "reports");
    return svc.report(ctx.db, uid(req), parse(peerReportSchema, req.body));
  });
  app.get("/peer/blocks", async (req, reply) => {
    noStore(reply);
    return { items: await svc.listBlocks(ctx.db, uid(req)) };
  });
  app.post("/peer/blocks", async (req) =>
    svc.block(ctx.db, uid(req), parse(peerBlockSchema, req.body).userId, ctx.now()),
  );
  app.delete("/peer/blocks/:id", async (req) =>
    svc.unblock(ctx.db, uid(req), parse(idParams, req.params).id),
  );
};
