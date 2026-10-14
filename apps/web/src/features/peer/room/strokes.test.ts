import { describe, expect, it } from "vitest";
import {
  BOARD_H,
  BOARD_W,
  MAX_POINTS,
  extend,
  finishStroke,
  hits,
  lastOf,
  simplify,
  strokeAt,
  toBoard,
  validStroke,
  type Stroke,
} from "./strokes";

const stroke = (id: string, points: number[], by = "ada", width = 4): Stroke => ({
  id,
  color: "ink",
  width,
  points,
  by,
});

describe("toBoard", () => {
  it("maps pixels to board units and keeps the pointer inside", () => {
    expect(toBoard(200, 100, 400, 200)).toEqual({ x: BOARD_W / 2, y: BOARD_H / 2 });
    expect(toBoard(-20, 900, 400, 200)).toEqual({ x: 0, y: BOARD_H });
  });
});

describe("simplify", () => {
  it("drops points on a straight line and keeps corners", () => {
    expect(simplify([0, 0, 10, 0, 20, 0, 30, 0])).toEqual([0, 0, 30, 0]);
    expect(simplify([0, 0, 50, 0, 50, 50])).toEqual([0, 0, 50, 0, 50, 50]);
    expect(simplify([1, 1])).toEqual([1, 1]);
  });
});

describe("extend and finishStroke", () => {
  it("skips points that barely moved and stops at the limit", () => {
    expect(extend([10, 10], { x: 11, y: 10 })).toEqual([10, 10]);
    expect(extend([10, 10], { x: 20, y: 10 })).toEqual([10, 10, 20, 10]);
    const full = new Array(MAX_POINTS * 2).fill(0);
    expect(extend(full, { x: 500, y: 500 })).toHaveLength(MAX_POINTS * 2);
  });
  it("turns a tap into a dot", () => {
    const dot = finishStroke(stroke("a", [40, 40]));
    expect(dot.points).toEqual([40, 40, 41, 40]);
    expect(validStroke(dot)).toBe(true);
  });
});

describe("erasing and undo", () => {
  const a = stroke("a", [0, 100, 200, 100]);
  const b = stroke("b", [100, 0, 100, 200], "bob");
  it("finds the newest stroke under the pointer", () => {
    expect(strokeAt([a, b], { x: 100, y: 100 })?.id).toBe("b"); // they cross: newest wins
    expect(strokeAt([a, b], { x: 150, y: 104 })?.id).toBe("a");
    expect(strokeAt([a, b], { x: 150, y: 150 })).toBeNull();
  });
  it("counts the stroke's width as part of the target", () => {
    const fat = stroke("f", [0, 0, 100, 0], "ada", 16);
    expect(hits(fat, { x: 50, y: 9 }, 2)).toBe(true);
    expect(hits(fat, { x: 50, y: 30 }, 2)).toBe(false);
  });
  it("undo takes your own last stroke, not your partner's", () => {
    expect(lastOf([a, b], "ada")?.id).toBe("a");
    expect(lastOf([a, b], "bob")?.id).toBe("b");
    expect(lastOf([a, b], "cyd")).toBeNull();
  });
});

describe("validStroke", () => {
  const ok = stroke("a", [0, 0, 10, 10]);
  it("accepts a good stroke and refuses malformed ones from the network", () => {
    expect(validStroke(ok)).toBe(true);
    for (const bad of [
      null,
      "x",
      { ...ok, color: "hotpink" },
      { ...ok, width: 99 },
      { ...ok, points: [1] },
      { ...ok, points: [1, 2, 3] },
      { ...ok, points: [BOARD_W + 1, 0] },
      { ...ok, points: [0, BOARD_H + 1] },
      { ...ok, points: ["a", "b"] },
      { ...ok, points: new Array(MAX_POINTS * 2 + 2).fill(1) },
      { ...ok, id: 5 },
    ])
      expect(validStroke(bad)).toBe(false);
  });
});
