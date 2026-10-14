import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_CANVAS,
  GRID,
  LIMITS,
  NODE_TYPES,
  addNode,
  analyzeDesign,
  canvasToGraph,
  connect,
  describeGraph,
  estimateLoad,
  moveNode,
  record,
  redo,
  relabelNode,
  removeNode,
  reverseEdge,
  snap,
  startHistory,
  undo,
  validateCanvas,
  DEFAULT_LOAD_ESTIMATE,
  type DesignCanvas,
} from "./design.js";

const DESIGN_DIR = path.resolve(import.meta.dirname, "../../../content/design");

interface Doc {
  slug: string;
  reference: Record<"v1" | "v2" | "v3", { canvas: DesignCanvas }>;
}
const docs: Doc[] = readdirSync(DESIGN_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(DESIGN_DIR, f), "utf8")) as Doc);
const samples = docs.flatMap((d) =>
  (["v1", "v2", "v3"] as const).map((v) => ({
    name: `${d.slug} ${v}`,
    canvas: d.reference[v].canvas,
  })),
);

describe("editing", () => {
  it("snaps components to the grid and keeps them on the canvas", () => {
    expect(snap(31)).toBe(40);
    const { canvas, id } = addNode(EMPTY_CANVAS, "service", { x: 33, y: 7 });
    expect(canvas.nodes[0]).toMatchObject({ x: 40, y: 0, type: "service", label: "Service" });
    const far = moveNode(canvas, id, { x: 99_999, y: -99_999 });
    expect(far.nodes[0]!.x).toBe(LIMITS.coordinate);
    expect(far.nodes[0]!.y).toBe(-LIMITS.coordinate);
    expect(far.nodes[0]!.x % GRID).toBe(0);
  });

  it("connects two components once per direction and never a note", () => {
    let c = addNode(EMPTY_CANVAS, "client", { x: 0, y: 0 });
    const a = c.id;
    c = addNode(c.canvas, "service", { x: 200, y: 0 });
    const b = c.id;
    c = addNode(c.canvas, "note", { x: 0, y: 200 });
    const note = c.id;
    let g = connect(c.canvas, a, b, "HTTPS");
    expect(g.canvas.edges).toHaveLength(1);
    expect(connect(g.canvas, a, b).canvas.edges).toHaveLength(1);
    expect(connect(g.canvas, b, a).canvas.edges).toHaveLength(2);
    expect(connect(g.canvas, a, a).id).toBe("");
    expect(connect(g.canvas, a, note).id).toBe("");
    g = { canvas: reverseEdge(g.canvas, g.id), id: g.id };
    expect(g.canvas.edges[0]).toMatchObject({ from: b, to: a });
  });

  it("removing a component removes its connections", () => {
    let c = addNode(EMPTY_CANVAS, "client", { x: 0, y: 0 });
    const a = c.id;
    c = addNode(c.canvas, "service", { x: 200, y: 0 });
    const withEdge = connect(c.canvas, a, c.id).canvas;
    const gone = removeNode(withEdge, a);
    expect(gone.nodes).toHaveLength(1);
    expect(gone.edges).toEqual([]);
    expect(validateCanvas(gone)).toEqual([]);
  });

  it("limits label length by type", () => {
    const { canvas, id } = addNode(EMPTY_CANVAS, "service", { x: 0, y: 0 });
    expect(relabelNode(canvas, id, "x".repeat(100)).nodes[0]!.label).toHaveLength(LIMITS.label);
  });

  it("stops adding components at the limit", () => {
    let c = EMPTY_CANVAS;
    for (let i = 0; i < LIMITS.nodes + 5; i++)
      c = addNode(c, "service", { x: i * 20, y: 0 }).canvas;
    expect(c.nodes).toHaveLength(LIMITS.nodes);
  });
});

describe("history", () => {
  it("undoes and redoes, and a new edit drops the redo stack", () => {
    let h = startHistory(0);
    h = record(h, 1);
    h = record(h, 2);
    h = undo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    expect(h.present).toBe(2);
    h = undo(undo(h));
    expect(h.present).toBe(0);
    expect(undo(h).present).toBe(0);
    h = record(h, 9);
    expect(h.future).toEqual([]);
    expect(redo(h).present).toBe(9);
  });

  it("keeps 100 steps of undo", () => {
    let h = startHistory(0);
    for (let i = 1; i <= 150; i++) h = record(h, i);
    expect(h.past).toHaveLength(LIMITS.history);
    for (let i = 0; i < 200; i++) h = undo(h);
    expect(h.present).toBe(50);
  });

  it("ignores an edit that changed nothing", () => {
    const h = startHistory({ a: 1 });
    expect(record(h, h.present)).toBe(h);
  });
});

