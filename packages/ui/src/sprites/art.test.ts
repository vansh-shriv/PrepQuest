import { describe, expect, it } from "vitest";
import { SPRITES, SPRITE_NAMES, toRuns, type SpriteArt } from "./art";

describe("sprite art", () => {
  for (const name of SPRITE_NAMES) {
    const art: SpriteArt = SPRITES[name];

    it(`${name}: rows have equal width`, () => {
      const widths = new Set(art.rows.map((r) => r.length));
      expect([...widths]).toHaveLength(1);
    });

    it(`${name}: every used character is in the palette`, () => {
      expect(() => toRuns(art)).not.toThrow();
    });
  }

  it("toRuns merges adjacent pixels of the same color", () => {
    const runs = toRuns({ palette: { A: "red" }, rows: ["AAA.A"] });
    expect(runs).toEqual([
      { x: 0, y: 0, w: 3, color: "red" },
      { x: 4, y: 0, w: 1, color: "red" },
    ]);
  });
});
