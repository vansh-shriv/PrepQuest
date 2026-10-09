import { unzipSync } from "fflate";
import { z } from "zod";
import { AppError, type ParamType } from "@prepquest/shared";
import {
  MAX_FILE_BYTES,
  MAX_TESTS,
  MAX_TOTAL_BYTES,
  manifestEntrySchema,
  type Issue,
  type TestFile,
} from "@prepquest/content";

export const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const NAME = /^(manifest\.json|\d{2,3}\.(in|out))$/;

class ZipLimit extends Error {}

/**
 * Reads an uploaded test zip: `manifest.json` plus `NN.in` / `NN.out` files in the archive root.
 * Limits are enforced from the zip's own size headers BEFORE anything is inflated, so a zip bomb is
 * rejected without being expanded. Returns the tests and any problems found (nothing is stored here).
 */
export function readTestZip(
  buffer: Buffer,
  problem: string,
): { tests: TestFile[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const fail = (message: string) => issues.push({ level: "error", problem, message });

  let entries: Record<string, Uint8Array>;
  try {
    let count = 0;
    let total = 0;
    entries = unzipSync(new Uint8Array(buffer), {
      filter(file) {
        if (file.name.endsWith("/")) return false; // directory entries carry no data
        count++;
        total += file.originalSize;
        if (count > 2 * MAX_TESTS + 1) throw new ZipLimit(`more than ${2 * MAX_TESTS + 1} files`);
        if (file.originalSize > MAX_FILE_BYTES)
          throw new ZipLimit(`${file.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
        if (total > MAX_TOTAL_BYTES)
          throw new ZipLimit(`contents exceed ${MAX_TOTAL_BYTES / 1024 / 1024} MB uncompressed`);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ZipLimit)
      throw new AppError("VALIDATION_FAILED", 422, `Zip rejected: ${err.message}`);
    throw new AppError("VALIDATION_FAILED", 422, "That file isn't a valid zip archive");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const text = new Map<string, string>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (!NAME.test(name)) {
      fail(
        `unexpected file "${name}" (the zip must contain only manifest.json and NN.in / NN.out in its root)`,
      );
      continue;
    }
    try {
      text.set(name, decoder.decode(bytes));
    } catch {
      fail(`${name} is not valid UTF-8 text`);
    }
  }

  const rawManifest = text.get("manifest.json");
  if (rawManifest === undefined) {
    fail("manifest.json is missing");
    return { tests: [], issues };
  }
  let manifest: z.infer<typeof manifestEntrySchema>[];
  try {
    manifest = z.array(manifestEntrySchema).parse(JSON.parse(rawManifest));
  } catch (err) {
    fail(
      `manifest.json is invalid: ${err instanceof z.ZodError ? err.issues[0]?.message : "not JSON"}`,
    );
    return { tests: [], issues };
  }

  const tests: TestFile[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const entry of manifest) {
    const input = text.get(`${pad(entry.ordinal)}.in`);
    const output = text.get(`${pad(entry.ordinal)}.out`);
    if (input === undefined || output === undefined) {
      fail(
        `test ${entry.ordinal}: ${input === undefined ? `${pad(entry.ordinal)}.in` : `${pad(entry.ordinal)}.out`} is missing from the zip`,
      );
      continue;
    }
    tests.push({ ...entry, input, output });
  }
  const listed = new Set(manifest.map((m) => pad(m.ordinal)));
  for (const name of text.keys()) {
    if (name !== "manifest.json" && !listed.has(name.slice(0, name.indexOf(".")))) {
      fail(`${name} is not listed in manifest.json`);
    }
  }
  return { tests, issues };
}

export type { ParamType };
