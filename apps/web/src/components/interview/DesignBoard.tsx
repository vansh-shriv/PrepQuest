"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, LoadingBar } from "@prepquest/ui";
import {
  record,
  redo as redoHistory,
  startHistory,
  undo as undoHistory,
  type DesignCanvas,
  type History,
} from "@prepquest/analytics-core";
import { api } from "@/lib/api";
import { CanvasEditor } from "../design/CanvasEditor";

const SEND_EVERY_MS = 2500;

export interface DesignBoardProps {
  sessionId: string;
  /** Posts an event to the interview (the drawing goes out as `{ kind: "canvas", canvas }`). */
  sendEvent: (body: Record<string, unknown>) => Promise<unknown>;
  disabled: boolean;
}

/**
 * The drawing board of a design interview. The drawing lives in this tab; the interviewer sees it every
 * few seconds, but only when it changed. A reload brings back the last drawing the server saw.
 */
export function DesignBoard({ sessionId, sendEvent, disabled }: DesignBoardProps) {
  const [history, setHistory] = useState<History<DesignCanvas> | null>(null);
  const latest = useRef<DesignCanvas | null>(null);
  const sent = useRef<string>("");
  const sendRef = useRef(sendEvent);
  sendRef.current = sendEvent;

  useEffect(() => {
    let alive = true;
    api<{ canvas: DesignCanvas }>(`/interviews/${sessionId}/design`)
      .then((d) => {
        if (!alive) return;
        latest.current = d.canvas;
        sent.current = JSON.stringify(d.canvas);
        setHistory(startHistory(d.canvas));
      })
      .catch(() => {
        if (!alive) return;
        latest.current = { nodes: [], edges: [] };
        sent.current = JSON.stringify(latest.current);
        setHistory(startHistory(latest.current));
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (disabled || !history) return;
    const flush = () => {
      const now = latest.current;
      if (!now) return;
      const text = JSON.stringify(now);
      if (text === sent.current) return;
      sent.current = text;
      void sendRef.current({ kind: "canvas", canvas: now });
    };
    const timer = setInterval(flush, SEND_EVERY_MS);
    // leaving the tab: let the interviewer have what is on the board
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [disabled, history]);

  const set = (h: History<DesignCanvas>) => {
    latest.current = h.present;
    setHistory(h);
  };

  if (!history) {
    return (
      <div className="p-6">
        <LoadingBar label="Loading the drawing board" />
      </div>
    );
  }

  const onKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const tag = (e.target as HTMLElement).tagName;
    if (!mod || tag === "INPUT" || tag === "TEXTAREA" || disabled) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      set(undoHistory(history));
    } else if (k === "y" || (k === "z" && e.shiftKey)) {
      e.preventDefault();
      set(redoHistory(history));
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto"
      data-testid="interview-board"
      onKeyDown={onKey}
    >
      <div className="flex flex-wrap items-center gap-2 border-b-[3px] border-ink bg-surface-alt px-3 py-2">
        <strong className="pq-font-ui text-sm uppercase">Drawing board</strong>
        <span className="text-sm text-ink-soft">The interviewer can see what you draw.</span>
        <span className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || history.past.length === 0}
            onClick={() => set(undoHistory(history))}
          >
            Undo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || history.future.length === 0}
            onClick={() => set(redoHistory(history))}
          >
            Redo
          </Button>
        </span>
      </div>
      <div className="p-3">
        <CanvasEditor
          canvas={history.present}
          readOnly={disabled}
          onChange={(next) => set(record(history, next))}
          label="Drawing board"
        />
      </div>
    </div>
  );
}
