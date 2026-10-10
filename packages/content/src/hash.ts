import { createHash } from "node:crypto";
import type { Language, ProblemBundle } from "./types.js";

/** Stable JSON: object keys sorted, so semantically equal content hashes equally. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Fingerprint of everything that defines a problem version: statement, metadata, signature, examples,
 * starters and every test file. A new hash means a new version (doc 17 §9). Hints and editorials are
 * synced on every import without versioning.
 */
export function contentHash(bundle: ProblemBundle, starters: Record<Language, string>): string {
  const testsHash = createHash("sha256");
  for (const t of [...bundle.tests].sort((a, b) => a.ordinal - b.ordinal)) {
    testsHash.update(
      `${t.ordinal}|${t.kind}|${t.label ?? ""}|${t.weight}\n${t.input}\n--\n${t.output}\n==\n`,
    );
  }
  return createHash("sha256")
    .update(
      canonical({
        meta: bundle.meta,
        statement: bundle.statementMd,
        constraints: bundle.constraintsMd,
        examples: bundle.examples,
        signature: bundle.signature,
        starters,
        // Hints and editorials are not part of a problem's version (editing them must not create one);
        // the constant keeps the hash of problems imported before they existed unchanged.
        hints: {},
        tests: testsHash.digest("hex"),
      }),
    )
    .digest("hex");
}
