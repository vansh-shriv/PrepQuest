import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { Database } from "@prepquest/db";
import { AppError, type ServerEnv } from "@prepquest/shared";
import { NoopBreachChecker, HibpBreachChecker, type BreachChecker } from "./lib/breach.js";
import { SecretBox } from "./lib/encryption.js";
import { MemoryKv, RedisKv, type Kv } from "./lib/kv.js";
import { AttemptGuard, LoginLockout, RateLimiter } from "./lib/limiter.js";
import type { Mailer } from "./lib/mailer.js";
import { verifyAccessToken } from "./modules/auth/access-token.js";
import type { JwtKeys } from "./modules/auth/keys.js";
import { authRoutes } from "./modules/auth/routes.js";
import type { AuthContext } from "./modules/auth/service.js";
import { healthRoutes, type HealthChecks } from "./modules/health/routes.js";
import { interviewRoutes } from "./modules/interviews/routes.js";
import { MemoryBus } from "./modules/interviews/bus.js";
import { InterviewEngine } from "./modules/interviews/engine.js";
import { attachInterviewGateway } from "./modules/interviews/gateway.js";
import { createRealtime } from "./lib/realtime.js";
import { attachPeerGateway } from "./modules/peer/gateway.js";
import { RoomHub } from "./modules/peer/room.js";
import type { AiContext } from "./modules/ai-context.js";
import { resumeRoutes } from "./modules/resumes/routes.js";
import { BackgroundRunner } from "./lib/jobs.js";
import { createLlmGateway, type LlmGateway } from "./lib/llm/index.js";
import { meRoutes } from "./modules/me/routes.js";
import { libraryRoutes } from "./modules/library/routes.js";
import { practiceRoutes } from "./modules/practice/routes.js";
import { problemRoutes } from "./modules/problems/routes.js";
import { ensureBadgeCatalog } from "./modules/progress/award.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
import { planningRoutes } from "./modules/planning/routes.js";
import { contestRoutes } from "./modules/contests/routes.js";
import { oaRoutes } from "./modules/oa/routes.js";
import { quizRoutes } from "./modules/quizzes/routes.js";
import { roadmapRoutes } from "./modules/roadmaps/routes.js";
import { sqlRoutes } from "./modules/sql/routes.js";
import { trackRoutes } from "./modules/tracks/routes.js";
import { reviewRoutes } from "./modules/reviews/routes.js";
import { codeReviewRoutes } from "./modules/codereview/routes.js";
import { integrityRoutes } from "./modules/integrity/routes.js";
import { designRoutes } from "./modules/design/routes.js";
import { peerRoutes } from "./modules/peer/routes.js";
import { flashcardRoutes } from "./modules/flashcards/routes.js";
import { shareRoutes } from "./modules/shares/routes.js";
import { progressRoutes } from "./modules/progress/routes.js";
import type { JudgeQueue } from "./modules/submissions/queue.js";
import { submissionRoutes } from "./modules/submissions/routes.js";
import { userRoutes } from "./modules/users/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { registerAuth } from "./plugins/auth.js";
import type { ObjectStore } from "@prepquest/storage";

export interface AppDeps {
  env: ServerEnv;
  db: Database;
  keys: JwtKeys;
  mailer: Mailer;
  /** Object storage for hidden test data and uploads. */
  store: ObjectStore;
  /** Hands submissions to the judge workers. */
  judge: JudgeQueue;
  checks: HealthChecks;
  /** When set, rate-limit counters, lockouts and OAuth state live in Redis (shared across instances). */
  redis?: Redis;
  /** Overrides for tests. */
  kv?: Kv;
  breach?: BreachChecker;
  fetchFn?: typeof fetch;
  /** Tests inject a gateway around their own provider. */
  llm?: LlmGateway;
}

declare module "fastify" {
  interface FastifyInstance {
    /** Shared context of the AI features (resumes, interviews); also used by tests and background jobs. */
    ai: AiContext;
    /** The interview orchestrator; `main.ts` runs its timer sweep. */
    interviews: InterviewEngine;
    peerRooms: RoomHub;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env, db, keys, mailer, checks, redis } = deps;

