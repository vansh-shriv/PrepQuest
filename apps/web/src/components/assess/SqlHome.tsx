"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Chip, LoadingBar, Select, Window } from "@prepquest/ui";
import type { SqlListResponse } from "@prepquest/shared";
import {
  DIFFICULTY_TONE,
  filterProblems,
  groupByDataset,
  type SqlFilters,
} from "@/features/assess/assess-view";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";

/** SQL practice (C1): problems on small datasets, judged by comparing result sets. */
export function SqlHome() {
  const [data, setData] = useState<SqlListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SqlFilters>({ topic: "", difficulty: "", status: "all" });

  useEffect(() => {
    api<SqlListResponse>("/sql/problems")
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't reach the server."),
      );
  }, []);

  const groups = useMemo(
    () => (data ? groupByDataset(filterProblems(data.problems, filters)) : []),
    [data, filters],
  );

  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading SQL problems" />;

  return (
    <div className="grid max-w-4xl gap-6" data-testid="sql-home">
      <div>
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">SQL practice</h1>
        <p className="m-0 mt-2">
          Write a query, run it on a small dataset, and submit when the result looks right. Your
          result is compared with the expected one: column names and (unless the problem says
          otherwise) row order do not matter. {data.solved} of {data.total} solved.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          label="Topic"
          value={filters.topic}
          onChange={(e) => setFilters({ ...filters, topic: e.target.value })}
        >
          <option value="">All topics</option>
          {data.topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Select
          label="Difficulty"
          value={filters.difficulty}
          onChange={(e) => setFilters({ ...filters, difficulty: e.target.value })}
        >
          <option value="">Any</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </Select>
        <Select
          label="Status"
          value={filters.status}
          onChange={(e) =>
            setFilters({ ...filters, status: e.target.value as SqlFilters["status"] })
          }
        >
          <option value="all">All</option>
          <option value="todo">Not solved yet</option>
          <option value="solved">Solved</option>
        </Select>
      </div>

      {groups.length === 0 && <p>No problems match these filters.</p>}
      {groups.map((g) => (
        <Window key={g.dataset} title={`Dataset: ${g.title}`} tone="sky">
          <ul className="m-0 grid list-none gap-2 p-0" data-testid="sql-list">
            {g.problems.map((p) => (
              <li key={p.slug} className="flex flex-wrap items-center gap-2">
                <Link href={`/sql/${p.slug}`} className="underline">
                  {p.title}
                </Link>
                <Chip tone={DIFFICULTY_TONE[p.difficulty]}>{p.difficulty}</Chip>
                <Chip>{p.topic}</Chip>
                {p.solved && <Chip tone="easy">solved</Chip>}
                {!p.solved && p.attempts > 0 && (
                  <span className="text-sm text-ink-soft">
                    {p.attempts} attempt{p.attempts === 1 ? "" : "s"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Window>
      ))}
    </div>
  );
}
