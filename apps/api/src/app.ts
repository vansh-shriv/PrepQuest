import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type pg from "pg";
import { AppError, type ServerEnv } from "@prepquest/shared";
import type { Mailer } from "./lib/mailer.js";
import { authRoutes } from "./modules/auth/routes.js";
import type { JwtKeys } from "./modules/auth/keys.js";
import { healthRoutes, type HealthChecks } from "./modules/health/routes.js";
import { meRoutes } from "./modules/me/routes.js";
import { registerAuth } from "./plugins/auth.js";

export interface AppDeps {
  env: ServerEnv;
  pool: pg.Pool;
  keys: JwtKeys;
  mailer: Mailer;
  checks: HealthChecks;
  /** When set, rate-limit counters live in Redis (shared across instances); otherwise in memory. */
  redis?: Redis;
}

export async function buildApp({
  env,
  pool,
  keys,
  mailer,
  checks,
  redis,
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : { level: env.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie"] },
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && incoming.length <= 100
        ? incoming
        : crypto.randomUUID();
    },
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(","),
    credentials: true,
    // the plugin defaults to GET/HEAD/POST only, which blocks PATCH and DELETE preflights
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    ...(redis ? { redis } : {}),
    errorResponseBuilder: (_req, ctx) =>
      new AppError(
        "RATE_LIMITED",
        429,
        `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)}s.`,
        {
          retryAfterSeconds: Math.ceil(ctx.ttl / 1000),
        },
      ),
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      if (err.httpStatus === 429 && err.details) {
        reply.header(
          "retry-after",
          String((err.details as { retryAfterSeconds: number }).retryAfterSeconds),
        );
      }
      return reply.status(err.httpStatus).send({
        error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
      });
    }
    const status = "statusCode" in err && err.statusCode ? err.statusCode : 500;
    if (status < 500) {
      return reply.status(status).send({
        error: { code: "BAD_REQUEST", message: err.message, requestId: req.id },
      });
    }
    req.log.error(err);
    return reply
      .status(500)
      .send({ error: { code: "INTERNAL", message: "Internal server error", requestId: req.id } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `No route for ${req.method} ${req.url}`,
        requestId: req.id,
      },
    }),
  );

  registerAuth(app, keys);

  const authCtx = { pool, env, keys, mailer, log: app.log };
  await app.register(healthRoutes, { prefix: "/v1", checks });
  await app.register(authRoutes, {
    prefix: "/v1",
    ctx: authCtx,
    rateLimitPerMin: env.RL_AUTH_PER_MIN,
  });
  await app.register(meRoutes, { prefix: "/v1", pool });
  return app;
}
