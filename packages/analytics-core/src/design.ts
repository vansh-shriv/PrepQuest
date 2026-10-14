// System design practice (C3): the canvas model, editing operations with undo, the conversion to a graph a
// model can read, deterministic design checks and the capacity estimate calculator. Pure.

export const NODE_TYPES = [
  "client",
  "load_balancer",
  "service",
  "cache",
  "database",
  "queue",
  "cdn",
  "storage",
  "external",
  "note",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_LABEL: Record<NodeType, string> = {
  client: "Client",
  load_balancer: "Load balancer",
  service: "Service",
  cache: "Cache",
  database: "Database",
  queue: "Queue",
  cdn: "CDN",
  storage: "Object storage",
  external: "External system",
  note: "Note",
};

export interface DesignNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
}

export interface DesignEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface DesignCanvas {
  nodes: DesignNode[];
  edges: DesignEdge[];
}

export const EMPTY_CANVAS: DesignCanvas = { nodes: [], edges: [] };

export const GRID = 20;
export const LIMITS = {
  nodes: 60,
  edges: 120,
  label: 40,
  noteLabel: 200,
  coordinate: 5000,
  history: 100,
} as const;

export const snap = (v: number) => Math.round(v / GRID) * GRID;

const clamp = (v: number) => Math.max(-LIMITS.coordinate, Math.min(LIMITS.coordinate, v));

