import {
  GRID,
  NODE_LABEL,
  type DesignCanvas,
  type DesignNode,
  type NodeType,
} from "@prepquest/analytics-core";

// Pure helpers for the design canvas (no I/O, unit tested): box sizes, connection geometry, where a new
// component goes, and the drawing as an SVG string for the PNG export.

export const CANVAS_WIDTH = 1400;
export const CANVAS_HEIGHT = 800;

/** A short tag drawn on each component so the type reads without colour. */
export const NODE_GLYPH: Record<NodeType, string> = {
  client: "CLIENT",
  load_balancer: "LB",
  service: "SERVICE",
  cache: "CACHE",
  database: "DB",
  queue: "QUEUE",
  cdn: "CDN",
  storage: "STORE",
  external: "EXT",
  note: "NOTE",
};

/** The design token that colours each type. */
export const NODE_TOKEN: Record<NodeType, string> = {
  client: "--sky-light",
  load_balancer: "--lime",
  service: "--folder",
  cache: "--coin",
  database: "--sky",
  queue: "--blossom",
  cdn: "--leaf",
  storage: "--olive",
  external: "--cursor",
  note: "--surface",
};

export const BOX = { w: 140, h: 56 } as const;
export const NOTE_BOX = { w: 180, h: 84 } as const;

export function nodeBox(n: Pick<DesignNode, "x" | "y" | "type">) {
  const size = n.type === "note" ? NOTE_BOX : BOX;
  return { x: n.x, y: n.y, w: size.w, h: size.h };
}

export const center = (n: Pick<DesignNode, "x" | "y" | "type">) => {
  const b = nodeBox(n);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
};

/** Where the line from the centre of a box towards a point leaves the box. */
function exit(
  box: { x: number; y: number; w: number; h: number },
  toward: { x: number; y: number },
): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Infinity : box.w / 2 / Math.abs(dx),
    dy === 0 ? Infinity : box.h / 2 / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export interface EdgeGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The three points of the arrow head at the target end. */
  head: Array<{ x: number; y: number }>;
  label: { x: number; y: number };
}

/** A connection from one box edge to the other, with an arrow head and a label spot at the middle. */
export function edgeGeometry(
  from: Pick<DesignNode, "x" | "y" | "type">,
  to: Pick<DesignNode, "x" | "y" | "type">,
): EdgeGeometry {
  const a = exit(nodeBox(from), center(to));
  const b = exit(nodeBox(to), center(from));
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const size = 11;
  const head = [
    { x: b.x, y: b.y },
    {
      x: b.x - size * Math.cos(angle - Math.PI / 6),
      y: b.y - size * Math.sin(angle - Math.PI / 6),
    },
    {
      x: b.x - size * Math.cos(angle + Math.PI / 6),
      y: b.y - size * Math.sin(angle + Math.PI / 6),
    },
  ];
  return {
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    head,
    label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a, gap = GRID) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/** The first free spot on the grid, reading left to right, top to bottom, for a component of this type. */
export function nextSpot(canvas: DesignCanvas, type: NodeType): { x: number; y: number } {
  const size = type === "note" ? NOTE_BOX : BOX;
  const placed = canvas.nodes.map(nodeBox);
  for (let y = 40; y < CANVAS_HEIGHT - size.h; y += 100) {
    for (let x = 40; x < CANVAS_WIDTH - size.w; x += 200) {
      const probe = { x, y, w: size.w, h: size.h };
      if (!placed.some((p) => overlaps(p, probe))) return { x, y };
    }
  }
  return { x: 40, y: 40 };
}

/** Cuts a label so it fits a box of this many characters, with an ellipsis. */
export function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** The text of one connection for the outline: "Browser to Service (HTTPS)". */
export function describeEdge(canvas: DesignCanvas, edgeId: string): string {
  const e = canvas.edges.find((x) => x.id === edgeId);
  if (!e) return "";
  const name = (id: string) => canvas.nodes.find((n) => n.id === id)?.label ?? "?";
  return `${name(e.from)} to ${name(e.to)}${e.label ? ` (${e.label})` : ""}`;
}

/** Screen reader label of a component. */
export function nodeLabel(canvas: DesignCanvas, n: DesignNode): string {
  if (n.type === "note") return `Note: ${n.label}`;
  const out = canvas.edges.filter((e) => e.from === n.id).length;
  const incoming = canvas.edges.filter((e) => e.to === n.id).length;
  return `${NODE_LABEL[n.type]}: ${n.label}. ${incoming} in, ${out} out.`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Palette {
  ink: string;
  surface: string;
  /** Fill colour for each node type. */
  fills: Record<NodeType, string>;
}

/** The drawing as a standalone SVG (colours passed in, since design tokens do not exist outside the page). */
export function canvasToSvg(canvas: DesignCanvas, palette: Palette): string {
  const boxes = canvas.nodes.map((n) => nodeBox(n));
  const pad = 40;
  const minX = Math.min(0, ...boxes.map((b) => b.x)) - pad + 40;
  const minY = Math.min(0, ...boxes.map((b) => b.y)) - pad + 40;
  const maxX = Math.max(400, ...boxes.map((b) => b.x + b.w)) + pad;
  const maxY = Math.max(200, ...boxes.map((b) => b.y + b.h)) + pad;
  const width = Math.round(maxX - minX);
  const height = Math.round(maxY - minY);
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="monospace" font-size="13">`,
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${palette.surface}"/>`,
  ];
  for (const e of canvas.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const g = edgeGeometry(a, b);
    lines.push(
      `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="${palette.ink}" stroke-width="3"/>`,
      `<polygon points="${g.head.map((p) => `${p.x},${p.y}`).join(" ")}" fill="${palette.ink}"/>`,
    );
    if (e.label) {
      lines.push(
        `<text x="${g.label.x}" y="${g.label.y - 6}" text-anchor="middle" fill="${palette.ink}">${esc(fit(e.label, 28))}</text>`,
      );
    }
  }
  for (const n of canvas.nodes) {
    const b = nodeBox(n);
    lines.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${palette.fills[n.type]}" stroke="${palette.ink}" stroke-width="3"/>`,
      `<text x="${b.x + 8}" y="${b.y + 16}" fill="${palette.ink}" font-size="10">${NODE_GLYPH[n.type]}</text>`,
      `<text x="${b.x + 8}" y="${b.y + 38}" fill="${palette.ink}">${esc(fit(n.label, n.type === "note" ? 24 : 16))}</text>`,
    );
  }
  lines.push("</svg>");
  return lines.join("");
}

/** The file contents of a JSON export. */
export function exportJson(title: string, canvas: DesignCanvas, panel: unknown): string {
  return JSON.stringify({ format: "prepquest-design", title, canvas, panel }, null, 2);
}

export const fileName = (title: string, ext: string) =>
  `${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "design"
  }.${ext}`;

/** The order in which the toolbar offers component types. */
export const TOOLBAR: NodeType[] = [
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
];

export function saveStateText(s: "saved" | "saving" | "dirty" | "conflict" | "error"): string {
  return s === "saved"
    ? "All changes saved"
    : s === "saving"
      ? "Saving…"
      : s === "dirty"
        ? "Unsaved changes"
        : s === "conflict"
          ? "Changed somewhere else"
          : "Could not save";
}
