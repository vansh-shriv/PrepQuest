import multipart from "@fastify/multipart";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AppError,
  adminListQuerySchema,
  createProblemSchema,
  reasonSchema,
  updateProblemSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as svc from "./service.js";
import { MAX_ZIP_BYTES } from "./zip.js";

const idParams = z.object({ id: z.uuid() });

export const adminRoutes: FastifyPluginAsync<{ ctx: svc.AdminContext }> = async (app, { ctx }) => {
  await app.register(multipart, { limits: { fileSize: MAX_ZIP_BYTES, files: 1, fields: 0 } });

  // every admin route needs a content role; admin/moderator tokens must also have passed 2FA
  app.addHook("preHandler", app.requireRole("content_editor", "reviewer", "admin"));

  const actor = (req: FastifyRequest): svc.Actor => ({
    id: req.auth!.userId,
    role: req.auth!.role,
    ip: req.ip,
  });
  const id = (req: FastifyRequest) => parse(idParams, req.params).id;

  app.get("/admin/problems", async (req) => ({
    items: await svc.listAdminProblems(ctx.db, parse(adminListQuerySchema, req.query)),
  }));

  app.post("/admin/problems", async (req, reply) => {
    const created = await svc.createProblem(ctx, actor(req), parse(createProblemSchema, req.body));
    return reply.status(201).send(created);
  });

  app.get("/admin/problems/:id", async (req) => svc.getAdminProblem(ctx, actor(req), id(req)));

  app.patch("/admin/problems/:id", async (req) =>
    svc.updateProblem(ctx, actor(req), id(req), parse(updateProblemSchema, req.body)),
  );

  app.get("/admin/problems/:id/validation", async (req) => svc.validateProblem(ctx, id(req)));

  app.get("/admin/problems/:id/versions", async (req) => ({
    items: await svc.listVersions(ctx.db, id(req)),
  }));

  app.post("/admin/problems/:id/tests/upload", async (req) => {
    if (!req.isMultipart())
      throw new AppError("VALIDATION_FAILED", 422, "Send the zip as multipart/form-data");
    const file = await req.file();
    if (!file) throw new AppError("VALIDATION_FAILED", 422, "No file uploaded");
    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        `The zip is larger than ${MAX_ZIP_BYTES / 1024 / 1024} MB`,
      );
    }
    return svc.uploadTests(ctx, actor(req), id(req), buffer);
  });

  app.post("/admin/problems/:id/submit-review", async (req) =>
    svc.submitForReview(ctx, actor(req), id(req)),
  );
  app.post("/admin/problems/:id/publish", async (req) =>
    svc.publishProblem(ctx, actor(req), id(req)),
  );
  app.post("/admin/problems/:id/archive", async (req) => {
    const { reason } = parse(reasonSchema, req.body);
    return svc.archiveProblem(ctx, actor(req), id(req), reason);
  });

  // the audit log is for reviewers and admins only
  app.get("/admin/audit", { preHandler: app.requireRole("reviewer", "admin") }, async (req) => {
    const { entityId } = parse(z.object({ entityId: z.uuid().optional() }), req.query);
    return { items: await svc.listAudit(ctx.db, entityId) };
  });
};
