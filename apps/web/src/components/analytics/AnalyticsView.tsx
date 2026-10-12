"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  buttonClasses,
  Button,
  Checkbox,
  Chip,
  LoadingBar,
  Select,
  Tabs,
  Window,
} from "@prepquest/ui";
import type {
  CompanyPackDto,
  DiagnosticDto,
  ReadinessDto,
  ReadinessHistoryResponse,
  TimeAnalyticsResponse,
  TopicsResponse,
  TrendsResponse,
} from "@prepquest/shared";
import { isRough, minutesLabel, scoreText } from "@/features/planning/plan-view";
import { api, ApiError } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";
import { Bars, LineChart } from "./charts";

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  return { data, error, reload: load };
}

/** Readiness, topic mastery, interview trends and time analysis (A2 to A5). */
export function AnalyticsView() {
  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Analytics</h1>
      <Tabs
        aria-label="Analytics sections"
        items={[
          { id: "readiness", label: "Readiness", content: <ReadinessPanel /> },
          { id: "topics", label: "Topics", content: <TopicsPanel /> },
          { id: "interviews", label: "Interviews", content: <TrendsPanel /> },
          { id: "time", label: "Time", content: <TimePanel /> },
        ]}
      />
    </div>
  );
}

const pct = (n: number) => Math.round(n * 100);

