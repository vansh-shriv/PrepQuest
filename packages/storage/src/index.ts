import { FsObjectStore } from "./fs.js";
import { S3ObjectStore } from "./s3.js";
import type { ObjectStore } from "./types.js";

export { FsObjectStore } from "./fs.js";
export { S3ObjectStore, type S3Config } from "./s3.js";
export { assertSafeKey, type ObjectStore } from "./types.js";

export interface StorageEnv {
  STORAGE_DRIVER: "fs" | "s3";
  STORAGE_FS_DIR: string;
  S3_ENDPOINT?: string | undefined;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY?: string | undefined;
  S3_SECRET_KEY?: string | undefined;
  S3_FORCE_PATH_STYLE: boolean;
}

export function createObjectStore(env: StorageEnv): ObjectStore {
  if (env.STORAGE_DRIVER === "fs") return new FsObjectStore(env.STORAGE_FS_DIR);
  if (!env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
    throw new Error("STORAGE_DRIVER=s3 needs S3_ACCESS_KEY and S3_SECRET_KEY");
  }
  return new S3ObjectStore({
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}
