/** Minimal object storage used for hidden test data, uploads and (later) resumes and exports. */
export interface ObjectStore {
  put(key: string, body: Buffer | string, contentType?: string): Promise<void>;
  /** Throws if the key doesn't exist. */
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
}

/** Keys are slash-separated paths of safe characters. Rejects traversal and odd characters. */
export function assertSafeKey(key: string): void {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._\-/]{0,300}$/.test(key) ||
    key.includes("..") ||
    key.includes("//")
  ) {
    throw new Error(`Unsafe object key: ${key}`);
  }
}
