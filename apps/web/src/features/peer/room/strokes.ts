// The shared whiteboard's model. A stroke is a list of points in a fixed logical space, so both people see
// the same drawing at any screen size. Pure: the canvas only renders what these functions return.

export const BOARD_W = 1000;
export const BOARD_H = 600;
export const MAX_STROKES = 600;
export const MAX_POINTS = 1200;

export const STROKE_COLORS = ["ink", "sky", "leaf", "blossom", "coin"] as const;
export type StrokeColor = (typeof STROKE_COLORS)[number];
export const STROKE_WIDTHS = [2, 4, 8] as const;

export interface Stroke {
  id: string;
  color: StrokeColor;
  width: number;
  /** x0, y0, x1, y1, ... in board units, rounded to whole numbers. */
  points: number[];
  /** The user who drew it, so "undo" takes back your own last stroke only. */
  by: string;
}

export interface Pt {
  x: number;
  y: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Maps a pointer position inside a box of `w` by `h` pixels into board units. */
export function toBoard(px: number, py: number, w: number, h: number): Pt {
  return {
    x: Math.round(clamp(px / Math.max(1, w), 0, 1) * BOARD_W),
    y: Math.round(clamp(py / Math.max(1, h), 0, 1) * BOARD_H),
  };
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const pairs = (flat: readonly number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i]!, y: flat[i + 1]! });
  return out;
};
const flatten = (pts: readonly Pt[]): number[] => pts.flatMap((p) => [p.x, p.y]);

/** Ramer-Douglas-Peucker: drops points that lie within `tolerance` of the line between their neighbours. */
export function simplify(flat: readonly number[], tolerance = 1.5): number[] {
  const pts = pairs(flat);
  if (pts.length <= 2) return [...flat];
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(pts[i]!, pts[lo]!, pts[hi]!);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = true;
      stack.push([lo, at], [at, hi]);
    }
  }
  return flatten(pts.filter((_, i) => keep[i]));
}

/** Adds a point to a stroke being drawn; points closer than 2 units to the last are skipped. */
export function extend(points: readonly number[], p: Pt): number[] {
  const n = points.length;
  if (n >= MAX_POINTS * 2) return [...points];
  if (n >= 2 && Math.hypot(p.x - points[n - 2]!, p.y - points[n - 1]!) < 2) return [...points];
  return [...points, p.x, p.y];
}

/** A finished stroke ready to share: simplified, and a single tap becomes a dot. */
export function finishStroke(s: Stroke): Stroke {
  const pts = s.points.length === 2 ? [...s.points, s.points[0]! + 1, s.points[1]!] : s.points;
  return { ...s, points: simplify(pts) };
}

/** Whether a stroke passes within `radius` of the point. */
export function hits(s: Stroke, p: Pt, radius: number): boolean {
  const pts = pairs(s.points);
  const r = radius + s.width / 2;
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y) <= r;
  for (let i = 0; i + 1 < pts.length; i++)
    if (distToSegment(p, pts[i]!, pts[i + 1]!) <= r) return true;
  return false;
}

/** The newest stroke under the point, if any: the eraser removes one stroke at a time. */
export function strokeAt(strokes: readonly Stroke[], p: Pt, radius = 8): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--)
    if (hits(strokes[i]!, p, radius)) return strokes[i]!;
  return null;
}

/** The last stroke the user drew, for undo. */
export function lastOf(strokes: readonly Stroke[], userId: string): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) if (strokes[i]!.by === userId) return strokes[i]!;
  return null;
}

/** A stroke from the network is only drawn when it is well formed and inside the board. */
export function validStroke(s: unknown): s is Stroke {
  if (!s || typeof s !== "object") return false;
  const v = s as Partial<Stroke>;
  return (
    typeof v.id === "string" &&
    typeof v.by === "string" &&
    typeof v.width === "number" &&
    v.width >= 1 &&
    v.width <= 16 &&
    (STROKE_COLORS as readonly unknown[]).includes(v.color) &&
    Array.isArray(v.points) &&
    v.points.length >= 2 &&
    v.points.length <= MAX_POINTS * 2 &&
    v.points.length % 2 === 0 &&
    v.points.every(
      (n, i) => typeof n === "number" && n >= 0 && n <= (i % 2 === 0 ? BOARD_W : BOARD_H),
    )
  );
}