function ReadinessPanel() {
  const [target, setTarget] = useState("general");
  const [packs, setPacks] = useState<CompanyPackDto[]>([]);
  useEffect(() => {
    api<{ items: CompanyPackDto[] }>("/interview/company-packs")
      .then((r) => setPacks(r.items))
      .catch(() => undefined);
  }, []);
  const { data, error, reload } = useLoad<ReadinessDto>(`/me/readiness?target=${target}`);
  const history = useLoad<ReadinessHistoryResponse>(`/me/readiness/history?target=${target}`);

  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Working out your readiness" />;

  return (
    <div className="grid gap-5" data-testid="readiness">
      <Select
        label="Target"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        helper="Company profiles shift which topics count most. They are practice profiles, not official processes."
      >
        <option value="general">General</option>
        {packs.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.title}
            {p.provisional ? " (unverified)" : ""}
          </option>
        ))}
      </Select>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Window title={data.targetTitle} tone="sky">
          <div className="grid justify-items-center gap-3 text-center">
            <p className="pq-font-display m-0 text-3xl" data-testid="readiness-score">
              {scoreText(data.score, data.band)}
            </p>
            <Chip tone={data.score === null ? "info" : data.score >= 75 ? "easy" : "medium"}>
              {data.label}
            </Chip>
            {isRough(data.band) && data.score !== null && (
              <p className="m-0 text-sm text-ink-soft">
                A rough estimate: there is little evidence yet. The band shrinks as you practise.
              </p>
            )}
            <p className="m-0 text-sm" data-testid="eta">
              {data.eta.message}
            </p>
          </div>
        </Window>
        <div className="grid content-start gap-4">
          {data.needsDiagnostic && <DiagnosticCard onProgress={reload} />}
          <Window title="Score history" tone="olive">
            <LineChart
              ariaLabel="Readiness score over time"
              series={[
                {
                  label: "Readiness",
                  values: (history.data?.items ?? []).map((i) => i.score),
                  color: "var(--leaf)",
                },
              ]}
            />
          </Window>
        </div>
      </div>

      <Window title="What makes up the score" tone="olive">
        <ul className="m-0 grid list-none gap-4 p-0" aria-label="Readiness components">
          {data.components.map((c) => (
            <li key={c.key} className="grid gap-1" data-testid="readiness-component">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <strong>{c.label}</strong>
                <span className="text-sm text-ink-soft">weight {c.weight}%</span>
              </span>
              {c.score === null ? (
                <span className="text-sm text-ink-soft">Not enough data. {c.source}.</span>
              ) : (
                <>
                  <LoadingBar
                    value={c.score}
                    size="sm"
                    label={`${c.label}: ${Math.round(c.score)} out of 100`}
                  />
                  <span className="text-sm text-ink-soft">
                    {Math.round(c.score)}/100 · {pct(c.confidence)}% confident. {c.source}.
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </Window>

      {data.levers.length > 0 && (
        <Window title="Highest-leverage actions" tone="coin">
          <ul className="m-0 grid gap-2 pl-5">
            {data.levers.map((l) => (
              <li key={l.action}>
                {l.action}: about <strong>+{l.gain}</strong> points{" "}
                <span className="text-sm text-ink-soft">(an estimate)</span>
              </li>
            ))}
          </ul>
        </Window>
      )}
      <p className="m-0 text-sm text-ink-soft">{data.note}</p>
    </div>
  );
}

function DiagnosticCard({ onProgress }: { onProgress: () => Promise<void> }) {
  const [d, setD] = useState<DiagnosticDto | null>(null);
  const start = useSubmit(async () => {
    setD(await api<DiagnosticDto>("/me/diagnostic", { method: "POST", json: {} }));
  });
  const refresh = useSubmit(async () => {
    if (!d) return;
    setD(await api<DiagnosticDto>(`/me/diagnostic/${d.id}`));
    await onProgress();
  });
  return (
    <Window title="Calibrate first" tone="blossom">
      <div className="grid gap-3" id="diagnostic" data-testid="diagnostic">
        <p className="m-0">
          There isn&apos;t enough data for an honest score yet. Try these five problems (about 15
          minutes each at most); the results set your starting point.
        </p>
        {!d ? (
          <div>
            <Button
              variant="accent"
              size="sm"
              loading={start.pending}
              onClick={() => void start.run()}
            >
              Start the diagnostic
            </Button>
          </div>
        ) : (
          <>
            <ul className="m-0 grid list-none gap-2 p-0">
              {d.problems.map((p) => (
                <li key={p.slug} className="flex flex-wrap items-center gap-2">
                  <Chip tone={p.difficulty}>{p.difficulty}</Chip>
                  <Link href={`/problems/${p.slug}`} className="underline">
                    {p.title}
                  </Link>
                  <span className="text-sm text-ink-soft">
                    {p.status === "todo" ? "not tried" : p.status}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm">
                {d.answered}/{d.total} tried
              </span>
              <Button
                size="sm"
                variant="ghost"
                loading={refresh.pending}
                onClick={() => void refresh.run()}
              >
                Check my progress
              </Button>
            </div>
          </>
        )}
        <FormError message={start.error ?? refresh.error} />
      </div>
    </Window>
  );
}

function TopicsPanel() {
  const { data, error } = useLoad<TopicsResponse>("/me/analytics/topics");
  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading topics" />;
  return (
    <div className="grid gap-5" data-testid="topics">
      {data.recommendations.length > 0 && (
        <Window title="What to do next, and why" tone="olive">
          <ul className="m-0 grid list-none gap-3 p-0">
            {data.recommendations.map((r) => (
              <li key={r.href + r.title} className="flex flex-wrap items-center gap-3">
                <Link href={r.href} className={buttonClasses({ size: "sm", variant: "accent" })}>
                  Start
                </Link>
                <span className="grid">
                  <strong>{r.title}</strong>
                  <span className="text-sm text-ink-soft">{r.why}</span>
                </span>
              </li>
            ))}
          </ul>
        </Window>
      )}
      <Window title="Topic mastery" tone="sky">
        <ul className="m-0 grid list-none gap-4 p-0" aria-label="Topics">
          {data.topics.map((t) => (
            <li key={t.topic} className="grid gap-1" data-testid="topic-row">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <strong>{t.name}</strong>
                <span className="text-sm text-ink-soft">
                  {t.attempted === 0 ? "not tried" : `${t.solved}/${t.attempted} solved`}
                </span>
              </span>
              <LoadingBar
                value={t.mastery * 100}
                size="sm"
                label={`${t.name}: ${pct(t.mastery)}% mastery`}
              />
              {t.attempted > 0 && (
                <span className="text-xs text-ink-soft">
                  solving {pct(t.signals.solve)}%
                  {t.signals.speed !== null ? ` · speed ${pct(t.signals.speed)}%` : ""}
                  {` · without hints ${pct(t.signals.independence)}%`}
                  {t.signals.interview !== null ? ` · interviews ${pct(t.signals.interview)}%` : ""}
                  {` · ${pct(t.confidence)}% confident`}
                </span>
              )}
              {t.diagnosis && <span className="text-sm">{t.diagnosis}</span>}
            </li>
          ))}
        </ul>
      </Window>
    </div>
  );
}

const TYPES = [
  ["", "All types"],
  ["dsa", "Coding"],
  ["project", "Project"],
  ["resume", "Resume"],
  ["cs", "CS fundamentals"],
  ["behavioral", "Behavioural"],
  ["lld", "Low-level design"],
  ["hld", "System design"],
] as const;

function TrendsPanel() {
  const [type, setType] = useState("");
  const [all, setAll] = useState(false);
  const { data, error } = useLoad<TrendsResponse>(
    `/me/analytics/interviews?${type ? `type=${type}&` : ""}includeAbandoned=${all}`,
  );
  return (
    <div className="grid gap-5" data-testid="trends">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Interview type" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Checkbox
          label="Include interviews ended early"
          helper="By default, interviews under 30% of their time are left out."
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
        />
      </div>
      {error && <FormError message={error} />}
      {!data && !error && <LoadingBar label="Loading trends" />}
      {data && data.points.length === 0 && (
        <p className="m-0">
          No scored interviews yet
          {data.excluded > 0 ? ` (${data.excluded} ended too early to count)` : ""}.{" "}
          <Link href="/interview/new" className="underline">
            Start one
          </Link>
          .
        </p>
      )}
      {data && data.points.length > 0 && (
        <>
          <Window title="Overall score" tone="sky">
            <LineChart
              ariaLabel="Overall interview score over time"
              series={[
                { label: "Score", values: data.points.map((p) => p.overall), color: "var(--sky)" },
                {
                  label: "Moving average",
                  values: data.points.map((p) => p.moving),
                  color: "var(--leaf)",
                },
              ]}
            />
            <p className="mb-0 mt-3 text-sm text-ink-soft">
              {data.points.length} interview{data.points.length === 1 ? "" : "s"}.
              {data.points.some((p) => p.settingsChanged)
                ? " Some points follow a change of interviewer or difficulty, which can explain a dip."
                : ""}
            </p>
          </Window>
          {data.deltas.length > 0 && (
            <div
              className="grid gap-3 sm:grid-cols-3"
              aria-label="Changes over the last five interviews"
            >
              {data.deltas.map((d) => (
                <Window
                  key={d.dimension}
                  title={d.dimension.replace(/_/g, " ")}
                  tone={d.delta >= 0 ? "olive" : "danger"}
                >
                  <span className="pq-font-pixel text-2xl">
                    {d.delta > 0 ? "+" : ""}
                    {d.delta}
                  </span>
                  <span className="block text-sm text-ink-soft">
                    {d.previous} to {d.recent} (out of 5)
                  </span>
                </Window>
              ))}
            </div>
          )}
          {data.habits.length > 0 && (
            <Window title="Habits to work on" tone="danger">
              <ul className="m-0 grid gap-1 pl-5">
                {data.habits.map((h) => (
                  <li key={h.flag}>{h.message}</li>
                ))}
              </ul>
            </Window>
          )}
          {data.speech.length > 1 && (
            <Window title="Speech over time" tone="blossom">
              <LineChart
                ariaLabel="Filler words per minute over time"
                min={0}
                max={Math.max(5, ...data.speech.map((s) => s.fillerPerMin ?? 0))}
                series={[
                  {
                    label: "Fillers per minute",
                    values: data.speech.map((s) => s.fillerPerMin),
                    color: "var(--danger)",
                  },
                ]}
              />
              <p className="mb-0 mt-3 text-sm text-ink-soft">
                Indicators from your transcripts, not a diagnosis.
              </p>
            </Window>
          )}
        </>
      )}
    </div>
  );
}

function TimePanel() {
  const { data, error } = useLoad<TimeAnalyticsResponse>("/me/analytics/time");
  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading time analysis" />;
  const any = data.summaries.some((s) => s.count > 0);
  return (
    <div className="grid gap-5" data-testid="time-analysis">
      {!any && <p className="m-0">Solve a few problems and your pace will show up here.</p>}
      {data.coaching && (
        <p
          role="note"
          className="m-0 border-[3px] border-ink bg-sun px-3 py-2 text-[var(--on-coin)]"
        >
          {data.coaching}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {data.summaries.map((s) => (
          <Window
            key={s.difficulty}
            title={s.difficulty}
            tone={s.difficulty === "easy" ? "olive" : s.difficulty === "medium" ? "sun" : "danger"}
          >
            {s.count === 0 ? (
              <span className="text-sm text-ink-soft">No solves yet.</span>
            ) : (
              <div className="grid gap-2">
                <span>
                  Median <strong>{minutesLabel(Math.round((s.medianSeconds ?? 0) / 60))}</strong>{" "}
                  against {minutesLabel(Math.round(s.expectedSeconds / 60))} expected
                </span>
                <Bars
                  values={s.histogram}
                  labels={["<.5x", ".5x", "1x", "1.5x", "2x", ">2.5x"]}
                  ariaLabel={`${s.difficulty} solve times as a multiple of the expected time`}
                />
                {s.outliers > 0 && (
                  <span className="text-sm text-ink-soft">{s.outliers} unusually slow</span>
                )}
              </div>
            )}
          </Window>
        ))}
      </div>
      {data.phases && (
        <Window title="Where the time goes" tone="sky">
          <p className="mt-0">
            Before the first run: <strong>{pct(data.phases.think)}%</strong>. Run-and-fix loops:{" "}
            <strong>{pct(data.phases.debug)}%</strong> (over {data.phases.solves} solves).
          </p>
        </Window>
      )}
      {data.slowest.length > 0 && (
        <Window title="Slowest solves" tone="olive">
          <ul className="m-0 grid gap-1 pl-5">
            {data.slowest.map((s) => (
              <li key={s.slug}>
                <Link href={`/problems/${s.slug}`} className="underline">
                  {s.title}
                </Link>{" "}
                ({s.difficulty}): {minutesLabel(Math.round(s.seconds / 60))}
              </li>
            ))}
          </ul>
        </Window>
      )}
      <p className="m-0 text-sm text-ink-soft">{data.note}</p>
    </div>
  );
}
