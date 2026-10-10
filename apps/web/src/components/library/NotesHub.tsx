"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Chip, LoadingBar, SearchPill, Tabs } from "@prepquest/ui";
import type { BookmarkItem, NoteHubItem } from "@prepquest/shared";
import { api } from "@/lib/api";
import { Markdown } from "@/components/problems/Markdown";

function Notes() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<NoteHubItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: "20" });
      if (q.trim()) params.set("q", q.trim());
      api<{ items: NoteHubItem[]; nextCursor: string | null }>(`/me/notes?${params}`)
        .then((r) => {
          if (!alive) return;
          setItems(r.items);
          setCursor(r.nextCursor);
        })
        .catch(() => alive && setFailed(true));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const more = async () => {
    const params = new URLSearchParams({ limit: "20", cursor: cursor ?? "" });
    if (q.trim()) params.set("q", q.trim());
    const r = await api<{ items: NoteHubItem[]; nextCursor: string | null }>(`/me/notes?${params}`);
    setItems((prev) => [...(prev ?? []), ...r.items]);
    setCursor(r.nextCursor);
  };

  return (
    <div className="grid gap-4 p-1">
      <SearchPill
        label="Search your notes"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search notes"
      />
      {failed ? (
        <p role="alert" className="m-0">
          Couldn&apos;t load your notes.
        </p>
      ) : items === null ? (
        <LoadingBar label="Loading notes" />
      ) : items.length === 0 ? (
        <p className="m-0" data-testid="no-notes">
          {q
            ? "No notes match that search."
            : "No notes yet. Open a problem and use its Notes tab."}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0" aria-label="Notes">
          {items.map((n) => (
            <li key={`${n.problem?.slug}-${n.updatedAt}`} className="pq-card pq-box grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {n.problem ? (
                  <Link href={`/problems/${n.problem.slug}`} className="font-semibold underline">
                    {n.problem.title}
                  </Link>
                ) : (
                  <span>General note</span>
                )}
                {n.problem?.archived ? <Chip tone="hard">problem archived</Chip> : null}
                <time className="ml-auto text-xs text-ink-soft" dateTime={n.updatedAt}>
                  {new Date(n.updatedAt).toLocaleDateString()}
                </time>
              </div>
              <div className="max-h-40 overflow-hidden">
                <Markdown>{n.bodyMd}</Markdown>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <div>
          <Button variant="ghost" onClick={() => void more()}>
            Show more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Bookmarks() {
  const [items, setItems] = useState<BookmarkItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ items: BookmarkItem[] }>("/me/bookmarks")
      .then((r) => alive && setItems(r.items))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);

  const remove = async (slug: string) => {
    setItems((prev) => prev?.filter((b) => b.problem.slug !== slug) ?? null);
    await api(`/me/bookmarks/${slug}`, { method: "DELETE" }).catch(() => undefined);
  };

  if (items === null) return <LoadingBar label="Loading bookmarks" />;
  if (items.length === 0) {
    return (
      <p className="m-0 p-1" data-testid="no-bookmarks">
        No bookmarks yet. Use the Bookmark button on a problem to save it for later.
      </p>
    );
  }
  const folders = [...new Set(items.map((b) => b.folder))];
  return (
    <div className="grid gap-5 p-1">
      {folders.map((folder) => (
        <section key={folder} aria-label={`Folder ${folder}`} className="grid gap-2">
          <h2 className="pq-font-ui m-0 text-sm uppercase">
            {folder === "default" ? "Saved" : folder}
          </h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {items
              .filter((b) => b.folder === folder)
              .map((b) => (
                <li
                  key={b.problem.slug}
                  className="pq-card pq-box flex flex-wrap items-center gap-3"
                >
                  <Chip tone={b.problem.difficulty}>{b.problem.difficulty}</Chip>
                  <Link href={`/problems/${b.problem.slug}`} className="font-semibold underline">
                    {b.problem.title}
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`Remove bookmark for ${b.problem.title}`}
                    onClick={() => void remove(b.problem.slug)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Notes hub and bookmarks (U3). */
export function NotesHub() {
  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Notes and bookmarks</h1>
      <Tabs
        aria-label="Library"
        items={[
          { id: "notes", label: "Notes", content: <Notes /> },
          { id: "bookmarks", label: "Bookmarks", content: <Bookmarks /> },
        ]}
      />
    </div>
  );
}
