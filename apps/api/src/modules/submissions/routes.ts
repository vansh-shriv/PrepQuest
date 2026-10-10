import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  AppError,
  submissionCreateSchema,
  submissionListQuerySchema,
  submissionNoteSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.uuid() });

export const submissionRoutes: FastifyPluginAsync<{ ctx: svc.SubmissionCtx }> = async (
  app,
  { ctx },
) => {
  app.addHook("preHandler", app.authenticate);
  const { db } = ctx;

  app.post("/submissions", async (req, reply) => {
    const key = req.headers["idempotency-key"];
    if (key !== undefined && (typeof key !== "string" || key.length < 8 || key.length > 100)) {
      throw new AppError("VALIDATION_ERROR", 422, "Idempotency-Key must be 8 to 100 characters");
    }
    const input = parse(submissionCreateSchema, req.body);
    const { body, replay } = await svc.createSubmission(ctx, req.auth!.userId, input, key);
    // A replayed request gets the original answer, flagged so clients can tell.
    if (replay) reply.header("idempotent-replay", "true");
    return reply.status(202).send(body);
  });

  app.get("/submissions/:id", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    // verdicts change while the judge works; never cache
    reply.header("cache-control", "no-store");
    return svc.getSubmission(db, req.auth!.userId, id);
  });

  app.patch("/submissions/:id/note", async (req) => {
    const { id } = parse(idParams, req.params);
    const { note } = parse(submissionNoteSchema, req.body);
    return svc.setSubmissionNote(db, req.auth!.userId, id, note);
  });

  app.get("/submissions/:id/diff", async (req) => {
    const { id } = parse(idParams, req.params);
    const { against } = parse(z.object({ against: z.uuid() }), req.query);
    return svc.diffSubmissions(db, req.auth!.userId, id, against);
  });

  app.get("/me/submissions", async (req) =>
    svc.listSubmissions(db, req.auth!.userId, parse(submissionListQuerySchema, req.query)),
  );
};
