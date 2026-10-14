"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  record,
  redo as redoHistory,
  startHistory,
  undo as undoHistory,
  type DesignCanvas,
  type History,
} from "@prepquest/analytics-core";
import type { DesignCanvasFull, DesignPanelDto } from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";

export type SaveState = "saved" | "saving" | "dirty" | "conflict" | "error";

/** The panel as the learner types it: one text box per list, so a trailing newline is not eaten. */
export interface PanelDraft {
  functional: string;
  nonFunctional: string;
  apis: string;
  dataModel: string;
  notes: string;
  estimate: Record<string, number>;
}

export const toDraft = (p: DesignPanelDto): PanelDraft => ({
  functional: p.functional.join("\n"),
  nonFunctional: p.nonFunctional.join("\n"),
  apis: p.apis.join("\n"),
  dataModel: p.dataModel,
  notes: p.notes,
  estimate: p.estimate,
});

const lines = (t: string) =>
  t
    .split("\n")
    .map((l) => l.trim().slice(0, 200))
    .filter(Boolean);

export const fromDraft = (d: PanelDraft): DesignPanelDto => ({
  functional: lines(d.functional).slice(0, 12),
  nonFunctional: lines(d.nonFunctional).slice(0, 12),
  apis: lines(d.apis).slice(0, 15),
  dataModel: d.dataModel.slice(0, 3000),
  notes: d.notes.slice(0, 3000),
  estimate: d.estimate,
});

const SAVE_DELAY_MS = 1500;

/**
 * The open design: the canvas with 100 steps of undo, the panel, autosave with the version the edit started
 * from, and the review that arrives in the background.
 */
export function useDesign(id: string) {
  const [doc, setDoc] = useState<DesignCanvasFull | null>(null);
  const [missing, setMissing] = useState(false);
  const [history, setHistory] = useState<History<DesignCanvas> | null>(null);
  const [panel, setPanelState] = useState<PanelDraft | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const version = useRef(1);
  const dirty = useRef(false);
  const saving = useRef(false);
  const latest = useRef<{ canvas: DesignCanvas; panel: PanelDraft } | null>(null);

  const apply = useCallback((d: DesignCanvasFull) => {
    setDoc(d);
    version.current = d.version;
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<DesignCanvasFull>(`/design/canvases/${id}`);
      apply(d);
      setHistory(startHistory(d.canvas as DesignCanvas));
      setPanelState(toDraft(d.panel));
      latest.current = { canvas: d.canvas as DesignCanvas, panel: toDraft(d.panel) };
      dirty.current = false;
      setSave("saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
    }
  }, [id, apply]);
  useEffect(() => {
    void load();
  }, [load]);

  const flush = useCallback(async () => {
    if (saving.current || !dirty.current || !latest.current) return;
    saving.current = true;
    const sent = latest.current;
    dirty.current = false;
    setSave("saving");
    try {
      const d = await api<DesignCanvasFull>(`/design/canvases/${id}`, {
        method: "PUT",
        json: { canvas: sent.canvas, panel: fromDraft(sent.panel), baseVersion: version.current },
      });
      version.current = d.version;
      // keep the learner's text and drawing as they are; take the checks and the review from the server
      setDoc((cur) =>
        cur ? { ...cur, version: d.version, findings: d.findings, review: d.review } : d,
      );
      setSave(dirty.current ? "dirty" : "saved");
    } catch (err) {
      dirty.current = true;
      setSave(err instanceof ApiError && err.status === 409 ? "conflict" : "error");
    } finally {
      saving.current = false;
    }
  }, [id]);

  // a short pause after the last edit
  useEffect(() => {
    if (save !== "dirty") return;
    const timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [save, history, panel, flush]);

  const touch = (canvas: DesignCanvas, p: PanelDraft) => {
    latest.current = { canvas, panel: p };
    dirty.current = true;
    setSave((s) => (s === "conflict" ? s : "dirty"));
  };

  const edit = (next: DesignCanvas) => {
    if (!history || !panel) return;
    const h = record(history, next);
    setHistory(h);
    touch(h.present, panel);
  };
  const undo = () => {
    if (!history || !panel) return;
    const h = undoHistory(history);
    setHistory(h);
    touch(h.present, panel);
  };
  const redo = () => {
    if (!history || !panel) return;
    const h = redoHistory(history);
    setHistory(h);
    touch(h.present, panel);
  };
  const setPanel = (next: PanelDraft) => {
    if (!history) return;
    setPanelState(next);
    touch(history.present, next);
  };

  /** Save right now (before asking for a review, so the model sees what is on the screen). */
  const saveNow = async () => {
    if (dirty.current) await flush();
    return !dirty.current;
  };

  const refresh = useCallback(async () => {
    try {
      const d = await api<DesignCanvasFull>(`/design/canvases/${id}`);
      setDoc((cur) =>
        cur
          ? {
              ...cur,
              reviewStatus: d.reviewStatus,
              review: d.review,
              reviewError: d.reviewError,
              findings: dirty.current ? cur.findings : d.findings,
            }
          : d,
      );
    } catch {
      /* the next poll tries again */
    }
  }, [id]);

  return {
    doc,
    setDoc,
    missing,
    canvas: history?.present ?? null,
    panel,
    save,
    canUndo: (history?.past.length ?? 0) > 0,
    canRedo: (history?.future.length ?? 0) > 0,
    edit,
    undo,
    redo,
    setPanel,
    saveNow,
    refresh,
    reload: load,
  };
}