  const app = Fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : { level: env.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie"] },
    trustProxy: env.TRUST_PROXY,
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
    // the plugin defaults to GET/HEAD/POST only, which blocks PATCH, PUT and DELETE preflights
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposedHeaders: [
      "x-request-id",
      "retry-after",
      "ratelimit-limit",
      "ratelimit-remaining",
      "ratelimit-reset",
      "content-disposition", // lets the web app read the export's suggested filename
    ],
  });
  await app.register(cookie);

  // Global budget: per signed-in user (token verified here) or per IP for everyone else (doc 11 §14).
  // Route-level `config.rateLimit` overrides it for credential endpoints.
  await app.register(rateLimit, {
    global: true,
    timeWindow: "1 minute",
    ...(redis ? { redis } : {}),
    enableDraftSpec: true, // RateLimit-Limit / -Remaining / -Reset headers
    allowList: (req) => req.url.startsWith("/v1/health"),
    keyGenerator: async (req) => {
      const header = req.headers.authorization;
      if (header?.startsWith("Bearer ")) {
        try {
          return `user:${(await verifyAccessToken(keys, header.slice(7))).userId}`;
        } catch {
          /* invalid token: fall through to the IP budget */
        }
      }
      return `ip:${req.ip}`;
    },
    max: async (_req, key) => (key.startsWith("user:") ? env.RL_USER_PER_MIN : env.RL_ANON_PER_MIN),
    errorResponseBuilder: (_req, ctx) =>
      new AppError(
        "RATE_LIMITED",
        429,
        `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)}s.`,
        { retryAfterSeconds: Math.ceil(ctx.ttl / 1000) },
      ),
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (err.httpStatus === 429 && retry) reply.header("retry-after", String(retry));
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

  registerAuth(app, { keys, db });

  const kv = deps.kv ?? (redis ? new RedisKv(redis) : new MemoryKv());
  const reportStoreError = (err: unknown) => app.log.error({ err }, "rate-limit store unavailable");
  const ctx: AuthContext = {
    db,
    env,
    keys,
    mailer,
    log: app.log,
    kv,
    limiter: new RateLimiter(kv, reportStoreError),
    lockout: new LoginLockout(kv, reportStoreError),
    mfaGuard: new AttemptGuard(kv, 5, 600, reportStoreError),
    breach:
      deps.breach ??
      (env.BREACH_CHECK === "on"
        ? new HibpBreachChecker(deps.fetchFn ?? fetch, (err) =>
            app.log.warn({ err }, "breached-password check unavailable; allowing"),
          )
        : new NoopBreachChecker()),
    box: env.DATA_ENCRYPTION_KEY
      ? new SecretBox(env.DATA_ENCRYPTION_KEY)
      : SecretBox.insecureDevelopmentBox(),
    fetchFn: deps.fetchFn ?? fetch,
  };

  await app.register(healthRoutes, { prefix: "/v1", checks });
  await app.register(authRoutes, { prefix: "/v1", ctx, rateLimitPerMin: env.RL_AUTH_PER_MIN });
  await app.register(meRoutes, { prefix: "/v1", ctx });
  await app.register(userRoutes, { prefix: "/v1", db });
  await app.register(problemRoutes, { prefix: "/v1", db });
  await app.register(submissionRoutes, {
    prefix: "/v1",
    ctx: { db, queue: deps.judge, limiter: ctx.limiter },
  });
  await app.register(libraryRoutes, { prefix: "/v1", db });
  await app.register(practiceRoutes, { prefix: "/v1", db });
  await app.register(progressRoutes, { prefix: "/v1", db });
  await ensureBadgeCatalog(db);
  const llmLog = (level: "warn" | "error", msg: string, extra?: Record<string, unknown>) =>
    app.log[level]({ ...extra }, msg);
  const ai: AiContext = {
    db,
    env,
    store: deps.store,
    llm: deps.llm ?? createLlmGateway(env, db, llmLog),
    jobs: new BackgroundRunner((name, err) =>
      app.log.error({ err, job: name }, "background job failed"),
    ),
    limiter: ctx.limiter,
    kv,
    log: app.log,
    now: () => new Date(),
  };
  app.decorate("ai", ai);
  await app.register(resumeRoutes, { prefix: "/v1", ctx: ai });
  const engine = new InterviewEngine(ai, new MemoryBus());
  app.decorate("interviews", engine);
  const rooms = new RoomHub(ai);
  app.decorate("peerRooms", rooms);
  await app.register(interviewRoutes, { prefix: "/v1", ctx: ai, engine, kv });
  await app.register(analyticsRoutes, { prefix: "/v1", db });
  await app.register(planningRoutes, { prefix: "/v1", ctx: ai });
  await app.register(reviewRoutes, { prefix: "/v1", ctx: ai });
  await app.register(flashcardRoutes, { prefix: "/v1", ctx: ai });
  await app.register(shareRoutes, { prefix: "/v1", ctx: ai });
  await app.register(designRoutes, { prefix: "/v1", ctx: ai });
  await app.register(integrityRoutes, { prefix: "/v1", ctx: ai });
  await app.register(peerRoutes, { prefix: "/v1", ctx: ai, kv, rooms });
  await app.register(codeReviewRoutes, {
    prefix: "/v1",
    ctx: { ai, sub: { db, queue: deps.judge, limiter: ctx.limiter } },
  });
  await app.register(quizRoutes, { prefix: "/v1", ctx: ai });
  await app.register(sqlRoutes, { prefix: "/v1", ctx: ai });
  await app.register(oaRoutes, { prefix: "/v1", ctx: ai });
  await app.register(contestRoutes, { prefix: "/v1", ctx: ai });
  await app.register(roadmapRoutes, { prefix: "/v1", ctx: ai });
  await app.register(trackRoutes, { prefix: "/v1", ctx: ai });
  const realtime = createRealtime(app, env.CORS_ORIGINS.split(","));
  attachInterviewGateway({ ctx: ai, engine, kv, realtime });
  attachPeerGateway({ ctx: ai, kv, realtime, rooms });
  await app.register(adminRoutes, {
    prefix: "/v1",
    ctx: { db, store: deps.store, allowSelfPublish: env.ALLOW_SELF_PUBLISH },
  });
  return app;
}
