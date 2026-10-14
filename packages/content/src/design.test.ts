import { describe, expect, it } from "vitest";
import { findContentRoot } from "./root.js";
import { loadDesign, validateDesign, type LoadedDesign } from "./design.js";

describe("committed design prompts", () => {
  it("load and validate with no issues", async () => {
    const loaded = await loadDesign(findContentRoot());
    expect(loaded.issues).toEqual([]);
    expect(loaded.prompts.map((p) => p.slug).sort()).toEqual([
      "chat-app",
      "file-storage",
      "news-feed",
      "url-shortener",
    ]);
    expect(validateDesign(loaded)).toEqual([]);
  });
});

describe("validateDesign", () => {
  it("rejects a finished design that fails its own checks", async () => {
    const loaded = await loadDesign(findContentRoot());
    const broken: LoadedDesign = {
      issues: [],
      prompts: loaded.prompts.map((p, i) =>
        i === 0
          ? {
              ...p,
              // the third version loses its replica: a single database
              reference: {
                ...p.reference,
                v3: {
                  ...p.reference.v3,
                  canvas: {
                    nodes: p.reference.v3.canvas.nodes
                      .filter((n) => !/replica/i.test(n.label))
                      .map((n) => (n.type === "database" ? { ...n, label: "Database" } : n)),
                    edges: p.reference.v3.canvas.edges.filter(
                      (e) => e.from !== "r" && e.to !== "r",
                    ),
                  },
                },
              },
            }
          : p,
      ),
    };
    const issues = validateDesign(broken);
    expect(issues.some((i) => i.message.includes("single-database"))).toBe(true);
  });

  it("rejects a connection to a missing component", async () => {
    const loaded = await loadDesign(findContentRoot());
    const p = loaded.prompts[0]!;
    const bad: LoadedDesign = {
      issues: [],
      prompts: [
        {
          ...p,
          reference: {
            ...p.reference,
            v1: {
              ...p.reference.v1,
              canvas: {
                ...p.reference.v1.canvas,
                edges: [{ id: "x", from: "nope", to: "s", label: "" }],
              },
            },
          },
        },
      ],
    };
    expect(validateDesign(bad).some((i) => i.message.includes("missing component"))).toBe(true);
  });
});
