import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  AppError,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  tokenSchema,
} from "@prepquest/shared";
import { parse } from "../../lib/validate.js";
import * as service from "./service.js";
import type { AuthContext, ClientMeta, SessionIssued } from "./service.js";

export const REFRESH_COOKIE = "pq_rt";
const COOKIE_PATH = "/v1/auth";

export interface AuthRouteOptions {
  ctx: AuthContext;
  /** Max requests per minute per IP on credential endpoints. */
  rateLimitPerMin: number;
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  app,
  { ctx, rateLimitPerMin },
) => {
  const { env } = ctx;
  const limited = { config: { rateLimit: { max: rateLimitPerMin, timeWindow: "1 minute" } } };
  const allowedOrigins = env.CORS_ORIGINS.split(",");

  const meta = (req: FastifyRequest): ClientMeta => ({
    userAgent: req.headers["user-agent"] ?? null,
    ip: req.ip,
  });

  const setRefreshCookie = (reply: FastifyReply, issued: SessionIssued) => {
    reply.setCookie(REFRESH_COOKIE, issued.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: COOKIE_PATH,
      expires: issued.refreshExpiresAt,
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });
  };

  const clearRefreshCookie = (reply: FastifyReply) => {
    reply.clearCookie(REFRESH_COOKIE, {
      path: COOKIE_PATH,
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });
  };

  /** CSRF defense for cookie-authenticated endpoints: a cross-site Origin is rejected outright. */
  const checkOrigin = (req: FastifyRequest) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      throw new AppError("FORBIDDEN", 403, "Cross-site request blocked");
    }
  };

  const asLoginBody = ({ accessToken, user }: SessionIssued) => ({ accessToken, user });

  app.post("/auth/signup", limited, async (req, reply) => {
    await service.signup(ctx, parse(signupSchema, req.body));
    return reply.status(201).send({ ok: true });
  });

  app.post("/auth/verify-email", limited, async (req, reply) => {
    await service.verifyEmail(ctx, parse(tokenSchema, req.body).token);
    return reply.status(204).send();
  });

  app.post(
    "/auth/resend-verification",
    { ...limited, preHandler: app.authenticate },
    async (req, reply) => {
      await service.resendVerification(ctx, req.auth!.userId);
      return reply.status(202).send({ ok: true });
    },
  );

  app.post("/auth/login", limited, async (req, reply) => {
    const issued = await service.login(ctx, parse(loginSchema, req.body), meta(req));
    setRefreshCookie(reply, issued);
    return asLoginBody(issued);
  });

  // Runs on every page load, so it gets a looser budget than credential endpoints.
  const refreshLimit = {
    config: { rateLimit: { max: rateLimitPerMin * 6, timeWindow: "1 minute" } },
  };

  app.post("/auth/refresh", refreshLimit, async (req, reply) => {
    checkOrigin(req);
    try {
      const issued = await service.refresh(ctx, req.cookies[REFRESH_COOKIE], meta(req));
      setRefreshCookie(reply, issued);
      return asLoginBody(issued);
    } catch (err) {
      if (err instanceof AppError) clearRefreshCookie(reply);
      throw err;
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    checkOrigin(req);
    await service.logout(ctx, req.cookies[REFRESH_COOKIE]);
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  app.post("/auth/logout-all", { preHandler: app.authenticate }, async (req, reply) => {
    await service.logoutAll(ctx, req.auth!.userId);
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  app.post("/auth/forgot-password", limited, async (req, reply) => {
    await service.forgotPassword(ctx, parse(forgotPasswordSchema, req.body).email);
    return reply.status(202).send({ ok: true });
  });

  app.post("/auth/reset-password", limited, async (req, reply) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    await service.resetPassword(ctx, token, password);
    return reply.status(204).send();
  });
};