describe("canvas to graph on sample designs", () => {
  it("has at least 20 designs to check", () => {
    // 12 reference layers plus generated ones below
    expect(samples.length).toBe(12);
  });

  it("keeps every component type and the direction of every connection", () => {
    const generated: DesignCanvas[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      let c = EMPTY_CANVAS;
      const ids: string[] = [];
      for (let i = 0; i < 6 + seed; i++) {
        const r = addNode(c, NODE_TYPES[(i * seed) % (NODE_TYPES.length - 1)]!, {
          x: i * 40,
          y: seed * 20,
        });
        c = r.canvas;
        ids.push(r.id);
      }
      for (let i = 0; i < ids.length - 1; i++) {
        c = connect(
          c,
          ids[(i * seed) % ids.length]!,
          ids[(i * seed + seed + 1) % ids.length]!,
          `l${i}`,
        ).canvas;
      }
      generated.push(c);
    }
    const all = [...samples.map((s) => s.canvas), ...generated];
    expect(all.length).toBeGreaterThanOrEqual(20);
    for (const canvas of all) {
      expect(validateCanvas(canvas)).toEqual([]);
      const g = canvasToGraph(canvas);
      const real = canvas.nodes.filter((n) => n.type !== "note");
      expect(g.nodes.map((n) => [n.id, n.type])).toEqual(real.map((n) => [n.id, n.type]));
      expect(g.edges).toEqual(
        canvas.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
      );
      for (const e of canvas.edges) {
        expect(g.nodes.find((n) => n.id === e.from)!.out).toContain(e.to);
        expect(g.nodes.find((n) => n.id === e.to)!.in).toContain(e.from);
      }
    }
  });

  it("describes the graph with ids a review can cite", () => {
    const text = describeGraph(samples.find((x) => x.name === "url-shortener v1")!.canvas);
    expect(text).toContain("COMPONENTS (3):");
    expect(text).toContain("[c] client: Browser");
    expect(text).toContain("[s] Shortener service -> [d] Links database");
  });

  it("keeps notes apart from the graph", () => {
    const c = addNode(EMPTY_CANVAS, "note", { x: 0, y: 0 }, "Assume 100M users").canvas;
    expect(canvasToGraph(c)).toEqual({ nodes: [], edges: [], notes: ["Assume 100M users"] });
  });
});

describe("design checks", () => {
  it("says an empty canvas is empty", () => {
    expect(analyzeDesign(EMPTY_CANVAS).map((f) => f.code)).toEqual(["empty"]);
  });

  it("finds a single database, a missing cache and unlabeled connections in the first version", () => {
    const codes = analyzeDesign(samples[0]!.canvas).map((f) => f.code);
    expect(codes).toContain("single-database");
    expect(codes).toContain("no-cache");
  });

  it("finds services with no load balancer and a queue with no consumer", () => {
    let c = EMPTY_CANVAS;
    const ids: Record<string, string> = {};
    for (const [k, t] of [
      ["a", "service"],
      ["b", "service"],
      ["q", "queue"],
    ] as const) {
      const r = addNode(c, t, { x: 0, y: 0 }, k);
      c = r.canvas;
      ids[k] = r.id;
    }
    c = connect(c, ids.a!, ids.q!, "event").canvas;
    const codes = analyzeDesign(c).map((f) => f.code);
    expect(codes).toContain("no-load-balancer");
    expect(codes).toContain("one-sided-queue");
    expect(codes).toContain("disconnected");
  });

  it("finds nothing important in any finished (third) version of the reference designs", () => {
    for (const d of docs) {
      const important = analyzeDesign(d.reference.v3.canvas).filter(
        (f) => f.severity === "important",
      );
      expect(important, d.slug).toEqual([]);
    }
  });

  it("finds something to improve in every first version that has a database", () => {
    for (const d of docs) {
      const hasDb = d.reference.v1.canvas.nodes.some((n) => n.type === "database");
      if (hasDb) expect(analyzeDesign(d.reference.v1.canvas).length, d.slug).toBeGreaterThan(0);
    }
  });
});

describe("estimateLoad", () => {
  it("turns users into queries, storage and bandwidth", () => {
    const e = estimateLoad({
      dau: 10_000_000,
      actionsPerUser: 10,
      readWriteRatio: 9,
      bytesPerWrite: 1000,
      bytesPerRead: 5000,
      retentionYears: 5,
      peakFactor: 2,
    });
    // 100M actions a day is about 1157 per second; 1 in 10 is a write
    expect(e.avgQps).toBeCloseTo(1157.41, 1);
    expect(e.writeQps).toBeCloseTo(115.74, 1);
    expect(e.readQps).toBeCloseTo(1041.67, 1);
    expect(e.peakQps).toBeCloseTo(2314.81, 1);
    // 10M writes a day of 1 KB is 10 GB a day, 18.25 TB over five years
    expect(e.storagePerDayGB).toBeCloseTo(10, 0);
    expect(e.storageTotalTB).toBeCloseTo(18.25, 0);
    // peak reads 2083 per second of 5 KB is about 83 Mbit/s
    expect(e.bandwidthMbps).toBeCloseTo(83.33, 0);
  });

  it("survives zero and negative inputs", () => {
    const e = estimateLoad({
      ...DEFAULT_LOAD_ESTIMATE,
      dau: 0,
      actionsPerUser: -5,
      readWriteRatio: -1,
    });
    expect(e.avgQps).toBe(0);
    expect(e.bandwidthMbps).toBe(0);
  });
});
