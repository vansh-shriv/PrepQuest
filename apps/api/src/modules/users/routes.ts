import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Db } from "@prepquest/db";
import { handleSchema } from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import { getPublicProfile } from "../me/service.js";

/** Public, unauthenticated profile pages. Only profiles the owner opted in to are visible. */
export const userRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get("/u/:handle", async (req, reply) => {
    const { handle } = parse(z.object({ handle: handleSchema }), req.params);
    return reply
      .header("cache-control", "public, max-age=60")
      .send(await getPublicProfile(db, handle));
  });
};
