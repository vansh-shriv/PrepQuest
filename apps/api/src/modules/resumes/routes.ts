import multipart from "@fastify/multipart";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  AppError,
  RESUME_MAX_BYTES,
  createJdSchema,
  updateParsedResumeSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import type { AiContext } from "../ai-context.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.uuid() });

/** Resumes and job descriptions (I3). Needs a verified email: parsing costs model tokens. */
export const resumeRoutes: FastifyPluginAsync<{ ctx: AiContext }> = async (app, { ctx }) => {
  await app.register(multipart, { limits: { fileSize: RESUME_MAX_BYTES, files: 1, fields: 4 } });
  app.addHook("preHandler", app.requireVerifiedEmail);

  app.post("/resumes", async (req, reply) => {
    if (!req.isMultipart())
      throw new AppError("VALIDATION_FAILED", 422, "Send the file as multipart/form-data");
    const file = await req.file();
    if (!file) throw new AppError("VALIDATION_FAILED", 422, "No file uploaded");
    const buffer = await file.toBuffer();
    if (file.file.truncated)
      throw new AppError("VALIDATION_FAILED", 422, "The file is larger than 5 MB");
    const labelField = file.fields.label;
    const label =
      labelField &&
      !Array.isArray(labelField) &&
      "value" in labelField &&
      typeof labelField.value === "string"
        ? labelField.value
        : undefined;
    const dto = await svc.uploadResume(
      ctx,
      req.auth!.userId,
      { buffer, filename: file.filename, declaredMime: file.mimetype },
      label,
    );
    return reply.status(202).send(dto);
  });

  app.get("/resumes", async (req) => ({ items: await svc.listResumes(ctx.db, req.auth!.userId) }));

  app.get("/resumes/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.toResumeDto(await svc.getOwnedResume(ctx.db, req.auth!.userId, id));
  });

  app.patch("/resumes/:id/parsed", async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.updateParsed(
      ctx.db,
      req.auth!.userId,
      id,
      parse(updateParsedResumeSchema, req.body),
    );
  });

  app.post("/resumes/:id/retry", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    return reply.status(202).send(await svc.retryParse(ctx, req.auth!.userId, id));
  });

  app.put("/resumes/:id/default", async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.setDefault(ctx.db, req.auth!.userId, id);
  });

  app.delete("/resumes/:id", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await svc.deleteResume(ctx, req.auth!.userId, id);
    return reply.status(204).send();
  });

  app.post("/jds", async (req, reply) =>
    reply
      .status(201)
      .send(await svc.createJd(ctx, req.auth!.userId, parse(createJdSchema, req.body))),
  );
  app.get("/jds", async (req) => ({ items: await svc.listJds(ctx.db, req.auth!.userId) }));
  app.get("/jds/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    return svc.toJdDto(await svc.getJd(ctx.db, req.auth!.userId, id));
  });
  app.delete("/jds/:id", async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await svc.deleteJd(ctx.db, req.auth!.userId, id);
    return reply.status(204).send();
  });
};
