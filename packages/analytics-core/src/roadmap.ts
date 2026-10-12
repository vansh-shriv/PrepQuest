// Topic roadmaps (P3): a prerequisite graph whose node states come from mastery. Pure.

export interface RoadmapNodeSpec {
  id: string;
  /** Ids of nodes that must be cleared first. */
  requires: string[];
  /** Mastery needed for this node to unlock the ones after it (default 0.6). */
  unlockThreshold?: number;
  /** Mastery at which the node counts as mastered (default 0.8). */
  masterThreshold?: number;
}

export const DEFAULT_UNLOCK = 0.6;
export const DEFAULT_MASTER = 0.8;

export type NodeState = "locked" | "open" | "cleared" | "mastered";

/** Problems with the graph: an edge to nothing, a self-edge, duplicate ids or a cycle. Empty when it is a DAG. */
export function graphIssues(nodes: readonly RoadmapNodeSpec[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) issues.push(`duplicate node "${n.id}"`);
    ids.add(n.id);
  }
  for (const n of nodes) {
    for (const r of n.requires) {
      if (r === n.id) issues.push(`node "${n.id}" requires itself`);
      else if (!ids.has(r)) issues.push(`node "${n.id}" requires unknown node "${r}"`);
    }
  }
  if (issues.length > 0) return issues;
  // Kahn's algorithm: whatever is left over sits on a cycle
  const left = new Map(nodes.map((n) => [n.id, new Set(n.requires)]));
  for (;;) {
    const free = [...left].filter(([, req]) => req.size === 0).map(([id]) => id);
    if (free.length === 0) break;
    for (const id of free) {
      left.delete(id);
      for (const req of left.values()) req.delete(id);
    }
  }
  if (left.size > 0) issues.push(`cycle among: ${[...left.keys()].sort().join(", ")}`);
  return issues;
}

/** Layer of each node: 0 for nodes without prerequisites, otherwise one more than the deepest prerequisite. */
export function depths(nodes: readonly RoadmapNodeSpec[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0; // a cycle is reported by graphIssues; do not loop forever
    seen.add(id);
    const n = byId.get(id);
    const d =
      !n || n.requires.length === 0 ? 0 : 1 + Math.max(...n.requires.map((r) => depth(r, seen)));
    seen.delete(id);
    memo.set(id, d);
    return d;
  };
  for (const n of nodes) depth(n.id, new Set());
  return memo;
}

export interface NodeStatus {
  id: string;
  state: NodeState;
  /** 0 to 1, or null with no evidence yet. */
  mastery: number | null;
  /** Prerequisites still to clear (for a locked node). */
  blockedBy: string[];
}

/**
 * Node states. A node is locked until every prerequisite is cleared (mastery at its unlock threshold),
 * open once it is reachable, cleared at the unlock threshold and mastered at the master threshold.
 */
export function nodeStatuses(
  nodes: readonly RoadmapNodeSpec[],
  mastery: ReadonlyMap<string, number | null>,
): NodeStatus[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const level = (id: string): number | null => mastery.get(id) ?? null;
  const cleared = (id: string): boolean => {
    const n = byId.get(id);
    return (level(id) ?? 0) >= (n?.unlockThreshold ?? DEFAULT_UNLOCK);
  };
  return nodes.map((n) => {
    const blockedBy = n.requires.filter((r) => !cleared(r));
    const m = level(n.id);
    let state: NodeState;
    const unlock = n.unlockThreshold ?? DEFAULT_UNLOCK;
    const master = Math.max(unlock, n.masterThreshold ?? DEFAULT_MASTER);
    if (blockedBy.length > 0) state = "locked";
    else if ((m ?? 0) < unlock) state = "open";
    else if ((m ?? 0) >= master) state = "mastered";
    else state = "cleared";
    return { id: n.id, state, mastery: m, blockedBy };
  });
}

/** The node to work on next: the open node with the lowest layer, then the lowest mastery; null when none is open. */
export function nextNode(
  nodes: readonly RoadmapNodeSpec[],
  statuses: readonly NodeStatus[],
): string | null {
  const layer = depths(nodes);
  const open = statuses.filter((s) => s.state === "open");
  open.sort(
    (a, b) =>
      (layer.get(a.id) ?? 0) - (layer.get(b.id) ?? 0) ||
      (a.mastery ?? 0) - (b.mastery ?? 0) ||
      a.id.localeCompare(b.id),
  );
  return open[0]?.id ?? null;
}
