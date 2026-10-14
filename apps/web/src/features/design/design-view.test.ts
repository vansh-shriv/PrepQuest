import { describe, expect, it } from "vitest";
import {
  EMPTY_CANVAS,
  addNode,
  connect,
  type DesignCanvas,
  type NodeType,
} from "@prepquest/analytics-core";
import {
  BOX,
  NODE_GLYPH,
  TOOLBAR,
  canvasToSvg,
  describeEdge,
  edgeGeometry,
  fileName,
  fit,
  nextSpot,
  nodeBox,
  nodeLabel,
  type Palette,
} from "./design-view";

const palette: Palette = {
  ink: "#111",
  surface: "#fff",
  fills: Object.fromEntries(TOOLBAR.map((t) => [t, "#ccc"])) as Record<NodeType, string>,
};

function sample(): { canvas: DesignCanvas; a: string; b: string } {
  const a = addNode(EMPTY_CANVAS, "client", { x: 40, y: 40 }, "Browser & app");
  const b = addNode(a.canvas, "service", { x: 340, y: 40 }, "API <v1>");
  const e = connect(b.canvas, a.id, b.id, "HTTPS");
  return { canvas: e.canvas, a: a.id, b: b.id };
}

describe("edgeGeometry", () => {
  it("runs from the edge of one box to the edge of the other, pointing at the target", () => {
    const from = { x: 0, y: 0, type: "client" as const };
    const to = { x: 300, y: 0, type: "service" as const };
    const g = edgeGeometry(from, to);
    expect(g.x1).toBe(BOX.w); // leaves the right side of the first box
    expect(g.y1).toBe(BOX.h / 2);
    expect(g.x2).toBe(300); // arrives at the left side of the second
    expect(g.head[0]).toEqual({ x: 300, y: BOX.h / 2 });
    // the head's other two points lie behind the tip
    expect(g.head[1]!.x).toBeLessThan(300);
    expect(g.head[2]!.x).toBeLessThan(300);
    expect(g.label.x).toBe((g.x1 + g.x2) / 2);
  });

  it("leaves through the top or bottom for a connection that goes mostly up or down", () => {
    const g = edgeGeometry({ x: 0, y: 0, type: "service" }, { x: 20, y: 400, type: "database" });
    expect(g.y1).toBe(BOX.h);
    expect(g.y2).toBe(400);
  });

  it("does not break when two boxes sit on top of each other", () => {
    const g = edgeGeometry({ x: 0, y: 0, type: "service" }, { x: 0, y: 0, type: "service" });
    expect(Number.isFinite(g.x1) && Number.isFinite(g.x2)).toBe(true);
  });
});

describe("nextSpot", () => {
  it("starts at the top left and never lands on an existing component", () => {
    let c: DesignCanvas = EMPTY_CANVAS;
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const at = nextSpot(c, "service");
      const key = `${at.x},${at.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      c = addNode(c, "service", at).canvas;
    }
    expect(c.nodes).toHaveLength(12);
    const boxes = c.nodes.map(nodeBox);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
  });
});

describe("text", () => {
  it("cuts long labels", () => {
    expect(fit("short", 10)).toBe("short");
    expect(fit("a very long component name", 10)).toBe("a very lo…");
  });
  it("describes components and connections for a screen reader", () => {
    const { canvas, a } = sample();
    expect(
      nodeLabel(
        canvas,
        canvas.nodes.find((n) => n.id === a)!,
      ),
    ).toBe("Client: Browser & app. 0 in, 1 out.");
    expect(describeEdge(canvas, canvas.edges[0]!.id)).toBe("Browser & app to API <v1> (HTTPS)");
  });
  it("names export files from the title", () => {
    expect(fileName("Design a URL shortener!", "png")).toBe("design-a-url-shortener.png");
    expect(fileName("***", "json")).toBe("design.json");
  });
  it("has a tag for every type the toolbar offers", () => {
    for (const t of TOOLBAR) expect(NODE_GLYPH[t].length).toBeGreaterThan(0);
  });
});

describe("canvasToSvg", () => {
  it("draws every component and connection and escapes text", () => {
    const { canvas } = sample();
    const svg = canvasToSvg(canvas, palette);
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/<rect /g) ?? []).length).toBe(1 + 2); // background and two boxes
    expect(svg).toContain("<polygon");
    expect(svg).toContain("Browser &amp; app");
    expect(svg).toContain("API &lt;v1&gt;");
    expect(svg).toContain("HTTPS");
    expect(svg).not.toContain("<v1>");
  });
  it("makes a valid empty image", () => {
    const svg = canvasToSvg(EMPTY_CANVAS, palette);
    expect(svg).toContain("viewBox=");
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});
