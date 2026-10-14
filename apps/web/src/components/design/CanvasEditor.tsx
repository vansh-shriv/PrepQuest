"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@prepquest/ui";
import {
  GRID,
  NODE_LABEL,
  addNode,
  connect,
  moveNode,
  relabelEdge,
  relabelNode,
  removeEdge,
  removeNode,
  reverseEdge,
  type DesignCanvas,
  type DesignNode,
  type NodeType,
} from "@prepquest/analytics-core";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  NODE_GLYPH,
  NODE_TOKEN,
  TOOLBAR,
  describeEdge,
  edgeGeometry,
  fit,
  nextSpot,
  nodeBox,
  nodeLabel,
} from "@/features/design/design-view";

type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

/**
 * The design whiteboard: pixel-styled components on a grid, arrows with labels, drag to move, keyboard
 * editing and an outline underneath for screen readers. Every edit goes out through `onChange` (one undo step
 * per edit); the parent owns the history and the saving.
 */
export function CanvasEditor({
  canvas,
  onChange,
  readOnly = false,
  highlight = [],
  label = "Design canvas",
}: {
  canvas: DesignCanvas;
  onChange?: (next: DesignCanvas) => void;
  readOnly?: boolean;
  /** Component ids to draw attention to (a review finding points at them). */
  highlight?: readonly string[];
  label?: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);

  const edit = (next: DesignCanvas) => onChange?.(next);
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  const shown = (n: DesignNode) => (drag && drag.id === n.id ? { ...n, x: drag.x, y: drag.y } : n);

  const add = (type: NodeType) => {
    const { canvas: next, id } = addNode(canvas, type, nextSpot(canvas, type));
    edit(next);
    if (id) setSelected({ kind: "node", id });
  };

  /** The pointer position in canvas units. */
  const toCanvas = (e: PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  };

  const pickNode = (id: string) => {
    if (connectFrom && connectFrom !== id && !readOnly) {
      edit(connect(canvas, connectFrom, id).canvas);
      setConnectFrom(null);
      return;
    }
    setSelected({ kind: "node", id });
  };

  const onNodeDown = (e: PointerEvent, n: DesignNode) => {
    pickNode(n.id);
    if (readOnly || connectFrom) return;
    const p = toCanvas(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id: n.id, x: n.x, y: n.y, dx: p.x - n.x, dy: p.y - n.y });
  };
  const onNodeMove = (e: PointerEvent) => {
    if (!drag) return;
    const p = toCanvas(e);
    setDrag({ ...drag, x: p.x - drag.dx, y: p.y - drag.dy });
  };
  const onNodeUp = () => {
    if (!drag) return;
    const original = byId.get(drag.id);
    const moved = moveNode(canvas, drag.id, { x: drag.x, y: drag.y });
    const after = moved.nodes.find((n) => n.id === drag.id);
    if (original && after && (after.x !== original.x || after.y !== original.y)) edit(moved);
    setDrag(null);
  };

  const onNodeKey = (e: KeyboardEvent, n: DesignNode) => {
    if (readOnly) return;
    const step = e.shiftKey ? GRID * 5 : GRID;
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      edit(moveNode(canvas, n.id, { x: n.x + dx, y: n.y + dy }));
    };
    if (e.key === "ArrowLeft") move(-step, 0);
    else if (e.key === "ArrowRight") move(step, 0);
    else if (e.key === "ArrowUp") move(0, -step);
    else if (e.key === "ArrowDown") move(0, step);
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      edit(removeNode(canvas, n.id));
      setSelected(null);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pickNode(n.id);
    } else if (e.key === "c" && n.type !== "note") {
      e.preventDefault();
      setConnectFrom(n.id);
    } else if (e.key === "Escape") setConnectFrom(null);
  };

  const node = selected?.kind === "node" ? byId.get(selected.id) : undefined;
  const edge =
    selected?.kind === "edge" ? canvas.edges.find((e) => e.id === selected.id) : undefined;
  const marked = new Set(highlight);

  return (
    <div className="grid gap-2">
      {!readOnly && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="toolbar"
          aria-label="Add a component"
        >
          {TOOLBAR.map((t) => (
            <Button key={t} size="sm" variant="ghost" onClick={() => add(t)}>
              + {NODE_LABEL[t]}
            </Button>
          ))}
        </div>
      )}
      {connectFrom && (
        <p className="m-0 text-sm" role="status" data-testid="connect-hint">
          Click the component that {byId.get(connectFrom)?.label ?? "it"} sends to. Escape cancels.
        </p>
      )}

      <div className="overflow-auto bg-surface-alt" style={{ maxHeight: 560 }}>
        <svg
          ref={svg}
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          role="group"
          aria-label={label}
          data-testid="design-canvas"
          style={{ touchAction: "none", display: "block", maxWidth: "none" }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelected(null);
              setConnectFrom(null);
            }
          }}
        >
          <defs>
            <pattern id="grid" width={GRID * 2} height={GRID * 2} patternUnits="userSpaceOnUse">
              <rect width="2" height="2" fill="var(--shadow)" />
            </pattern>
          </defs>
          <rect
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            fill="url(#grid)"
            pointerEvents="none"
          />

          {canvas.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const g = edgeGeometry(shown(a), shown(b));
            const on = selected?.kind === "edge" && selected.id === e.id;
            return (
              <g key={e.id} data-testid="design-edge">
                <line
                  x1={g.x1}
                  y1={g.y1}
                  x2={g.x2}
                  y2={g.y2}
                  stroke="var(--ink)"
                  strokeWidth={on ? 5 : 3}
                />
                <polygon points={g.head.map((p) => `${p.x},${p.y}`).join(" ")} fill="var(--ink)" />
                {e.label && (
                  <text
                    x={g.label.x}
                    y={g.label.y - 6}
                    textAnchor="middle"
                    fontSize="13"
                    fill="var(--ink)"
                    stroke="var(--bg)"
                    strokeWidth="4"
                    paintOrder="stroke"
                  >
                    {fit(e.label, 28)}
                  </text>
                )}
                {/* a wide invisible stroke so a thin line is easy to pick */}
                <line
                  x1={g.x1}
                  y1={g.y1}
                  x2={g.x2}
                  y2={g.y2}
                  stroke="transparent"
                  strokeWidth="16"
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    setSelected({ kind: "edge", id: e.id });
                  }}
                />
              </g>
            );
          })}

          {canvas.nodes.map((n0) => {
            const n = shown(n0);
            const b = nodeBox(n);
            const on = selected?.kind === "node" && selected.id === n.id;
            const hot = marked.has(n.id);
            return (
              <g
                key={n.id}
                role="button"
                tabIndex={0}
                aria-label={nodeLabel(canvas, n0)}
                aria-pressed={on}
                data-testid="design-node"
                data-type={n.type}
                onPointerDown={(e) => onNodeDown(e, n0)}
                onPointerMove={onNodeMove}
                onPointerUp={onNodeUp}
                onKeyDown={(e) => onNodeKey(e, n0)}
                style={{ cursor: readOnly ? "default" : "grab", outline: "none" }}
              >
                <rect x={b.x + 4} y={b.y + 4} width={b.w} height={b.h} fill="var(--shadow)" />
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  fill={`var(${NODE_TOKEN[n.type]})`}
                  stroke="var(--ink)"
                  strokeWidth={on || hot ? 6 : 3}
                  strokeDasharray={hot && !on ? "8 4" : undefined}
                />
                <text x={b.x + 8} y={b.y + 16} fontSize="10" fill="var(--on-coin)">
                  {NODE_GLYPH[n.type]}
                </text>
                <text x={b.x + 8} y={b.y + 38} fontSize="14" fill="var(--on-coin)">
                  {fit(n.label, n.type === "note" ? 24 : 16)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {!readOnly && (node || edge) && (
        <div className="pq-box grid gap-2 bg-surface p-3" data-testid="design-inspector">
          {node && (
            <>
              <label className="pq-label grid gap-1">
                {node.type === "note" ? "Note" : `${NODE_LABEL[node.type]} name`}
                <input
                  className="pq-input"
                  value={node.label}
                  maxLength={node.type === "note" ? 200 : 40}
                  onChange={(e) => edit(relabelNode(canvas, node.id, e.target.value))}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {node.type !== "note" && (
                  <Button size="sm" onClick={() => setConnectFrom(node.id)}>
                    Connect to…
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    edit(removeNode(canvas, node.id));
                    setSelected(null);
                  }}
                >
                  Delete
                </Button>
              </div>
              <p className="m-0 text-xs text-ink-soft">
                Arrow keys move it (hold Shift for bigger steps), C starts a connection, Delete
                removes it.
              </p>
            </>
          )}
          {edge && (
            <>
              <p className="m-0 text-sm">{describeEdge(canvas, edge.id)}</p>
              <label className="pq-label grid gap-1">
                What flows over it
                <input
                  className="pq-input"
                  value={edge.label}
                  maxLength={40}
                  placeholder="HTTPS, SQL, event…"
                  onChange={(e) => edit(relabelEdge(canvas, edge.id, e.target.value))}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => edit(reverseEdge(canvas, edge.id))}
                >
                  Reverse direction
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    edit(removeEdge(canvas, edge.id));
                    setSelected(null);
                  }}
                >
                  Delete connection
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer underline">Outline of the design (text)</summary>
        <div className="mt-2 grid gap-2">
          <ul className="m-0 list-none p-0" aria-label="Components" data-testid="design-outline">
            {canvas.nodes.length === 0 && <li>Nothing drawn yet.</li>}
            {canvas.nodes.map((n) => (
              <li key={n.id}>
                {NODE_LABEL[n.type]}: {n.label}
              </li>
            ))}
          </ul>
          <ul className="m-0 list-none p-0" aria-label="Connections">
            {canvas.edges.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="underline"
                  disabled={readOnly}
                  onClick={() => setSelected({ kind: "edge", id: e.id })}
                >
                  {describeEdge(canvas, e.id)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
