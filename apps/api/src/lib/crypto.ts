import { createHash, randomBytes } from "node:crypto";

/** 256-bit URL-safe random token (refresh tokens, email links). Only its hash is stored. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
