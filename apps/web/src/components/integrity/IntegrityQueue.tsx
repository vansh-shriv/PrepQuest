"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, Input, LoadingBar, Select, Sprite, Textarea, Window } from "@prepquest/ui";
import {
  INTEGRITY_REVIEW_ROLES,
  type FlagCodeSide,
  type FlagDetail,
  type FlagListResponse,
  type FlagStatus,
  type ScanResult,
} from "@prepquest/shared";
import {
  DECISION_LABEL,
  KIND_LABEL,
  SEVERITY_LABEL,
  STATUS_FILTERS,
  STATUS_LABEL,
  allowedDecisions,
  countsText,
  percent,
} from "@/features/integrity/integrity-view";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { FormError } from "../auth/AuthCard";

const SEVERITY_TONE = { low: "info", medium: "medium", high: "hard" } as const;

function Code({ side, title }: { side: FlagCodeSide; title: string }) {
  const marked = new Set(side.matchedLines);
  const lines = side.code.replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="grid min-w-0 gap-1">
      <h4 className="pq-font-ui m-0 text-xs uppercase">
        {title}: {side.handle}
      </h4>
      <div
        className="max-h-96 overflow-auto bg-surface-alt p-2 text-sm"
        style={{ fontFamily: "var(--font-code)" }}
        role="region"
        tabIndex={0}
        aria-label={`Code of ${side.handle}`}
        data-testid="flag-code"
      >
        {lines.map((l, i) => (
          <div
            key={i}
            className={`flex gap-3 whitespace-pre ${marked.has(i + 1) ? "bg-[color-mix(in_srgb,var(--sun)_45%,transparent)]" : ""}`}
          >
            <span className="w-7 shrink-0 select-none text-right text-ink-soft" aria-hidden="true">
              {i + 1}
            </span>
            <span>
              {marked.has(i + 1) ? <span className="sr-only">matching line: </span> : null}
              {l}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Detail({
  id,
  role,
  onChanged,
}: {
  id: string;
  role: string | undefined;
  onChanged: () => void;
}) {
  const [flag, setFlag] = useState<FlagDetail | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setFlag(null);
    api<FlagDetail>(`/admin/integrity/flags/${id}`)
      .then((f) => alive && setFlag(f))
      .catch(
        (e: unknown) => alive && setError(e instanceof ApiError ? e.message : "Couldn't load."),
      );
    return () => {
      alive = false;
    };
  }, [id]);

  const decide = async (decision: "confirm" | "dismiss" | "escalate") => {
    setError(null);
    try {
      setFlag(
        await api<FlagDetail>(`/admin/integrity/flags/${id}`, {
          method: "PATCH",
          json: { decision, note },
        }),
      );
      setNote("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the decision.");
    }
  };

  if (!flag) return error ? <FormError message={error} /> : <LoadingBar label="Loading the flag" />;
  const decisions = allowedDecisions(flag.status, role);

  return (
    <div className="grid gap-4" data-testid="flag-detail">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{flag.user.displayName}</strong>
        <span className="text-sm text-ink-soft">@{flag.user.handle}</span>
        <Chip>{KIND_LABEL[flag.kind]}</Chip>
        <Chip tone={SEVERITY_TONE[flag.severity]}>{SEVERITY_LABEL[flag.severity]}</Chip>
        <Chip>{STATUS_LABEL[flag.status]}</Chip>
      </div>
      {countsText(flag.counts) && <p className="m-0 text-sm">{countsText(flag.counts)}</p>}
      {flag.aggravating.length > 0 && (
        <p className="m-0 text-sm">Raised by other signals: {flag.aggravating.join("; ")}.</p>
      )}
      {flag.aiStyle.length > 0 && (
        <p className="m-0 text-sm text-ink-soft">{flag.aiStyle.join(" ")}</p>
      )}

      {flag.pairs.map((p, i) => (
        <section key={i} className="grid gap-2" aria-label={`Match ${i + 1}`}>
          <p className="m-0 text-sm" data-testid="flag-pair">
            {percent(p.similarity)} of the smaller program appears in the other (
            {p.mine.problemSlug}). Highlighted lines match after names, numbers, comments and
            spacing are ignored.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Code side={p.mine} title="Flagged" />
            <Code side={p.other} title="Compared with" />
          </div>
        </section>
      ))}

      {flag.appealText && (
        <Window title="The learner's appeal" tone="sky">
          <p className="m-0" data-testid="flag-appeal">
            {flag.appealText}
          </p>
        </Window>
      )}
      {flag.decisionNote && (
        <p className="m-0 text-sm text-ink-soft">
          Last decision{flag.reviewedBy ? ` by @${flag.reviewedBy}` : ""}: {flag.decisionNote}
        </p>
      )}

      {decisions.length > 0 ? (
        <div className="grid gap-2">
          <FormError message={error} />
          <Textarea
            label="Reason (the learner sees it for confirmed flags)"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {decisions.map((d) => (
              <Button
                key={d}
                variant={d === "confirm" ? "danger" : d === "dismiss" ? "primary" : "ghost"}
                onClick={() => void decide(d)}
                disabled={note.trim().length < 5}
              >
                {DECISION_LABEL[d]}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="m-0 text-sm text-ink-soft">
          {flag.status === "escalated" ? "An admin decides this one." : ""}
        </p>
      )}
    </div>
  );
}

/** The integrity queue (X2): scan a contest, look at the evidence side by side, decide, audit. */
export function IntegrityQueue() {
  const { user } = useAuth();
  const [list, setList] = useState<FlagListResponse | null>(null);
  const [status, setStatus] = useState<FlagStatus | "">("open");
  const [selected, setSelected] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(
        await api<FlagListResponse>(`/admin/integrity/flags${status ? `?status=${status}` : ""}`),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the queue.");
    }
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;
  if (!(INTEGRITY_REVIEW_ROLES as readonly string[]).includes(user.role)) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <Sprite name="dino" scale={6} label="Dino" />
        <Window title="Restricted" tone="danger">
          <p className="mt-0">This queue is for reviewers, moderators and admins.</p>
          <Link href="/dashboard" className="underline">
            Back to the dashboard
          </Link>
        </Window>
      </div>
    );
  }

  const runScan = async () => {
    setError(null);
    setScan(null);
    try {
      setScan(
        await api<ScanResult>("/admin/integrity/scan", {
          method: "POST",
          json: { contestSlug: slug.trim() },
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The scan failed.");
    }
  };

  return (
    <div className="grid max-w-6xl gap-5" data-testid="integrity-queue">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Fair play</h1>
      <p className="m-0 text-sm text-ink-soft">
        Flags are evidence, not verdicts. Nothing changes for anyone until a person confirms it.
        {list ? ` ${list.open} waiting.` : ""}
      </p>

      <Window title="Scan a contest" tone="sky">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Contest slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            helper="Compares every pair of accepted solutions and reads the paste and tab-change counts."
          />
          <Button onClick={() => void runScan()} disabled={slug.trim().length === 0}>
            Scan
          </Button>
        </div>
        {scan && (
          <p className="mb-0 mt-2 text-sm" role="status" data-testid="scan-result">
            Scanned {scan.participants} participants, compared {scan.compared} pairs:{" "}
            {scan.flagsCreated} new flags, {scan.flagsUpdated} refreshed.
          </p>
        )}
      </Window>
      <FormError message={error} />

      <div className="grid items-start gap-5 lg:grid-cols-[22rem_1fr]">
        <div className="grid gap-3">
          <Select
            label="Show"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as FlagStatus | "");
              setSelected(null);
            }}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          {!list ? (
            <LoadingBar label="Loading the queue" />
          ) : list.items.length === 0 ? (
            <p className="m-0" data-testid="queue-empty">
              Nothing here.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0" data-testid="flag-list">
              {list.items.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className={`pq-box w-full bg-surface p-2 text-left ${selected === f.id ? "outline outline-4 outline-ink" : ""}`}
                    onClick={() => setSelected(f.id)}
                    data-testid="flag-row"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <strong>@{f.user.handle}</strong>
                      <Chip>{KIND_LABEL[f.kind]}</Chip>
                      <Chip tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</Chip>
                    </span>
                    <span className="block text-sm text-ink-soft">
                      {STATUS_LABEL[f.status]}
                      {f.score !== null ? ` · ${percent(f.score)}` : ""}
                      {f.contest ? ` · ${f.contest.title}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          {selected ? (
            <Detail id={selected} role={user.role} onChanged={() => void load()} />
          ) : (
            <p className="m-0 text-ink-soft">Choose a flag to see the evidence.</p>
          )}
        </div>
      </div>
    </div>
  );
}
