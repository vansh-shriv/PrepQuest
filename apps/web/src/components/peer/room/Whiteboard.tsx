"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { Button } from "@prepquest/ui";
import {
  BOARD_H,
  BOARD_W,
  MAX_STROKES,
  STROKE_COLORS,
  STROKE_WIDTHS,
  extend,
  finishStroke,
  lastOf,
  strokeAt,
  toBoard,
  validStroke,
  type Stroke,
  type StrokeColor,
} from "@/features/peer/room/strokes";

const TOKEN: Record<StrokeColor, string> = {
  ink: "--ink",
  sky: "--sky",
  leaf: "--leaf",
  blossom: "--blossom",
  coin: "--coin",
};
const COLOR_LABEL: Record<StrokeColor, string> = {
  ink: "Ink",
  sky: "Sky",
  leaf: "Leaf",
  blossom: "Blossom",
  coin: "Coin",
};

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * The shared whiteboard. Strokes are kept in the shared document (`strokes`), so both people draw on the
 * same board and a reconnecting browser gets it back. The canvas is only a view of that list.
 */
export function Whiteboard({ doc, userId }: { doc: Y.Doc; userId: string }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef<Stroke | null>(null);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState<StrokeColor>("ink");
  const [width, setWidth] = useState<number>(4);
  const [count, setCount] = useState(0);
  const strokes = doc.getArray<Stroke>("strokes");

  const paint = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const scale = el.width / BOARD_W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = token("--surface");
    ctx.fillRect(0, 0, el.width, el.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const all = [
      ...strokes.toArray().filter(validStroke),
      ...(drawing.current ? [drawing.current] : []),
    ];
    for (const s of all) {
      ctx.strokeStyle = token(TOKEN[s.color]);
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(s.points[0]!, s.points[1]!);
      for (let i = 2; i < s.points.length; i += 2) ctx.lineTo(s.points[i]!, s.points[i + 1]!);
      if (s.points.length === 2) ctx.lineTo(s.points[0]! + 0.1, s.points[1]!);
      ctx.stroke();
    }
  }, [strokes]);

  // size the bitmap to the box, and redraw whenever the shared list changes
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const w = Math.max(1, Math.round(el.clientWidth * (window.devicePixelRatio || 1)));
      el.width = w;
      el.height = Math.round((w * BOARD_H) / BOARD_W);
      paint();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const onChange = () => {
      setCount(strokes.length);
      paint();
    };
    onChange();
    strokes.observe(onChange);
    return () => {
      ro.disconnect();
      strokes.unobserve(onChange);
    };
  }, [paint, strokes]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return toBoard(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  };
  const erase = (p: { x: number; y: number }) => {
    const hit = strokeAt(strokes.toArray(), p);
    if (!hit) return;
    const i = strokes.toArray().findIndex((s) => s.id === hit.id);
    if (i >= 0) strokes.delete(i, 1);
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    if (tool === "eraser") return erase(p);
    if (strokes.length >= MAX_STROKES) return;
    drawing.current = { id: crypto.randomUUID(), color, width, points: [p.x, p.y], by: userId };
    paint();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons === 0) return;
    const p = point(e);
    if (tool === "eraser") return erase(p);
    const d = drawing.current;
    if (!d) return;
    drawing.current = { ...d, points: extend(d.points, p) };
    paint();
  };
  const up = () => {
    const d = drawing.current;
    drawing.current = null;
    if (d) strokes.push([finishStroke(d)]);
    else paint();
  };

  const undo = () => {
    const mine = lastOf(strokes.toArray(), userId);
    if (!mine) return;
    const i = strokes.toArray().findIndex((s) => s.id === mine.id);
    if (i >= 0) strokes.delete(i, 1);
  };
  const clear = () => {
    if (strokes.length > 0) strokes.delete(0, strokes.length);
  };

  return (
    <div className="grid gap-2" data-testid="peer-whiteboard">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Drawing tools">
        <Button
          size="sm"
          variant={tool === "pen" ? "primary" : "ghost"}
          onClick={() => setTool("pen")}
          aria-pressed={tool === "pen"}
        >
          Pen
        </Button>
        <Button
          size="sm"
          variant={tool === "eraser" ? "primary" : "ghost"}
          onClick={() => setTool("eraser")}
          aria-pressed={tool === "eraser"}
        >
          Eraser
        </Button>
        {STROKE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${COLOR_LABEL[c]} colour`}
            aria-pressed={color === c && tool === "pen"}
            onClick={() => {
              setColor(c);
              setTool("pen");
            }}
            className="h-6 w-6 border-2 border-ink"
            style={{
              background: `var(${TOKEN[c]})`,
              outline: color === c && tool === "pen" ? "3px solid var(--ink)" : "none",
              outlineOffset: 1,
            }}
          />
        ))}
        {STROKE_WIDTHS.map((w) => (
          <Button
            key={w}
            size="sm"
            variant={width === w ? "primary" : "ghost"}
            onClick={() => setWidth(w)}
            aria-pressed={width === w}
          >
            {w === 2 ? "Thin" : w === 4 ? "Medium" : "Thick"}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={undo}>
          Undo mine
        </Button>
        <Button size="sm" variant="ghost" onClick={clear}>
          Clear the board
        </Button>
      </div>
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Shared whiteboard, ${count} ${count === 1 ? "stroke" : "strokes"}. Drawing needs a mouse, pen or touch.`}
        data-testid="peer-board"
        data-strokes={count}
        className="block aspect-[5/3] w-full touch-none border-2 border-ink bg-surface"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {count >= MAX_STROKES && (
        <p role="status" className="m-0 text-sm">
          The board is full. Clear it to draw more.
        </p>
      )}
    </div>
  );
}
