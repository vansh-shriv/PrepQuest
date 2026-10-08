import { newId } from "./ids.js";
import type { Db } from "./client.js";

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
  let inserted = 0;
  const rows: Array<[string, (typeof TOPIC_TAGS)[number] | (typeof PATTERN_TAGS)[number]]> = [
    ...TOPIC_TAGS.map((s) => ["topic", s] as [string, (typeof TOPIC_TAGS)[number]]),
    ...PATTERN_TAGS.map((s) => ["pattern", s] as [string, (typeof PATTERN_TAGS)[number]]),
  ];
  for (const [kind, slug] of rows) {
    const res = await db.query(
      "INSERT INTO tags (id, kind, slug, name) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING",
      [newId(), kind, slug, title(slug)],
    );
    inserted += res.rowCount ?? 0;
  }
  return { tags: inserted };
}
