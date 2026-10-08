import type { FastifyPluginAsync } from "fastify";

/**
 * AI interview endpoints. Everything here requires a verified email (it costs real money per
 * session). Only the access check exists so far; the interview engine arrives in Phase 6.
 */
export const interviewRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireVerifiedEmail);

  app.get("/interviews/access", async () => ({ allowed: true }));
};
