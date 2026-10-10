"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, LoadingBar } from "@prepquest/ui";
import type {
  SubmissionDetail,
  SubmissionListItem,
  SubmissionListResponse,
} from "@prepquest/shared";
import { api } from "@/lib/api";

const CHIP_TONE = { AC: "easy", WA: "hard", RE: "hard", CE: "hard", IE: "info" } as const;
export const verdictTone = (v: string) =>
  CHIP_TONE[v as keyof typeof CHIP_TONE] ?? ("medium" as const);

export const LANGUAGE_SHORT = { cpp: "C++", java: "Java", python: "Python" } as const;

/** This problem's attempts, newest first (U2). `onLoadCode` puts an old attempt back in the editor. */
export function SubmissionHistory({
  slug,
  refreshKey,
  onLoadCode,
}: {
  slug: string;
  /** Changes whenever a new submission finishes, so the list refreshes itself. */
  refreshKey: number;
  onLoadCode: (code: string, language: SubmissionListItem["language"]) => void;
}) {
  const [items, setItems] = useState<SubmissionListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api<SubmissionListResponse>(`/me/submissions?problem=${slug}&limit=10`)
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setCursor(r.nextCursor);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [slug, refreshKey]);

  const more = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await api<SubmissionListResponse>(
        `/me/submissions?problem=${slug}&limit=10&cursor=${cursor}`,
      );
      setItems((prev) => [...(prev ?? []), ...r.items]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, slug]);

  const load = async (id: string) => {
    const detail = await api<SubmissionDetail>(`/submissions/${id}`);
    if (detail.code) onLoadCode(detail.code, detail.language);
  };

  if (failed) return <p className="m-0 p-2">Couldn&apos;t load your submissions.</p>;
  if (items === null) return <LoadingBar label="Loading submissions" />;
  if (items.length === 0) {
    return <p className="m-0 p-2">No submissions yet. Submit your solution to see it here.</p>;
  }
  return (
    <div className="grid gap-3 p-1">
      <ul className="m-0 grid list-none gap-2 p-0" aria-label="Your submissions">
        {items.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center gap-2 border-b-2 border-surface-alt pb-2"
          >
            <Chip tone={verdictTone(s.verdict)}>{s.verdict}</Chip>
            <span className="pq-font-ui text-xs uppercase">{LANGUAGE_SHORT[s.language]}</span>
            <span className="text-sm text-ink-soft">
              {s.timeMs !== null ? `${s.timeMs} ms` : ""}
              {s.passed !== null && s.total !== null && s.verdict !== "AC" && s.verdict !== "CE"
                ? ` · ${s.passed}/${s.total}`
                : ""}
            </span>
            <time className="ml-auto text-xs text-ink-soft" dateTime={s.createdAt}>
              {new Date(s.createdAt).toLocaleString()}
            </time>
            <div className="flex w-full flex-wrap items-center gap-2">
              {s.note ? <span className="text-sm italic">{s.note}</span> : null}
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => void load(s.id)}>
                  Load code
                </Button>
                <Link
                  href={`/submissions/${s.id}`}
                  className="pq-font-ui text-xs uppercase underline"
                >
                  Details
                </Link>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {cursor ? (
        <Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void more()}>
          Show more
        </Button>
      ) : null}
    </div>
  );
}
