import type { Db } from "./client.js";
import { newId } from "./ids.js";
import { tags } from "./schema/index.js";

const title = (slug: string) =>
  slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export const TOPIC_TAGS = [
  "arrays",
  "strings",
  "hashing",
  "two-pointers",
  "sliding-window",
  "binary-search",
  "sorting",
  "linked-list",
  "stack",
  "queue",
  "recursion",
  "backtracking",
  "trees",
  "binary-search-tree",
  "heap",
  "graphs",
  "dynamic-programming",
  "greedy",
  "bit-manipulation",
  "math",
  "trie",
  "union-find",
] as const;

export const PATTERN_TAGS = [
  "prefix-sum",
  "monotonic-stack",
  "fast-slow-pointers",
  "bfs",
  "dfs",
  "topological-sort",
  "dijkstra",
  "knapsack",
  "interval-merging",
  "divide-and-conquer",
] as const;

/** Idempotent: inserts topic and pattern tags that don't exist yet. */
export async function seedReferenceData(db: Db): Promise<{ tags: number }> {
  const rows = [
    ...TOPIC_TAGS.map((slug) => ({ id: newId(), kind: "topic", slug, name: title(slug) })),
    ...PATTERN_TAGS.map((slug) => ({ id: newId(), kind: "pattern", slug, name: title(slug) })),
  ];
  const inserted = await db
    .insert(tags)
    .values(rows)
    .onConflictDoNothing({ target: tags.slug })
    .returning({ id: tags.id });
  return { tags: inserted.length };
}
