"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, LoadingBar, Select, SearchPill } from "@prepquest/ui";
import {
  VERDICT_VALUES,
  type SubmissionListItem,
  type SubmissionListResponse,
} from "@prepquest/shared";
import { api } from "@/lib/api";
import { LANGUAGE_SHORT, verdictTone } from "@/components/problems/SubmissionHistory";

/** Global submission history (U2): filter by verdict, language and problem; newest first. */
export function SubmissionsPage() {
  const [verdict, setVerdict] = useState("");
  const [language, setLanguage] = useState("");
  const [kind, setKind] = useState<"submit" | "all">("submit");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SubmissionListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const query = useCallback(
    (after?: string) => {
      const params = new URLSearchParams({ limit: "25", kind });
      if (verdict) params.set("verdict", verdict);
      if (language) params.set("language", language);
      if (q.trim()) params.set("q", q.trim());
      if (after) params.set("cursor", after);
      return `/me/submissions?${params}`;
    },
    [verdict, language, kind, q],
  );

  useEffect(() => {
    let alive = true;
    setFailed(false);
    // a short pause while typing in the search box
    const t = setTimeout(() => {
      api<SubmissionListResponse>(query())
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
  }, [query]);

  const more = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await api<SubmissionListResponse>(query(cursor));
      setItems((prev) => [...(prev ?? []), ...r.items]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Submissions</h1>
      <div className="flex flex-wrap items-end gap-3">
        <SearchPill
          label="Search by problem"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Problem title"
        />
        <Select label="Verdict" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
          <option value="">All verdicts</option>
          {VERDICT_VALUES.filter((v) => !["QUEUED", "COMPILING", "RUNNING"].includes(v)).map(
            (v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ),
          )}
        </Select>
        <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">All languages</option>
          <option value="cpp">C++</option>
          <option value="java">Java</option>
          <option value="python">Python</option>
        </Select>
        <Select
          label="Show"
          value={kind}
          onChange={(e) => setKind(e.target.value as "submit" | "all")}
        >
          <option value="submit">Submissions</option>
          <option value="all">Submissions and runs</option>
        </Select>
      </div>

      {failed ? (
        <p role="alert" className="m-0">
          Couldn&apos;t load your submissions. Try again.
        </p>
      ) : items === null ? (
        <LoadingBar label="Loading submissions" />
      ) : items.length === 0 ? (
        <p className="m-0" data-testid="no-submissions">
          Nothing here yet. Solve a{" "}
          <Link href="/problems" className="underline">
            problem
          </Link>{" "}
          and your attempts will show up.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Submissions">
          {items.map((s) => (
            <li key={s.id} className="pq-card pq-box flex flex-wrap items-center gap-3">
              <Chip tone={verdictTone(s.verdict)}>{s.verdict}</Chip>
              <Link href={`/submissions/${s.id}`} className="font-semibold underline">
                {s.problem.title}
              </Link>
              <span className="pq-font-ui text-xs uppercase">{LANGUAGE_SHORT[s.language]}</span>
              {s.kind === "run" ? <Chip>run</Chip> : null}
              <span className="text-sm text-ink-soft">
                {s.timeMs !== null ? `${s.timeMs} ms` : ""}
                {s.passed !== null && s.total !== null && s.verdict !== "AC" && s.verdict !== "CE"
                  ? ` · ${s.passed}/${s.total} passed`
                  : ""}
              </span>
              <time className="ml-auto text-xs text-ink-soft" dateTime={s.createdAt}>
                {new Date(s.createdAt).toLocaleString()}
              </time>
              {s.note ? <p className="m-0 w-full text-sm italic">{s.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <div>
          <Button variant="ghost" loading={loadingMore} onClick={() => void more()}>
            Show more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
