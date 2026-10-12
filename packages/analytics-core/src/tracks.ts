// Company tracks (P4): a curated problem list derived from a pack's topic weights, and the overlap of two lists.

export interface CuratedInput {
  slug: string;
  difficulty: "easy" | "medium" | "hard";
  topics: readonly string[];
  patterns?: readonly string[];
}

export interface PackFocus {
  topic_weights: Record<string, number>;
  difficulty_band: { easy: number; medium: number; hard: number };
}

/** How much a problem matters to a pack: its best topic weight, scaled by the pack's appetite for its difficulty. */
export function problemWeight(p: CuratedInput, pack: PackFocus): number {
  const tags = [...p.topics, ...(p.patterns ?? [])];
  const best = Math.max(0, ...tags.map((t) => pack.topic_weights[t] ?? 0));
  const bonus = tags.reduce((a, t) => a + (pack.topic_weights[t] ?? 0), 0) * 0.05;
  return (best + bonus) * (0.4 + pack.difficulty_band[p.difficulty]);
}

/**
 * The pack's curated list: problems that touch a weighted topic, best first, at most `limit`.
 * Deterministic (ties broken by slug), so two people on the same pack see the same list.
 */
export function curatedList(
  problems: readonly CuratedInput[],
  pack: PackFocus,
  limit = 40,
): Array<CuratedInput & { weight: number }> {
  return problems
    .map((p) => ({ ...p, weight: problemWeight(p, pack) }))
    .filter((p) => p.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

export interface Overlap {
  shared: string[];
  onlyA: string[];
  onlyB: string[];
  /** Share of B's list that A's preparation already covers (0 to 1). */
  coversB: number;
  /** Share of A's list that B's preparation already covers (0 to 1). */
  coversA: number;
}

/** Plain set intersection of two problem lists. */
export function overlap(a: readonly string[], b: readonly string[]): Overlap {
  const sa = new Set(a);
  const sb = new Set(b);
  const shared = [...sa].filter((x) => sb.has(x)).sort();
  return {
    shared,
    onlyA: [...sa].filter((x) => !sb.has(x)).sort(),
    onlyB: [...sb].filter((x) => !sa.has(x)).sort(),
    coversB: sb.size === 0 ? 0 : shared.length / sb.size,
    coversA: sa.size === 0 ? 0 : shared.length / sa.size,
  };
}

/** Topic frequency heatmap for a pack: topics sorted by weight, with a 1 to 5 heat level. */
export function heatmap(pack: PackFocus): Array<{ topic: string; weight: number; heat: number }> {
  return Object.entries(pack.topic_weights)
    .map(([topic, weight]) => ({
      topic,
      weight,
      heat: Math.max(1, Math.min(5, Math.ceil(weight * 5))),
    }))
    .sort((a, b) => b.weight - a.weight || a.topic.localeCompare(b.topic));
}
