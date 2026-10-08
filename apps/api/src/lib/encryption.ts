import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for small secrets stored in the database (TOTP seeds).
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, "base64");
    if (this.key.length !== 32)
      throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }

  /** Development fallback so the app runs without configuration. Never used in production. */
  static insecureDevelopmentBox(): SecretBox {
    return new SecretBox(createHash("sha256").update("prepquest-dev-only-key").digest("base64"));
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const parts = [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url"));
    return `v1.${parts.join(".")}`;
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(".");
    if (version !== "v1" || !iv || !tag || !data) throw new Error("Unsupported ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
