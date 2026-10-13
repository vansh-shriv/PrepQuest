"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Chip, LoadingBar, Select } from "@prepquest/ui";
import type { ComplexityDto } from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";
import {
  CLAIM_OPTIONS,
  CONFIDENCE_TEXT,
  chartGeometry,
  complexityPollMs,
  msText,
  sizeText,
} from "@/features/review/review-view";

const W = 480;
const H = 220;

/** Pixel line chart of run time against input size. The table underneath carries the same numbers. */
function GrowthChart({ analysis }: { analysis: ComplexityDto }) {
  const g = useMemo(() => chartGeometry(analysis.samples, W, H), [analysis.samples]);
  if (g.points.length === 0) return null;
  const bottom = H - 28;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Run time grows from ${msText(g.points[0]!.timeMs)} to ${msText(g.points[g.points.length - 1]!.timeMs)} as the input grows from ${sizeText(g.points[0]!.n)} to ${sizeText(g.maxN)}`}
      className="w-full max-w-xl bg-surface-alt"
      shapeRendering="crispEdges"
      data-testid="growth-chart"
    >
      <line x1="44" y1="12" x2="44" y2={bottom} stroke="var(--ink)" strokeWidth="2" />
      <line x1="44" y1={bottom} x2={W - 12} y2={bottom} stroke="var(--ink)" strokeWidth="2" />
      <text x="44" y={H - 8} fontSize="10" fill="var(--ink-soft)">
        0
      </text>
      <text x={W - 12} y={H - 8} fontSize="10" textAnchor="end" fill="var(--ink-soft)">
        {sizeText(g.maxN)} items
      </text>
      <text x="40" y="20" fontSize="10" textAnchor="end" fill="var(--ink-soft)">
        {msText(g.maxMs)}
      </text>
      <path d={g.path} fill="none" stroke="var(--ink)" strokeWidth="2" />
      {g.points.map((p) =>
        p.limit ? (
          <path
            key={p.n}
            d={`M${p.x - 5} ${p.y - 5} L${p.x + 5} ${p.y + 5} M${p.x + 5} ${p.y - 5} L${p.x - 5} ${p.y + 5}`}
            stroke="var(--danger)"
            strokeWidth="3"
          />
        ) : (
          <rect
            key={p.n}
            x={p.x - 4}
            y={p.y - 4}
            width="8"
            height="8"
            fill="var(--sun)"
            stroke="var(--ink)"
            strokeWidth="2"
          />
        ),
      )}
    </svg>
  );
}

/** Complexity analyzer (X4): claim a Big-O, then see what the judge measured on inputs of growing size. */
export function ComplexityPanel({ submissionId }: { submissionId: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [analysis, setAnalysis] = useState<ComplexityDto | null>(null);
  const [claimed, setClaimed] = useState<string>(CLAIM_OPTIONS[3].value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await api<{ supported: boolean; analysis: ComplexityDto | null }>(
      `/submissions/${submissionId}/complexity`,
    );
    setSupported(res.supported);
    setAnalysis(res.analysis);
    if (res.analysis) setClaimed(res.analysis.claimed);
  };

  useEffect(() => {
    let alive = true;
    api<{ supported: boolean; analysis: ComplexityDto | null }>(
      `/submissions/${submissionId}/complexity`,
    )
      .then((res) => {
        if (!alive) return;
        setSupported(res.supported);
        setAnalysis(res.analysis);
        if (res.analysis) setClaimed(res.analysis.claimed);
      })
      .catch(() => alive && setSupported(false));
    return () => {
      alive = false;
    };
  }, [submissionId]);

  const delay = complexityPollMs(analysis);
  useEffect(() => {
    if (delay === null) return;
    const timer = setTimeout(() => void load().catch(() => undefined), delay);
    return () => clearTimeout(timer);
    // `load` only reads props; re-arming on every new analysis is the point
  }, [delay, analysis]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setAnalysis(
        await api<ComplexityDto>(`/submissions/${submissionId}/complexity`, {
          method: "POST",
          json: { claimed },
        }),
      );
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "That is a lot of checks for now. Try again in a few minutes."
          : err instanceof ApiError
            ? err.message
            : "The check could not be started.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (supported === null) return null;
  const running = analysis?.status === "running";

  return (
    <section className="grid gap-3" aria-labelledby="cx-h" data-testid="complexity-panel">
      <h2 id="cx-h" className="pq-font-ui m-0 text-sm uppercase">
        Complexity check
      </h2>
      {!supported ? (
        <p className="m-0 text-sm text-ink-soft">
          The growth check is not set up for this problem yet.
        </p>
      ) : (
        <>
          <p className="m-0 text-sm text-ink-soft">
            Say what you think the time complexity is. Your code then runs on inputs of growing size
            and the judge times each one.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="My claim"
              value={claimed}
              disabled={running}
              onChange={(e) => setClaimed(e.target.value)}
            >
              {CLAIM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Button onClick={() => void start()} disabled={busy || running} data-testid="cx-start">
              {analysis && analysis.status !== "running" ? "Measure again" : "Measure growth"}
            </Button>
          </div>
          {error ? (
            <p className="m-0 text-sm" role="status">
              {error}
            </p>
          ) : null}
          {running ? <LoadingBar label="Timing your code on bigger and bigger inputs" /> : null}
          {analysis?.status === "failed" ? (
            <p className="m-0 text-sm" role="status">
              {analysis.error}
            </p>
          ) : null}

          {analysis?.status === "ready" ? (
            <div className="grid gap-3" data-testid="cx-result">
              <p className="m-0" role="status" data-testid="cx-message">
                {analysis.message}
              </p>
              {analysis.measured ? (
                <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
                  <Chip tone={analysis.verdict === "worse" ? "hard" : "easy"}>
                    {analysis.verdict === "worse"
                      ? "Slower than claimed"
                      : analysis.verdict === "better"
                        ? "Faster than claimed"
                        : analysis.verdict === "matches"
                          ? "Matches your claim"
                          : "Not conclusive"}
                  </Chip>
                  <span>{CONFIDENCE_TEXT[analysis.measured.confidence]}</span>
                </p>
              ) : null}
              <GrowthChart analysis={analysis} />
              <table className="w-full max-w-xl border-collapse text-sm" data-testid="cx-table">
                <caption className="pq-font-ui pb-1 text-left text-xs uppercase">
                  Time at each size
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">
                      Input size
                    </th>
                    <th scope="col" className="text-right">
                      Time
                    </th>
                    <th scope="col" className="text-right">
                      Memory
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.samples.map((s) => (
                    <tr key={s.n}>
                      <td>{sizeText(s.n)}</td>
                      <td className="text-right">
                        {s.limit ? `over the limit (${msText(s.timeMs)})` : msText(s.timeMs)}
                      </td>
                      <td className="text-right">
                        {s.memoryKb ? `${Math.round(s.memoryKb / 1024)} MB` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {analysis.hint && analysis.hint.maxLoopDepth > 0 ? (
                <p className="m-0 text-sm text-ink-soft">
                  Reading the code: loops nest {analysis.hint.maxLoopDepth} deep
                  {analysis.hint.maxLoopDepth >= 2
                    ? ` (deepest on line ${analysis.hint.deepestLine})`
                    : ""}
                  {analysis.hint.recursion ? " and a function calls itself" : ""}.
                </p>
              ) : null}
              <p className="m-0 text-sm text-ink-soft" data-testid="cx-caveat">
                {analysis.caveat}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
