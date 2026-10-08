import { hash, verify, type Algorithm } from "@node-rs/argon2";

// Argon2id, 64 MiB, t=3, p=1 (doc 14 baseline; tune on production hardware).
// Algorithm is a const enum (unusable under isolatedModules); Argon2id === 2.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 65_536, timeCost: 3, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/** Burns the same CPU as a real check so login timing doesn't reveal whether an email exists. */
export async function verifyDummy(password: string): Promise<void> {
  dummy ??= hashPassword("not-a-real-password");
  await verifyPassword(await dummy, password);
}
