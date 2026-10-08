import { eq } from "drizzle-orm";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import { users, type Db } from "@prepquest/db";
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
    /** Signed in AND holding one of `roles`. Privileged roles must also have passed 2FA. */
    requireRole: (...roles: UserRole[]) => preHandlerAsyncHookHandler;
    /** Signed in AND email verified (gate for AI interviews and other costly features). */
    requireVerifiedEmail: preHandlerAsyncHookHandler;
  }
}

/** Roles that must authenticate with a second factor (doc 14 §3). */
export const MFA_REQUIRED_ROLES: readonly UserRole[] = ["admin", "moderator"];

export function registerAuth(app: FastifyInstance, deps: { keys: JwtKeys; db: Db }): void {
  app.decorateRequest("auth", undefined);

  app.decorate("authenticate", async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHENTICATED", 401, "Missing access token");
    }
    req.auth = await verifyAccessToken(deps.keys, header.slice(7));
  });

  app.decorate("requireRole", (...roles: UserRole[]): preHandlerAsyncHookHandler => {
    return async (req, reply) => {
      await app.authenticate(req, reply);
      const auth = req.auth;
      if (!auth || !roles.includes(auth.role)) {
        throw new AppError("FORBIDDEN", 403, "You don't have access to this");
      }
      if (MFA_REQUIRED_ROLES.includes(auth.role) && !auth.mfa) {
        throw new AppError(
          "MFA_REQUIRED",
          403,
          "Sign in with two-factor authentication to continue",
        );
      }
    };
  });

  app.decorate("requireVerifiedEmail", async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply);
    // read from the database, not the token, so verifying takes effect immediately
    const [row] = await deps.db
      .select({ verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, req.auth!.userId))
      .limit(1);
    if (!row?.verifiedAt) {
      throw new AppError(
        "EMAIL_NOT_VERIFIED",
        403,
        "Verify your email to use AI interviews. Check your inbox or resend the link from the dashboard.",
      );
    }
  });
}
