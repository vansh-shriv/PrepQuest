"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { readLocal, writeLocal } from "@/lib/local-store";

const MIN = 0.25;
const MAX = 0.75;
const STEP = 0.02;

export interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  /** Remembers the divider position per user/browser. */
  storageKey: string;
  /** Below the `md` breakpoint only one pane is shown at a time. */
  mobileView: "left" | "right";
  /** Focus mode: show only the right pane at every width. */
  hideLeft?: boolean;
}

/** Two resizable panes. The divider is a keyboard-operable separator (arrow keys, Home/End). */
export function SplitPane({ left, right, storageKey, mobileView, hideLeft }: SplitPaneProps) {
  const [ratio, setRatio] = useState(0.45);
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = readLocal<number>(storageKey);
    if (typeof saved === "number" && saved >= MIN && saved <= MAX) setRatio(saved);
  }, [storageKey]);

  const commit = useCallback(
    (next: number) => {
      const clamped = Math.min(MAX, Math.max(MIN, next));
      setRatio(clamped);
      writeLocal(storageKey, clamped);
    },
    [storageKey],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !container.current) return;
    const box = container.current.getBoundingClientRect();
    commit((e.clientX - box.left) / box.width);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") commit(ratio - STEP);
    else if (e.key === "ArrowRight") commit(ratio + STEP);
    else if (e.key === "Home") commit(MIN);
    else if (e.key === "End") commit(MAX);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={container}
      className="flex min-h-0 flex-1 flex-col md:flex-row"
      style={{ ["--split" as string]: `${ratio * 100}%` }}
    >
      <section
        aria-label="Problem"
        className={`min-h-0 min-w-0 overflow-auto md:block md:w-[var(--split)] md:flex-none ${hideLeft ? "md:hidden" : ""} ${
          mobileView === "left" ? "flex-1" : "hidden"
        }`}
      >
        {left}
      </section>
      {!hideLeft && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          aria-valuemin={Math.round(MIN * 100)}
          aria-valuemax={Math.round(MAX * 100)}
          aria-valuenow={Math.round(ratio * 100)}
          tabIndex={0}
          data-dragging={dragging}
          className="pq-divider hidden md:block"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onKeyDown={onKeyDown}
        />
      )}
      <section
        aria-label="Code"
        className={`min-h-0 min-w-0 md:flex md:flex-1 md:flex-col ${mobileView === "right" ? "flex flex-1 flex-col" : "hidden"}`}
      >
        {right}
      </section>
    </div>
  );
}
