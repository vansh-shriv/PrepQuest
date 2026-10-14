"use client";

import { useEffect, useState } from "react";
import { Chip, LoadingBar } from "@prepquest/ui";
import type { DesignCanvas } from "@prepquest/analytics-core";
import { api } from "@/lib/api";
import { CanvasEditor } from "../design/CanvasEditor";

interface Drawing {
  canvas: DesignCanvas;
  offsetMs: number | null;
  findings: {
    code: string;
    severity: "important" | "suggestion";
    message: string;
    nodeIds: string[];
  }[];
}

/** The last drawing of a design interview with the automatic checks on it (the review's "Your drawing" tab). */
export function DrawingReview({ sessionId }: { sessionId: string }) {
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [marked, setMarked] = useState<string[]>([]);

  useEffect(() => {
    api<Drawing>(`/interviews/${sessionId}/design`)
      .then(setDrawing)
      .catch(() => setDrawing({ canvas: { nodes: [], edges: [] }, offsetMs: null, findings: [] }));
  }, [sessionId]);

  if (!drawing) return <LoadingBar label="Loading the drawing" />;
  if (drawing.canvas.nodes.length === 0)
    return <p className="m-0">Nothing was drawn in this interview.</p>;

  return (
    <div className="grid gap-4" data-testid="drawing-review">
      <CanvasEditor canvas={drawing.canvas} readOnly highlight={marked} label="Your drawing" />
      {drawing.findings.length > 0 && (
        <section aria-labelledby="drawing-checks" className="grid gap-2">
          <h3 id="drawing-checks" className="pq-font-ui m-0 text-sm uppercase">
            Checks on the final drawing
          </h3>
          <ul className="m-0 grid list-none gap-2 p-0">
            {drawing.findings.map((f) => (
              <li
                key={f.code}
                className="pq-box flex flex-wrap items-center gap-2 bg-surface p-2"
                data-testid="drawing-finding"
              >
                <Chip tone={f.severity === "important" ? "hard" : "info"}>
                  {f.severity === "important" ? "Important" : "Suggestion"}
                </Chip>
                <span>{f.message}</span>
                {f.nodeIds.length > 0 && (
                  <button
                    type="button"
                    className="ml-auto border-0 bg-transparent p-0 underline"
                    onClick={() => setMarked(f.nodeIds)}
                  >
                    Show on the drawing
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
