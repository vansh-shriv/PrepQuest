import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  AppError,
  forgotPasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaLoginSchema,
  resetPasswordSchema,
  signupSchema,
  totpCodeSchema,
  tokenSchema,
} from "@prepquest/shared";
import { z } from "zod";
import { parse } from "../../lib/validate.js";
import * as mfa from "./mfa.js";
import * as oauth from "./oauth.js";
import * as service from "./service.js";
import type { AuthContext, ClientMeta, LoginOutcome, SessionIssued } from "./service.js";

export const REFRESH_COOKIE = "pq_rt";
const OAUTH_COOKIE = "pq_oauth";
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
  // Runs on every page load, so it gets a looser budget than credential endpoints.
  const refreshLimit = {
    config: { rateLimit: { max: rateLimitPerMin * 6, timeWindow: "1 minute" } },
  };
  const allowedOrigins = env.CORS_ORIGINS.split(",");
  const secure = env.NODE_ENV === "production";
  const domain = env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {};

  const meta = (req: FastifyRequest): ClientMeta => ({
    userAgent: req.headers["user-agent"] ?? null,
    ip: req.ip,
  });

  const setRefreshCookie = (reply: FastifyReply, issued: SessionIssued) => {
    reply.setCookie(REFRESH_COOKIE, issued.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: COOKIE_PATH,
      expires: issued.refreshExpiresAt,
      ...domain,
    });
  };

  const clearRefreshCookie = (reply: FastifyReply) => {
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, ...domain });
  };

  /** CSRF defense for cookie-authenticated endpoints: a cross-site Origin is rejected outright. */
  const checkOrigin = (req: FastifyRequest) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      throw new AppError("FORBIDDEN", 403, "Cross-site request blocked");
    }
  };

  const asLoginBody = ({ accessToken, user }: SessionIssued) => ({ accessToken, user });

  const respondToLogin = (reply: FastifyReply, outcome: LoginOutcome) => {
    if (outcome.kind === "mfa") return outcome.body;
    setRefreshCookie(reply, outcome.session);
    return asLoginBody(outcome.session);
  };

  // ---- account lifecycle ----

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

  app.post("/auth/forgot-password", limited, async (req, reply) => {
    await service.forgotPassword(ctx, parse(forgotPasswordSchema, req.body).email);
    return reply.status(202).send({ ok: true });
  });

  app.post("/auth/reset-password", limited, async (req, reply) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    await service.resetPassword(ctx, token, password);
    return reply.status(204).send();
  });

  // ---- sessions ----

  app.post("/auth/login", limited, async (req, reply) => {
    return respondToLogin(reply, await service.login(ctx, parse(loginSchema, req.body), meta(req)));
  });

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

  // ---- two-factor authentication (TOTP) ----

  app.post("/auth/2fa/setup", { preHandler: app.authenticate }, async (req) =>
    mfa.beginSetup(ctx, req.auth!.userId),
  );

  app.post("/auth/2fa/verify", { ...limited, preHandler: app.authenticate }, async (req) => {
    const { code } = parse(z.object({ code: totpCodeSchema }), req.body);
    return { recoveryCodes: await mfa.confirmSetup(ctx, req.auth!.userId, code) };
  });

  app.post("/auth/2fa/login", limited, async (req, reply) => {
    const session = await mfa.completeLogin(ctx, parse(mfaLoginSchema, req.body), meta(req));
    setRefreshCookie(reply, session);
    return asLoginBody(session);
  });

  app.post(
    "/auth/2fa/disable",
    { ...limited, preHandler: app.authenticate },
    async (req, reply) => {
      await mfa.disable(ctx, req.auth!.userId, parse(mfaDisableSchema, req.body));
      return reply.status(204).send();
    },
  );

  // ---- OAuth (Google, GitHub) ----

  app.get("/auth/oauth/providers", async () => ({
    providers: oauth.configuredProviders(env).map((p) => p.id),
  }));

  app.get<{ Params: { provider: string } }>(
    "/auth/oauth/:provider/start",
    limited,
    async (req, reply) => {
      const { url, state } = await oauth.start(ctx, req.params.provider);
      reply.setCookie(OAUTH_COOKIE, state, {
        httpOnly: true,
        secure,
        sameSite: "lax", // must accompany the top-level redirect back from the provider
        path: `${COOKIE_PATH}/oauth`,
        maxAge: 600,
        ...domain,
      });
      return reply.redirect(url);
    },
  );

  app.get<{
    Params: { provider: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>("/auth/oauth/:provider/callback", limited, async (req, reply) => {
    const web = (path: string) => reply.redirect(`${env.APP_URL}${path}`);
    reply.clearCookie(OAUTH_COOKIE, { path: `${COOKIE_PATH}/oauth`, ...domain });
    try {
      const outcome = await oauth.handleCallback(
        ctx,
        req.params.provider,
        req.query,
        req.cookies[OAUTH_COOKIE],
        meta(req),
      );
      if (outcome.kind === "mfa") {
        return web(`/oauth/callback?mfa=${encodeURIComponent(outcome.body.mfaToken)}`);
      }
      setRefreshCookie(reply, outcome.session);
      return web("/oauth/callback");
    } catch (err) {
      if (err instanceof oauth.OAuthFailure) return web(`/login?error=oauth_${err.reason}`);
      if (err instanceof AppError && err.httpStatus === 404)
        return web("/login?error=oauth_provider");
      throw err;
    }
  });
};