/** Problems with a canvas, in plain words (empty when it is valid). */
export function validateCanvas(c: DesignCanvas): string[] {
  const issues: string[] = [];
  if (c.nodes.length > LIMITS.nodes) issues.push(`at most ${LIMITS.nodes} components`);
  if (c.edges.length > LIMITS.edges) issues.push(`at most ${LIMITS.edges} connections`);
  const ids = new Set<string>();
  for (const n of c.nodes) {
    if (ids.has(n.id)) issues.push(`two components share the id ${n.id}`);
    ids.add(n.id);
    if (!(NODE_TYPES as readonly string[]).includes(n.type)) {
      issues.push(`unknown component type ${n.type}`);
    }
    const max = n.type === "note" ? LIMITS.noteLabel : LIMITS.label;
    if (n.label.length > max) issues.push(`label of ${n.id} is longer than ${max} characters`);
    if (
      !Number.isFinite(n.x) ||
      !Number.isFinite(n.y) ||
      Math.abs(n.x) > LIMITS.coordinate ||
      Math.abs(n.y) > LIMITS.coordinate
    ) {
      issues.push(`${n.id} is outside the canvas`);
    }
  }
  const edgeIds = new Set<string>();
  for (const e of c.edges) {
    if (edgeIds.has(e.id)) issues.push(`two connections share the id ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.from) || !ids.has(e.to))
      issues.push(`connection ${e.id} points at a missing component`);
    if (e.from === e.to) issues.push(`connection ${e.id} connects a component to itself`);
    if (e.label.length > LIMITS.label) issues.push(`label of ${e.id} is too long`);
  }
  return issues;
}

// ---------------------------------------------------------------- editing

let counter = 0;
/** A short id that is unique within the canvas. */
export function freshId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (;;) {
    counter = (counter + 1) % 1_000_000;
    const id = `${prefix}${Date.now().toString(36).slice(-3)}${counter.toString(36)}`;
    if (!used.has(id)) return id;
  }
}

export function addNode(
  c: DesignCanvas,
  type: NodeType,
  at: { x: number; y: number },
  label = NODE_LABEL[type],
): { canvas: DesignCanvas; id: string } {
  if (c.nodes.length >= LIMITS.nodes) return { canvas: c, id: "" };
  const id = freshId(
    "n",
    c.nodes.map((n) => n.id),
  );
  const node: DesignNode = { id, type, label, x: snap(clamp(at.x)), y: snap(clamp(at.y)) };
  return { canvas: { ...c, nodes: [...c.nodes, node] }, id };
}

export function moveNode(c: DesignCanvas, id: string, to: { x: number; y: number }): DesignCanvas {
  return {
    ...c,
    nodes: c.nodes.map((n) =>
      n.id === id ? { ...n, x: snap(clamp(to.x)), y: snap(clamp(to.y)) } : n,
    ),
  };
}

export function relabelNode(c: DesignCanvas, id: string, label: string): DesignCanvas {
  return {
    ...c,
    nodes: c.nodes.map((n) =>
      n.id === id
        ? { ...n, label: label.slice(0, n.type === "note" ? LIMITS.noteLabel : LIMITS.label) }
        : n,
    ),
  };
}

/** Removes a component and every connection that touched it. */
export function removeNode(c: DesignCanvas, id: string): DesignCanvas {
  return {
    nodes: c.nodes.filter((n) => n.id !== id),
    edges: c.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

/** Connects two components; the same direction is never added twice, and a note has no connections. */
export function connect(
  c: DesignCanvas,
  from: string,
  to: string,
  label = "",
): { canvas: DesignCanvas; id: string } {
  const a = c.nodes.find((n) => n.id === from);
  const b = c.nodes.find((n) => n.id === to);
  if (!a || !b || from === to || a.type === "note" || b.type === "note")
    return { canvas: c, id: "" };
  if (c.edges.some((e) => e.from === from && e.to === to)) return { canvas: c, id: "" };
  if (c.edges.length >= LIMITS.edges) return { canvas: c, id: "" };
  const id = freshId(
    "e",
    c.edges.map((e) => e.id),
  );
  return {
    canvas: { ...c, edges: [...c.edges, { id, from, to, label: label.slice(0, LIMITS.label) }] },
    id,
  };
}

export function relabelEdge(c: DesignCanvas, id: string, label: string): DesignCanvas {
  return {
    ...c,
    edges: c.edges.map((e) => (e.id === id ? { ...e, label: label.slice(0, LIMITS.label) } : e)),
  };
}

export function removeEdge(c: DesignCanvas, id: string): DesignCanvas {
  return { ...c, edges: c.edges.filter((e) => e.id !== id) };
}

/** Flips the direction of a connection. */
export function reverseEdge(c: DesignCanvas, id: string): DesignCanvas {
  return {
    ...c,
    edges: c.edges.map((e) => (e.id === id ? { ...e, from: e.to, to: e.from } : e)),
  };
}

// ---------------------------------------------------------------- undo and redo

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Records a new state; the redo stack is dropped and only the last `limit` steps are kept. */
export function record<T>(h: History<T>, next: T, limit: number = LIMITS.history): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const previous = h.past[h.past.length - 1];
  if (previous === undefined) return h;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
}

// ---------------------------------------------------------------- graph for the model

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  /** Ids this component sends to. */
  out: string[];
  /** Ids that send to this component. */
  in: string[];
}

export interface DesignGraph {
  nodes: GraphNode[];
  edges: Array<{ from: string; to: string; label: string }>;
  notes: string[];
}

/** The canvas as a graph: component types, direction of every connection, free text notes apart. */
export function canvasToGraph(c: DesignCanvas): DesignGraph {
  const real = c.nodes.filter((n) => n.type !== "note");
  const ids = new Set(real.map((n) => n.id));
  const edges = c.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return {
    nodes: real.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      out: edges.filter((e) => e.from === n.id).map((e) => e.to),
      in: edges.filter((e) => e.to === n.id).map((e) => e.from),
    })),
    edges: edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
    notes: c.nodes.filter((n) => n.type === "note").map((n) => n.label),
  };
}

/** The graph as text for a prompt: one line per component and per connection, with ids the answer can cite. */
export function describeGraph(c: DesignCanvas): string {
  const g = canvasToGraph(c);
  const name = new Map(g.nodes.map((n) => [n.id, n.label]));
  const lines = g.nodes.map((n) => `- [${n.id}] ${n.type}: ${n.label}`);
  const edges = g.edges.map(
    (e) =>
      `- [${e.from}] ${name.get(e.from)} -> [${e.to}] ${name.get(e.to)}${e.label ? ` (${e.label})` : ""}`,
  );
  return [
    `COMPONENTS (${g.nodes.length}):`,
    ...(lines.length > 0 ? lines : ["- none"]),
    `CONNECTIONS (${g.edges.length}), arrow = direction of the request or data:`,
    ...(edges.length > 0 ? edges : ["- none"]),
    ...(g.notes.length > 0 ? ["NOTES ON THE CANVAS:", ...g.notes.map((n) => `- ${n}`)] : []),
  ].join("\n");
}

// ---------------------------------------------------------------- deterministic checks

export type FindingSeverity = "important" | "suggestion";

export interface DesignFinding {
  code: string;
  severity: FindingSeverity;
  message: string;
  nodeIds: string[];
}

const REPLICA = /replica|secondary|standby|follower|shard|cluster/i;

/** Things that can be said about a design without a model. Facts about the drawing, not opinions on the idea. */
export function analyzeDesign(c: DesignCanvas): DesignFinding[] {
  const g = canvasToGraph(c);
  const out: DesignFinding[] = [];
  const of = (t: NodeType) => g.nodes.filter((n) => n.type === t);
  if (g.nodes.length === 0) {
    return [
      {
        code: "empty",
        severity: "important",
        message: "The canvas is empty. Start with who uses the system (a client).",
        nodeIds: [],
      },
    ];
  }
  if (of("client").length === 0) {
    out.push({
      code: "no-client",
      severity: "suggestion",
      message: "There is no client. Show who calls the system.",
      nodeIds: [],
    });
  }
  const loose = g.nodes.filter((n) => n.in.length === 0 && n.out.length === 0);
  if (loose.length > 0 && g.nodes.length > 1) {
    out.push({
      code: "disconnected",
      severity: "important",
      message: `${loose.map((n) => n.label).join(", ")} ${loose.length > 1 ? "are" : "is"} not connected to anything.`,
      nodeIds: loose.map((n) => n.id),
    });
  }
  const services = of("service");
  if (services.length >= 2 && of("load_balancer").length === 0) {
    out.push({
      code: "no-load-balancer",
      severity: "important",
      message: "There are several services but nothing that spreads traffic between instances.",
      nodeIds: services.map((s) => s.id),
    });
  }
  const databases = of("database");
  const usedDbs = databases.filter((d) => d.in.length > 0);
  const hasReplication = databases.length >= 2 || databases.some((d) => REPLICA.test(d.label));
  if (usedDbs.length > 0 && !hasReplication) {
    out.push({
      code: "single-database",
      severity: "important",
      message:
        "One database with no replica or standby: if it fails the whole system stops. Show a replica or a sharded cluster.",
      nodeIds: usedDbs.map((d) => d.id),
    });
  }
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const reachesDb = services.filter((s) => s.out.some((id) => byId.get(id)?.type === "database"));
  if (reachesDb.length > 0 && of("cache").length === 0) {
    out.push({
      code: "no-cache",
      severity: "suggestion",
      message:
        "Services read straight from the database. A cache in front of it takes most of the read load.",
      nodeIds: reachesDb.map((s) => s.id),
    });
  }
  const unlabeled = g.edges.filter((e) => e.label.trim() === "");
  if (g.edges.length >= 3 && unlabeled.length / g.edges.length > 0.5) {
    out.push({
      code: "unlabeled-connections",
      severity: "suggestion",
      message: "Most connections have no label. Say what flows over each (protocol, data, event).",
      nodeIds: [],
    });
  }
  const queues = of("queue");
  const deadQueues = queues.filter((q) => q.in.length === 0 || q.out.length === 0);
  if (deadQueues.length > 0) {
    out.push({
      code: "one-sided-queue",
      severity: "important",
      message: `${deadQueues.map((q) => q.label).join(", ")} has no ${deadQueues.some((q) => q.in.length === 0) ? "producer" : "consumer"}.`,
      nodeIds: deadQueues.map((q) => q.id),
    });
  }
  return out;
}

// ---------------------------------------------------------------- capacity estimates

export interface LoadEstimateInput {
  /** Daily active users. */
  dau: number;
  /** Actions per user per day. */
  actionsPerUser: number;
  /** Reads for every write (e.g. 100 for a read-heavy system). */
  readWriteRatio: number;
  /** Average size of one stored item, in bytes. */
  bytesPerWrite: number;
  /** Average size of one response, in bytes. */
  bytesPerRead: number;
  /** Years the data is kept. */
  retentionYears: number;
  /** Peak traffic as a multiple of the average. */
  peakFactor: number;
}

export interface LoadEstimate {
  avgQps: number;
  peakQps: number;
  readQps: number;
  writeQps: number;
  /** New data per day. */
  storagePerDayGB: number;
  storageTotalTB: number;
  /** Outgoing traffic at peak. */
  bandwidthMbps: number;
}

export const DEFAULT_LOAD_ESTIMATE: LoadEstimateInput = {
  dau: 1_000_000,
  actionsPerUser: 10,
  readWriteRatio: 10,
  bytesPerWrite: 500,
  bytesPerRead: 2000,
  retentionYears: 5,
  peakFactor: 3,
};

const DAY = 86_400;

export function estimateLoad(i: LoadEstimateInput): LoadEstimate {
  const perDay = Math.max(0, i.dau) * Math.max(0, i.actionsPerUser);
  const avgQps = perDay / DAY;
  const ratio = Math.max(0, i.readWriteRatio);
  const writeQps = avgQps / (1 + ratio);
  const readQps = avgQps - writeQps;
  const peakQps = avgQps * Math.max(1, i.peakFactor);
  const writesPerDay = writeQps * DAY;
  const storagePerDayBytes = writesPerDay * Math.max(0, i.bytesPerWrite);
  const storagePerDayGB = storagePerDayBytes / 1e9;
  const storageTotalTB = (storagePerDayBytes * 365 * Math.max(0, i.retentionYears)) / 1e12;
  const peakRead = readQps * Math.max(1, i.peakFactor);
  const bandwidthMbps = (peakRead * Math.max(0, i.bytesPerRead) * 8) / 1e6;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    avgQps: r(avgQps),
    peakQps: r(peakQps),
    readQps: r(readQps),
    writeQps: r(writeQps),
    storagePerDayGB: r(storagePerDayGB),
    storageTotalTB: r(storageTotalTB),
    bandwidthMbps: r(bandwidthMbps),
  };
}
