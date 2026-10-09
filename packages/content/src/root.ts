import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PATTERN_TAGS, TOPIC_TAGS } from "@prepquest/db";
import type { Taxonomy } from "./validate.js";

/** The repo's `content/` folder: `CONTENT_DIR`, or the nearest ancestor of the cwd that has `content/problems`. */
export function findContentRoot(from = process.cwd()): string {
  if (process.env.CONTENT_DIR) return resolve(process.env.CONTENT_DIR);
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, "content");
    if (existsSync(join(candidate, "problems"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("content/problems not found (set CONTENT_DIR)");
    dir = parent;
  }
}

/** Tag slugs a problem may reference. Mirrors what `pnpm db:seed` inserts. */
export const taxonomy: Taxonomy = {
  topics: new Set<string>(TOPIC_TAGS),
  patterns: new Set<string>(PATTERN_TAGS),
};
