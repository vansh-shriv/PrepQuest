import { jwtVerify, SignJWT } from "jose";
import { AppError, type UserRole } from "@prepquest/shared";
import { JWT_ALG, type JwtKeys } from "./keys.js";

export interface AccessClaims {
  userId: string;
  role: UserRole;
  /** auth_sessions.id the token was minted for (identifies the "current" device) */
  sessionId: string;
}

const ISSUER = "prepquest";

export function signAccessToken(
  keys: JwtKeys,
  claims: AccessClaims,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ role: claims.role, sid: claims.sessionId })
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
    return { userId: payload.sub, role: payload.role as UserRole, sessionId: payload.sid };
  } catch {
    throw new AppError("UNAUTHENTICATED", 401, "Invalid or expired access token");
  }
}
