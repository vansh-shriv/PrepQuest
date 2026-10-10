"use client";

import { useState } from "react";
import { Chip, LoadingBar, StageBar, VerdictBanner, type VerdictCode } from "@prepquest/ui";
import type { SubmissionDetail, SubmissionTestResult } from "@prepquest/shared";
import type { JudgeState } from "@/features/submissions/use-judge";

const STAGES = ["Queued", "Compiling", "Running", "Done"] as const;
const STAGE_INDEX: Record<string, number> = { QUEUED: 0, COMPILING: 1, RUNNING: 2 };

const CHIP_TONE = {
  AC: "easy",
  WA: "hard",
  RE: "hard",
  CE: "hard",
  TLE: "medium",
  MLE: "medium",
  OLE: "medium",
  IE: "info",
} as const;

export const testName = (r: Pick<SubmissionTestResult, "ordinal" | "kind">): string =>
  r.kind === "sample"
    ? `Sample ${r.ordinal}`
    : r.kind === "custom"
      ? `Custom ${r.ordinal - 1000}`
      : `Test ${r.ordinal}`;

const memoryText = (kb: number | null) =>
  kb === null || kb === 0 ? null : kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

export function summaryMeta(s: SubmissionDetail): string {
  const parts: string[] = [];
  if (s.total !== null && s.kind === "submit") parts.push(`${s.passed ?? 0} / ${s.total} passed`);
  if (s.timeMs !== null) parts.push(`${s.timeMs} ms`);
  const mem = memoryText(s.memoryKb);
  if (mem) parts.push(mem);
  return parts.join(" · ");
}

export function bannerDetail(s: SubmissionDetail): string | null {
  switch (s.verdict) {
    case "AC":
      return s.kind === "submit"
        ? `All ${s.total ?? ""} tests passed.`.replace("  ", " ")
        : "Everything you ran matched.";
    case "IE":
      return "Something went wrong on our side. Your code was not judged, so try again.";
    case "CE":
      return "Your code didn't compile.";
    default: {
      if (!s.failing) return null;
      const name = testName({ ordinal: s.failing.ordinal, kind: s.failing.kind });
      const hidden = s.failing.kind !== "sample" && s.failing.kind !== "custom";
      return hidden
        ? `Failed on ${name.toLowerCase()}${s.failing.label ? ` (${s.failing.label})` : ""}. Hidden tests don't show their data.`
        : `Failed on ${name.toLowerCase()}.`;
    }
  }
}

function Block({ title, children }: { title: string; children: string }) {
  return (
    <div className="grid gap-1">
      <p className="pq-font-ui m-0 text-xs uppercase text-ink-soft">{title}</p>
      <pre
        className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words bg-surface-alt p-2 text-sm"
        style={{ fontFamily: "var(--font-code)" }}
      >
        {children === "" ? "(empty)" : children}
      </pre>
    </div>
  );
}

function TestRow({ r }: { r: SubmissionTestResult }) {
  const [open, setOpen] = useState(r.verdict !== "AC" && r.kind === "sample");
  const hasDetail =
    r.input !== undefined ||
    r.stdout !== undefined ||
    r.expected !== undefined ||
    !!r.checkerMsg ||
    !!r.stderr;
  const mem = memoryText(r.memoryKb);
  return (
    <li className="grid gap-2 border-b-2 border-surface-alt py-2 last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-3 bg-transparent p-0 text-left text-ink"
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="pq-font-ui min-w-24 text-sm uppercase">{testName(r)}</span>
        <Chip tone={CHIP_TONE[r.verdict as keyof typeof CHIP_TONE] ?? "neutral"}>{r.verdict}</Chip>
        <span className="ml-auto text-sm text-ink-soft">
          {r.timeMs !== null ? `${r.timeMs} ms` : ""}
          {mem ? ` · ${mem}` : ""}
        </span>
        {hasDetail ? <span aria-hidden="true">{open ? "-" : "+"}</span> : null}
      </button>
      {open && hasDetail ? (
        <div className="grid gap-2 pl-1">
          {r.checkerMsg ? <p className="m-0 text-sm">{r.checkerMsg}</p> : null}
          {r.input !== undefined ? <Block title="Input">{r.input}</Block> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {r.expected !== undefined ? <Block title="Expected">{r.expected}</Block> : null}
            {r.stdout !== undefined ? <Block title="Your output">{r.stdout}</Block> : null}
          </div>
          {r.stderr ? <Block title="Error output">{r.stderr}</Block> : null}
        </div>
      ) : null}
    </li>
  );
}

/** The judge's answer: progress while it works, then the verdict banner and per-test results. */
export function ResultPanel({ state }: { state: JudgeState }) {
  if (state.phase === "idle") {
    return (
      <p className="m-0 p-1 text-sm text-ink-soft" data-testid="result-idle">
        Press Run to try your code on the samples and your custom tests, or Submit to judge it
        against every test.
      </p>
    );
  }
  if (state.phase === "failed") {
    return (
      <p
        role="alert"
        className="pq-font-pixel m-0 p-1 text-xl text-danger"
        data-testid="result-error"
      >
        {state.error}
      </p>
    );
  }
  if (state.phase === "sending" || state.phase === "waiting") {
    const current = STAGE_INDEX[state.submission?.verdict ?? "QUEUED"] ?? 0;
    return (
      <div className="grid gap-2 p-1" data-testid="result-progress">
        {state.phase === "sending" ? (
          <LoadingBar
            label={state.kind === "submit" ? "Sending your submission" : "Sending your code"}
          />
        ) : (
          <StageBar
            stages={STAGES}
            current={current}
            label={state.kind === "submit" ? "Judging your submission" : "Running your code"}
          />
        )}
        {state.queuePosition && current === 0 && state.queuePosition > 1 ? (
          <p className="m-0 text-sm text-ink-soft">{state.queuePosition - 1} ahead of you.</p>
        ) : null}
        {state.submission && state.submission.results.length > 0 ? (
          <p className="m-0 text-sm text-ink-soft">
            {state.submission.results.length} of {state.submission.total ?? "?"} tests done.
          </p>
        ) : null}
      </div>
    );
  }

  const s = state.submission;
  if (!s) return null;
  const meta = summaryMeta(s);
  return (
    <div className="grid gap-3 p-1" data-testid="result-done">
      <VerdictBanner
        verdict={s.verdict as VerdictCode}
        detail={bannerDetail(s)}
        {...(meta ? { meta } : {})}
      />
      {s.compileOutput ? <Block title="Compiler output">{s.compileOutput}</Block> : null}
      {s.verdict === "RE" && s.stderrTail ? (
        <Block title="Error output">{s.stderrTail}</Block>
      ) : null}
      {s.results.length > 0 ? (
        <ul className="m-0 list-none p-0" aria-label="Test results">
          {s.results.map((r) => (
            <TestRow key={r.ordinal} r={r} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
