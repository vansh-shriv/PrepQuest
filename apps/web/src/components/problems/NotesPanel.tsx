"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, LoadingBar, Textarea } from "@prepquest/ui";
import { MAX_NOTE_CHARS, type NoteDto } from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";
import { Markdown } from "./Markdown";

type Status = "loading" | "saved" | "dirty" | "saving" | "conflict" | "error";

const STATUS_TEXT: Record<Status, string> = {
  loading: "Loading...",
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  conflict: "Changed somewhere else",
  error: "Couldn't save. Will retry",
};
const SAVE_DELAY_MS = 800;

/** Personal Markdown note for a problem (U3). Autosaves; a stale save is never allowed to overwrite. */
export function NotesPanel({ slug }: { slug: string }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [preview, setPreview] = useState(false);
  const [theirs, setTheirs] = useState<NoteDto | null>(null);
  const version = useRef(0);
  const latest = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    api<{ note: NoteDto | null }>(`/problems/${slug}/note`)
      .then(({ note }) => {
        if (!alive) return;
        version.current = note?.version ?? 0;
        latest.current = note?.bodyMd ?? "";
        setText(latest.current);
        setStatus("saved");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [slug]);

  const save = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    const body = latest.current;
    setStatus("saving");
    try {
      const { note } = await api<{ note: NoteDto | null }>(`/problems/${slug}/note`, {
        method: "PUT",
        json: { bodyMd: body, baseVersion: version.current },
      });
      version.current = note?.version ?? 0;
      // typing continued while the request was in flight: save again
      if (latest.current !== body) {
        saving.current = false;
        await save();
        return;
      }
      setStatus("saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setTheirs((err.details as { current: NoteDto | null } | undefined)?.current ?? null);
        setStatus("conflict");
      } else {
        setStatus("error");
        timer.current = setTimeout(() => void save(), 5000);
      }
    } finally {
      saving.current = false;
    }
  }, [slug]);

  const edit = (value: string) => {
    setText(value);
    latest.current = value;
    if (status === "conflict") return; // resolve the conflict first
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  };

  const useTheirs = () => {
    version.current = theirs?.version ?? 0;
    latest.current = theirs?.bodyMd ?? "";
    setText(latest.current);
    setTheirs(null);
    setStatus("saved");
  };
  const keepMine = () => {
    version.current = theirs?.version ?? 0;
    setTheirs(null);
    setStatus("dirty");
    void save();
  };

  if (status === "loading") return <LoadingBar label="Loading your note" />;

  return (
    <div className="grid gap-3 p-1">
      {status === "conflict" ? (
        <div role="alert" className="grid gap-2 bg-sun p-3 text-[var(--on-coin)]">
          <p className="m-0">
            This note was changed in another tab or on another device. Choose which version to keep.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={useTheirs}>
              Load the newer one
            </Button>
            <Button size="sm" variant="ghost" onClick={keepMine}>
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <span
          role="status"
          aria-live="polite"
          className="pq-font-pixel text-lg text-ink-soft"
          data-testid="note-status"
        >
          {STATUS_TEXT[status]}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-pressed={preview}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "Edit" : "Preview"}
        </Button>
      </div>
      {preview ? (
        text.trim() === "" ? (
          <p className="m-0 text-ink-soft">Nothing to preview yet.</p>
        ) : (
          <Markdown>{text}</Markdown>
        )
      ) : (
        <Textarea
          label="Your notes"
          rows={10}
          value={text}
          maxLength={MAX_NOTE_CHARS}
          onChange={(e) => edit(e.target.value)}
          helper="Markdown works here. Notes are private and saved automatically."
          mono
        />
      )}
    </div>
  );
}
