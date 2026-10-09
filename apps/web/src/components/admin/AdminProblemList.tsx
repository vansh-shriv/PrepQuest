"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClasses, Chip, LoadingBar, SearchPill, Select, Window } from "@prepquest/ui";
import type { AdminProblemListItem, ProblemStatusValue } from "@prepquest/shared";
import { api } from "@/lib/api";

export const STATUS_TONE: Record<ProblemStatusValue, "neutral" | "info" | "easy" | "hard"> = {
  draft: "neutral",
  in_review: "info",
  published: "easy",
  archived: "hard",
};
export const STATUS_LABEL: Record<ProblemStatusValue, string> = {
  draft: "draft",
  in_review: "in review",
  published: "published",
  archived: "archived",
};

export function AdminProblemList() {
  const [items, setItems] = useState<AdminProblemListItem[] | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (q.trim()) qs.set("q", q.trim());
      api<{ items: AdminProblemListItem[] }>(`/admin/problems?${qs}`)
        .then((r) => alive && (setItems(r.items), setError(null)))
        .catch(() => alive && setError("Couldn't load problems."));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [status, q]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">Content</h1>
        <Link href="/admin/problems/new" className={buttonClasses({ variant: "accent" })}>
          New problem
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[14rem] flex-1">
          <SearchPill label="Search by title" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="in_review">In review</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      {error ? (
        <Window title="Error" tone="danger">
          {error}
        </Window>
      ) : items === null ? (
        <LoadingBar label="Loading" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left" data-testid="admin-table">
            <caption className="pq-sr-only">Problems</caption>
            <thead>
              <tr className="bg-olive text-[var(--on-olive)]">
                {["Title", "Difficulty", "Status", "Version", "Tests", "Updated"].map((h) => (
                  <th key={h} scope="col" className="pq-font-ui px-3 py-2 text-xs uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((p, i) => (
                <tr key={p.id} className={i % 2 ? "bg-surface-alt" : "bg-surface"}>
                  <td className="border-b-2 border-ink px-3 py-2">
                    <Link href={`/admin/problems/${p.id}`} className="font-semibold underline">
                      {p.title}
                    </Link>
                    <br />
                    <span className="text-sm text-ink-soft">{p.slug}</span>
                  </td>
                  <td className="border-b-2 border-ink px-3 py-2">
                    <Chip tone={p.difficulty}>{p.difficulty}</Chip>
                  </td>
                  <td className="border-b-2 border-ink px-3 py-2">
                    <Chip tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Chip>
                  </td>
                  <td className="border-b-2 border-ink px-3 py-2">v{p.version}</td>
                  <td className="border-b-2 border-ink px-3 py-2">{p.tests}</td>
                  <td className="border-b-2 border-ink px-3 py-2 text-sm">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center">
                    No problems match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
