import { describe, expect, it } from "vitest";
import { buildReplay, frameAt, lineChange, type RawEvent } from "./replay";

const ev = (
  id: number,
  offsetMs: number,
  kind: string,
  payload: Record<string, unknown>,
): RawEvent => ({
  id,
  offsetMs,
  kind,
  payload,
});

describe("replay", () => {
  const events = [
    ev(3, 30_000, "run", { code: "v2", language: "python", verdict: "WA", passed: 1, total: 3 }),
    ev(1, 5_000, "code_snapshot", { code: "v1", language: "python" }),
    ev(4, 31_000, "paste", { chars: 120 }),
    ev(2, 20_000, "focus_lost", {}),
    ev(5, 60_000, "submit", { code: "v3", language: "python", verdict: "AC", passed: 3, total: 3 }),
  ];

  it("orders events and carries the code forward through markers", () => {
    const frames = buildReplay(events);
    expect(frames.map((f) => f.offsetMs)).toEqual([5000, 20000, 30000, 31000, 60000]);
    expect(frames.map((f) => f.code)).toEqual(["v1", "v1", "v2", "v2", "v3"]);
    expect(frames[1]?.marker).toMatchObject({ kind: "focus_lost", label: "Left the tab" });
    expect(frames[2]?.marker).toMatchObject({ kind: "run", label: "Run: WA 1/3", verdict: "WA" });
    expect(frames[3]?.marker?.label).toBe("Pasted 120 characters");
    expect(frames[4]?.marker?.label).toBe("Submit: AC 3/3");
  });

  it("finds the frame for a moment on the timeline", () => {
    const frames = buildReplay(events);
    expect(frameAt(frames, 0)).toBe(-1);
    expect(frameAt(frames, 5000)).toBe(0);
    expect(frameAt(frames, 29_999)).toBe(1);
    expect(frameAt(frames, 999_999)).toBe(4);
    expect(frameAt([], 10)).toBe(-1);
  });

  it("counts changed lines", () => {
    expect(lineChange("a\nb\nc", "a\nb\nd\ne")).toEqual({ added: 2, removed: 1 });
    expect(lineChange("", "")).toEqual({ added: 0, removed: 0 });
  });

  it("ignores events it does not know", () => {
    expect(buildReplay([ev(1, 0, "pause", {})])).toEqual([]);
  });
});
