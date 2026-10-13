"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip, LoadingBar, VerdictBanner, Window } from "@prepquest/ui";
import type { SqlProblemDto, SqlRunResult, SqlSubmitResult, SqlTableDto } from "@prepquest/shared";
import {
  bannerVerdict,
  cellText,
  DIFFICULTY_TONE,
  isNullCell,
  rowsText,
} from "@/features/assess/assess-view";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";
import { CodeEditor } from "../problems/CodeEditor";
import { Markdown } from "../problems/Markdown";

const STARTER = "SELECT \n";

/** One SQL problem: statement, schema explorer, editor, run and submit. */
export function SqlWorkspace() {
  const { slug } = useParams<{ slug: string }>();
  const [problem, setProblem] = useState<SqlProblemDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(STARTER);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<"run" | "submit" | null>(null);
  const [ran, setRan] = useState<SqlRunResult | null>(null);
  const [submitted, setSubmitted] = useState<SqlSubmitResult | null>(null);
  const [showHint, setShowHint] = useState(false);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    api<SqlProblemDto>(`/sql/problems/${slug}`)
      .then((p) => {
        setProblem(p);
        if (p.lastQuery) {
          setQuery(p.lastQuery);
          setRevision((r) => r + 1);
        }
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't reach the server."),
      );
  }, [slug]);

  const run = useCallback(async () => {
    setBusy("run");
    setError(null);
    try {
      setSubmitted(null);
      setRan(
        await api<SqlRunResult>(`/sql/problems/${slug}/run`, {
          method: "POST",
          json: { query: queryRef.current },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }, [slug]);

  const submit = useCallback(async () => {
    setBusy("submit");
    setError(null);
    try {
      const r = await api<SqlSubmitResult>(`/sql/problems/${slug}/submit`, {
        method: "POST",
        json: { query: queryRef.current },
      });
      setRan(null);
      setSubmitted(r);
      if (r.solution) {
        setProblem((p) => (p ? { ...p, solved: true, solution: r.solution } : p));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }, [slug]);

  if (error && !problem) return <FormError message={error} />;
  if (!problem) return <LoadingBar label="Loading the problem" />;

  const result = submitted?.result ?? ran;

  return (
    <div className="grid max-w-6xl gap-4" data-testid="sql-workspace">
      <div>
        <Link href="/sql" className="text-sm underline">
          All SQL problems
        </Link>
        <h1 className="pq-font-display m-0 flex flex-wrap items-center gap-3 text-lg leading-relaxed">
          {problem.title}
          <Chip tone={DIFFICULTY_TONE[problem.difficulty]}>{problem.difficulty}</Chip>
          <Chip>{problem.topic}</Chip>
          {problem.solved && <Chip tone="easy">solved</Chip>}
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="grid content-start gap-4">
          <Window title="The task" tone="sun">
            <div className="grid gap-3">
              <Markdown>{problem.statement}</Markdown>
              <p className="m-0 text-sm text-ink-soft">
                {problem.orderSensitive
                  ? "The order of the rows is part of the answer."
                  : "Row order does not matter."}
              </p>
              {problem.hint && (
                <div>
                  {showHint ? (
                    <p className="m-0" data-testid="sql-hint">
                      Hint: {problem.hint}
                    </p>
                  ) : (
                    <Button variant="ghost" onClick={() => setShowHint(true)}>
                      Show a hint
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Window>

          <Window title={`Tables (${problem.dataset.title})`} tone="sky">
            <div className="grid gap-3" data-testid="sql-schema">
              {problem.dataset.description && (
                <p className="m-0 text-sm text-ink-soft">{problem.dataset.description}</p>
              )}
              {problem.tables.map((t) => (
                <TableCard key={t.name} table={t} />
              ))}
            </div>
          </Window>
        </div>

        <div className="grid content-start gap-4">
          <div className="pq-box h-64" aria-label="SQL editor">
            <CodeEditor
              value={query}
              revision={revision}
              language="sql"
              label="SQL editor"
              onChange={setQuery}
              onRun={run}
              onSubmit={submit}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button loading={busy === "run"} disabled={busy !== null} onClick={run}>
              Run
            </Button>
            <Button
              variant="accent"
              loading={busy === "submit"}
              disabled={busy !== null}
              onClick={submit}
            >
              Submit
            </Button>
            <span className="text-sm text-ink-soft">
              Ctrl+Enter runs, Ctrl+Shift+Enter submits.
            </span>
          </div>
          <FormError message={error} />

          {submitted && (
            <VerdictBanner
              verdict={bannerVerdict(submitted.verdict)}
              detail={submitted.message ?? undefined}
              meta={
                submitted.verdict === "AC" && submitted.xpAwarded > 0
                  ? `+${submitted.xpAwarded} XP`
                  : `${submitted.result.ms} ms`
              }
            />
          )}
          {result && <ResultTable result={result} />}

          {problem.solution && (
            <Window title="Reference solution" tone="olive">
              <div className="grid gap-2" data-testid="sql-solution">
                <pre className="m-0 overflow-x-auto whitespace-pre-wrap">
                  <code>{problem.solution.query}</code>
                </pre>
                {problem.solution.note && <p className="m-0">{problem.solution.note}</p>}
              </div>
            </Window>
          )}
        </div>
      </div>
    </div>
  );
}

function TableCard({ table }: { table: SqlTableDto }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-1" data-testid="sql-table">
      <strong>
        {table.name} <span className="text-sm text-ink-soft">({table.rowCount} rows)</span>
      </strong>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-sm">
        {table.columns.map((c) => (
          <li key={c.name}>
            <code>{c.name}</code> <span className="text-ink-soft">{c.type.toLowerCase()}</span>
            {c.pk ? " (key)" : ""}
          </li>
        ))}
      </ul>
      <div>
        <Button variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide sample rows" : "Show sample rows"}
        </Button>
      </div>
      {open && (
        <Grid columns={table.columns.map((c) => c.name)} rows={table.preview} label={table.name} />
      )}
    </div>
  );
}

function ResultTable({ result }: { result: SqlRunResult }) {
  if (!result.ok) {
    return (
      <div className="pq-box p-3" role="status" data-testid="sql-error">
        <strong>{result.timedOut ? "Stopped" : "The query could not run"}</strong>
        <p className="m-0 mt-1">{result.error}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-1" data-testid="sql-result">
      <span className="text-sm text-ink-soft">
        {rowsText(result.rows.length, result.truncated)} · {result.ms} ms
      </span>
      <Grid columns={result.columns} rows={result.rows} label="Query result" />
    </div>
  );
}

function Grid({
  columns,
  rows,
  label,
}: {
  columns: string[];
  rows: SqlRunResult["rows"];
  label: string;
}) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full border-collapse text-left text-sm" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={`${c}-${i}`} scope="col" className="border-b border-ink-soft px-2 py-1">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={Math.max(1, columns.length)} className="px-2 py-1 text-ink-soft">
                No rows.
              </td>
            </tr>
          )}
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((cell, ci) => (
                <td
                  key={ci}
                  className={`border-b border-surface-alt px-2 py-1 ${isNullCell(cell) ? "text-ink-soft italic" : ""}`}
                >
                  {cellText(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
