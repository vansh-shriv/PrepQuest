import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeKey, FsObjectStore, S3ObjectStore, type ObjectStore } from "./index.js";

/** The same behavioural contract must hold for every implementation. */
function contract(name: string, make: () => Promise<ObjectStore | null>) {
  describe(name, () => {
    let store: ObjectStore | null = null;
    const prefix = `contract-${Date.now().toString(36)}`;
    beforeAll(async () => {
      store = await make();
    });

    it("stores, reads back, checks existence and deletes", async (ctx) => {
      if (!store) return ctx.skip();
      const key = `${prefix}/a/b.txt`;
      expect(await store.exists(key)).toBe(false);
      await store.put(key, "hello\nworld", "text/plain");
      expect(await store.exists(key)).toBe(true);
      expect((await store.get(key)).toString()).toBe("hello\nworld");
      await store.put(key, Buffer.from([0, 1, 2, 255]));
      expect([...(await store.get(key))]).toEqual([0, 1, 2, 255]);
      await store.delete(key);
      expect(await store.exists(key)).toBe(false);
      await store.delete(key); // deleting again is fine
    });

    it("throws when reading a missing key", async (ctx) => {
      if (!store) return ctx.skip();
      await expect(store.get(`${prefix}/missing.txt`)).rejects.toThrow();
    });

    it("rejects unsafe keys", async (ctx) => {
      if (!store) return ctx.skip();
      for (const bad of ["../escape", "a/../../b", "/abs", "a//b", "", "sp ace", "a\\b"]) {
        await expect(store.put(bad, "x")).rejects.toThrow(/Unsafe object key/);
      }
    });
  });
}

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pq-store-"));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

contract("FsObjectStore", async () => new FsObjectStore(join(tmp, "objects")));

// Runs against an S3-compatible server when it is up (docker compose up -d s3); skipped otherwise.
contract("S3ObjectStore (local S3 server)", async () => {
  const store = new S3ObjectStore({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: "us-east-1",
    bucket: "prepquest-test",
    accessKeyId: process.env.S3_ACCESS_KEY ?? "prepquest",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "prepquest-secret",
    forcePathStyle: true,
  });
  try {
    await store.exists("probe"); // fails fast when MinIO isn't reachable
    return store;
  } catch {
    return null;
  }
});

describe("assertSafeKey", () => {
  it("accepts normal keys", () => {
    expect(() => assertSafeKey("problems/two-sum/v1/01.in")).not.toThrow();
  });
});
