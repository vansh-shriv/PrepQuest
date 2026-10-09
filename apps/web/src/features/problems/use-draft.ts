"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft, DraftHistoryItem, LanguageValue } from "@prepquest/shared";
import { API_URL, api, ApiError, getAccessToken } from "@/lib/api";
import { readLocal, removeLocal, writeLocal } from "@/lib/local-store";

export type DraftStatus = "loading" | "saved" | "dirty" | "saving" | "conflict" | "offline";

interface LocalDraft {
  code: string;
  baseVersion: number;
  cursor: Cursor | null;
}
type Cursor = { line: number; column: number };

const AUTOSAVE_MS = 2000;
const RETRY_MS = 5000;

/**
 * Autosaving editor state for one problem + language (D2).
 *  - Edits are written to localStorage immediately (survives a crash or closed tab) and sent to the
 *    server 2 s after typing stops, with the draft version for optimistic concurrency.
 *  - If another tab or device saved in the meantime the server answers 409; the hook exposes the newer
 *    draft so the UI can offer "load it" or "keep mine".
 *  - Unsent work is flushed when the tab is hidden or closed and when the language changes.
 */
export function useDraft(slug: string, language: LanguageValue, starter: string) {
  const [code, setCode] = useState(starter);
  const [status, setStatus] = useState<DraftStatus>("loading");
  const [conflict, setConflict] = useState<Draft | null>(null);
  const [initialCursor, setInitialCursor] = useState<Cursor | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped whenever the code is replaced from outside typing (load, reset, restore, take newer). */
  const [revision, setRevision] = useState(0);

  const codeRef = useRef(starter);
  const cursorRef = useRef<Cursor | null>(null);
  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const storageKey = `pq:draft:${slug}:${language}`;
  const path = `/problems/${slug}/draft?language=${language}`;

  const persistLocal = useCallback(() => {
    writeLocal(storageKey, {
      code: codeRef.current,
      baseVersion: versionRef.current,
      cursor: cursorRef.current,
    } satisfies LocalDraft);
  }, [storageKey]);

  const save = useCallback(async (): Promise<void> => {
    if (!dirtyRef.current || inFlight.current) return;
    inFlight.current = true;
    if (alive.current) setStatus("saving");
    const sent = codeRef.current;
    try {
      const res = await api<{ draft: Draft }>(path, {
        method: "PUT",
        json: {
          code: sent,
          baseVersion: versionRef.current,
          ...(cursorRef.current ? { cursor: cursorRef.current } : {}),
        },
      });
      versionRef.current = res.draft.version;
      if (codeRef.current === sent) {
        dirtyRef.current = false;
        removeLocal(storageKey);
        if (alive.current) setStatus("saved");
      } else {
        persistLocal(); // typed more while saving: send again
        timer.current = setTimeout(() => void save(), 0);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const current = (err.details as { current?: Draft | null } | undefined)?.current ?? null;
        if (alive.current) {
          setConflict(
            current ?? { code: "", cursor: null, version: 0, updatedAt: new Date().toISOString() },
          );
          setStatus("conflict");
        }
      } else {
        if (alive.current) setStatus("offline");
        timer.current = setTimeout(() => void save(), RETRY_MS); // keep trying; the local copy is safe
      }
    } finally {
      inFlight.current = false;
    }
  }, [path, persistLocal, storageKey]);

  // load the draft when the problem or language changes; flush the previous one first
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setStatus("loading");
    setConflict(null);
    setNotice(null);
    dirtyRef.current = false;
    versionRef.current = 0;

    void (async () => {
      let server: Draft | null = null;
      let offline = false;
      try {
        server = (await api<{ draft: Draft | null }>(path)).draft;
      } catch {
        offline = true;
      }
      if (cancelled) return;

      const local = readLocal<LocalDraft>(storageKey);
      let next = server?.code ?? starter;
      let cursor = server?.cursor ?? null;
      versionRef.current = server?.version ?? 0;

      if (local && local.code !== (server?.code ?? starter)) {
        if (offline || local.baseVersion === versionRef.current) {
          // unsent work from a previous session: restore it and sync it
          next = local.code;
          cursor = local.cursor;
          versionRef.current = offline ? local.baseVersion : versionRef.current;
          dirtyRef.current = true;
        } else {
          setNotice(
            "A newer draft saved elsewhere was loaded instead of the unsent changes on this device.",
          );
          removeLocal(storageKey);
        }
      }
      codeRef.current = next;
      cursorRef.current = cursor;
      setCode(next);
      setRevision((r) => r + 1);
      setInitialCursor(cursor);
      setStatus(offline ? "offline" : dirtyRef.current ? "dirty" : "saved");
      if (dirtyRef.current) timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer.current);
      if (dirtyRef.current) void save(); // flush unsent edits for the old problem/language
    };
  }, [slug, language, path, storageKey, starter, save]);

  // flush when the tab is hidden or closed; keepalive lets the request outlive the page
  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current || inFlight.current) return;
      persistLocal();
      const token = getAccessToken();
      if (!token) return;
      void fetch(`${API_URL}/v1${path}`, {
        method: "PUT",
        keepalive: true,
        credentials: "include",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: codeRef.current,
          baseVersion: versionRef.current,
          ...(cursorRef.current ? { cursor: cursorRef.current } : {}),
        }),
      }).catch(() => undefined);
    };
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [path, persistLocal]);

  const edit = useCallback(
    (next: string) => {
      codeRef.current = next;
      dirtyRef.current = true;
      setCode(next);
      setStatus((s) => (s === "conflict" ? s : "dirty"));
      persistLocal();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    },
    [persistLocal, save],
  );

  const setCursor = useCallback((cursor: Cursor) => {
    cursorRef.current = cursor;
  }, []);

  /** Conflict: take the newer draft from the server. */
  const acceptServer = useCallback(() => {
    if (!conflict) return;
    codeRef.current = conflict.code || starter;
    versionRef.current = conflict.version;
    dirtyRef.current = false;
    removeLocal(storageKey);
    setCode(codeRef.current);
    setRevision((r) => r + 1);
    setConflict(null);
    setStatus("saved");
  }, [conflict, starter, storageKey]);

  /** Conflict: keep this device's code and overwrite the other save. */
  const keepMine = useCallback(() => {
    versionRef.current = conflict?.version ?? 0;
    setConflict(null);
    dirtyRef.current = true;
    void save();
  }, [conflict, save]);

  /** Replaces the code from outside the editor (reset, restore from history) and saves it. */
  const replace = useCallback(
    (next: string) => {
      edit(next);
      setRevision((r) => r + 1);
    },
    [edit],
  );

  const reset = useCallback(() => replace(starter), [replace, starter]);

  const loadHistory = useCallback(async (): Promise<DraftHistoryItem[]> => {
    const res = await api<{ items: DraftHistoryItem[] }>(
      `/problems/${slug}/draft-history?language=${language}`,
    );
    return res.items;
  }, [slug, language]);

  return {
    code,
    revision,
    status,
    conflict,
    notice,
    initialCursor,
    edit,
    replace,
    setCursor,
    acceptServer,
    keepMine,
    reset,
    loadHistory,
    saveNow: save,
  };
}
