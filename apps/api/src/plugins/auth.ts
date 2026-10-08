import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import { AppError, type UserRole } from "@prepquest/shared";
import { verifyAccessToken, type AccessClaims } from "../modules/auth/access-token.js";
import type { JwtKeys } from "../modules/auth/keys.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `app.authenticate`; undefined on public routes. */
    auth?: AccessClaims;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: UserRole[]) => preHandlerAsyncHookHandler;
  }
}

/** Adds `app.authenticate` (Bearer access JWT -> req.auth) and `app.requireRole(...)`. */
export function registerAuth(app: FastifyInstance, keys: JwtKeys): void {
  app.decorateRequest("auth", undefined);

  app.decorate("authenticate", async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHENTICATED", 401, "Missing access token");
    }
    req.auth = await verifyAccessToken(keys, header.slice(7));
  });

  app.decorate("requireRole", (...roles: UserRole[]): preHandlerAsyncHookHandler => {
    return async (req, reply) => {
      await app.authenticate(req, reply);
      if (!req.auth || !roles.includes(req.auth.role)) {
        throw new AppError("FORBIDDEN", 403, "You don't have access to this");
      }
    };
  });
}
