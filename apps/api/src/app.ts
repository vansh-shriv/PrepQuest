import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { AppError, type ServerEnv } from "@prepquest/shared";
import { healthRoutes, type HealthChecks } from "./modules/health/routes.js";

export interface AppDeps {
  env: ServerEnv;
  checks: HealthChecks;
}

export async function buildApp({ env, checks }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : { level: env.LOG_LEVEL },
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(cors, { origin: env.CORS_ORIGINS.split(","), credentials: true });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.httpStatus).send({
        error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
      });
    }
    req.log.error(err);
    return reply
      .status(500)
      .send({ error: { code: "INTERNAL", message: "Internal server error", requestId: req.id } });
  });

  await app.register(healthRoutes, { prefix: "/v1", checks });
  return app;
}
