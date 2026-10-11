"use client";

import { useEffect, useMemo, useState } from "react";
import { Chip, LoadingBar } from "@prepquest/ui";
import { clock } from "@/features/interview/format";
import { buildReplay, frameAt, lineChange, type RawEvent } from "@/features/interview/replay";
import { api } from "@/lib/api";

/** Scrub through how the code evolved during the interview, with runs, pastes and tab changes marked. */
export function CodeReplay({ sessionId, durationMs }: { sessionId: string; durationMs: number }) {
  const [events, setEvents] = useState<RawEvent[] | null>(null);
  // null means "the end": the final code is shown first and the user scrubs back from there
  const [chosen, setAt] = useState<number | null>(null);

  useEffect(() => {
    api<{ items: RawEvent[] }>(`/interviews/${sessionId}/events`)
      .then((r) => setEvents(r.items))
      .catch(() => setEvents([]));
  }, [sessionId]);

  const frames = useMemo(() => buildReplay(events ?? []), [events]);
  const last = frames.at(-1)?.offsetMs ?? 0;
  const span = Math.max(durationMs, last, 1);
  const at = Math.min(chosen ?? span, span);
  const index = frameAt(frames, at);
  const frame = index >= 0 ? frames[index] : null;
  const prev = index > 0 ? frames[index - 1] : null;
  const change = frame && prev ? lineChange(prev.code, frame.code) : null;

  if (events === null) return <LoadingBar label="Loading the replay" />;
  if (frames.length === 0) return <p className="m-0">No code was recorded in this interview.</p>;

  const markers = frames.filter((f) => f.marker);

  return (
    <div className="grid gap-4" data-testid="code-replay">
      <div className="grid gap-2">
        <label className="pq-label" htmlFor="replay-scrub">
          Time: <span data-testid="replay-time">{clock(at)}</span> of {clock(span)}
        </label>
        <input
          id="replay-scrub"
          type="range"
          min={0}
          max={span}
          step={1000}
          value={Math.min(at, span)}
          onChange={(e) => setAt(Number(e.target.value))}
          aria-valuetext={`${clock(at)}${frame?.marker ? `, ${frame.marker.label}` : ""}`}
          className="w-full"
        />
        <div className="relative h-4" aria-hidden="true">
          {markers.map((m, i) => (
            <span
              key={i}
              title={`${clock(m.offsetMs)} ${m.marker?.label ?? ""}`}
              className="absolute top-0 h-4 w-[6px] border-2 border-ink"
              style={{
                left: `${(m.offsetMs / span) * 100}%`,
                background:
                  m.marker?.kind === "submit" || m.marker?.kind === "run"
                    ? m.marker.verdict === "AC"
                      ? "var(--leaf)"
                      : "var(--sun)"
                    : "var(--danger)",
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        {frame ? (
          <>
            <span>Version from {clock(frame.offsetMs)}</span>
            {frame.language && <Chip>{frame.language}</Chip>}
            {change && (
              <span>
                +{change.added} / -{change.removed} lines
              </span>
            )}
            {frame.marker && (
              <Chip
                tone={
                  frame.marker.verdict === "AC"
                    ? "easy"
                    : frame.marker.kind === "paste" || frame.marker.kind === "focus_lost"
                      ? "hard"
                      : "medium"
                }
              >
                {frame.marker.label}
              </Chip>
            )}
          </>
        ) : (
          <span>Nothing written yet at this point.</span>
        )}
      </div>

      <pre
        className="pq-box m-0 max-h-[420px] overflow-auto whitespace-pre-wrap bg-surface p-3 text-sm"
        style={{ fontFamily: "var(--font-code)" }}
        data-testid="replay-code"
        aria-label="Code at the selected moment"
      >
        {frame?.code ?? ""}
      </pre>

      <ol className="m-0 grid list-none gap-1 p-0" aria-label="Moments">
        {markers.map((m, i) => (
          <li key={i}>
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-left underline"
              onClick={() => setAt(m.offsetMs)}
            >
              {clock(m.offsetMs)} {m.marker?.label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
