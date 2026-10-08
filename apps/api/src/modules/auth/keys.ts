import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI } from "jose";
import type { CryptoKey } from "jose";
import type { ServerEnv } from "@prepquest/shared";

export interface JwtKeys {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  kid: string;
}

const ALG = "EdDSA";

/**
 * Loads the Ed25519 JWT signing keys. In development a missing key pair is generated and written to
 * the configured paths; in tests an ephemeral pair is used; production requires the files to exist.
 */
export async function loadJwtKeys(env: ServerEnv): Promise<JwtKeys> {
  if (env.NODE_ENV === "test") return generate();

  const { JWT_PRIVATE_KEY_PATH: priv, JWT_PUBLIC_KEY_PATH: pub } = env;
  if (!existsSync(priv) || !existsSync(pub)) {
    if (env.NODE_ENV === "production") {
      throw new Error(`JWT key files not found at ${priv} / ${pub}`);
    }
    const keys = await generate();
    await mkdir(dirname(priv), { recursive: true });
    await writeFile(priv, await exportPKCS8(keys.privateKey), { mode: 0o600 });
    await writeFile(pub, await exportSPKI(keys.publicKey));
    return keys;
  }
  return {
    privateKey: await importPKCS8(await readFile(priv, "utf8"), ALG),
    publicKey: await importSPKI(await readFile(pub, "utf8"), ALG),
    kid: "v1",
  };
}

async function generate(): Promise<JwtKeys> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
  return { privateKey, publicKey, kid: "v1" };
}

export const JWT_ALG = ALG;
