import { jwtVerify, SignJWT } from "jose";
import { AppError, type UserRole } from "@prepquest/shared";
import { JWT_ALG, type JwtKeys } from "./keys.js";

export interface AccessClaims {
  userId: string;
  role: UserRole;
  /** auth_sessions.id the token was minted for (identifies the "current" device) */
  sessionId: string;
  /** True when the session passed a second factor. Privileged roles require it. */
  mfa: boolean;
}

const ISSUER = "prepquest";

export function signAccessToken(
  keys: JwtKeys,
  claims: AccessClaims,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ role: claims.role, sid: claims.sessionId, mfa: claims.mfa })
    .setProtectedHeader({ alg: JWT_ALG, kid: keys.kid })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(keys.privateKey);
}

export async function verifyAccessToken(keys: JwtKeys, token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, keys.publicKey, {
      issuer: ISSUER,
      algorithms: [JWT_ALG],
    });
    if (!payload.sub || typeof payload.sid !== "string" || typeof payload.role !== "string") {
      throw new Error("missing claims");
    }
    return {
      userId: payload.sub,
      role: payload.role as UserRole,
      sessionId: payload.sid,
      mfa: payload.mfa === true,
    };
  } catch {
    throw new AppError("UNAUTHENTICATED", 401, "Invalid or expired access token");
  }
}

const MFA_TTL_SECONDS = 5 * 60;

/** Short-lived proof that the password step succeeded; exchanged for a session at POST /auth/2fa/login. */
export function signMfaToken(keys: JwtKeys, userId: string): Promise<string> {
  return new SignJWT({ purpose: "mfa" })
    .setProtectedHeader({ alg: JWT_ALG, kid: keys.kid })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${MFA_TTL_SECONDS}s`)
    .sign(keys.privateKey);
}

/** Returns the user id the MFA token was issued for. Access tokens are rejected (no `purpose`). */
export async function verifyMfaToken(keys: JwtKeys, token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, keys.publicKey, {
      issuer: ISSUER,
      algorithms: [JWT_ALG],
    });
    if (payload.purpose !== "mfa" || !payload.sub) throw new Error("wrong token type");
    return payload.sub;
  } catch {
    throw new AppError("UNAUTHENTICATED", 401, "Your sign-in expired. Please log in again.");
  }
}
