"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, buttonClasses, Chip, LoadingBar, Select, Window } from "@prepquest/ui";
import type {
  StartTrackResponse,
  TrackCompareResponse,
  TrackDto,
  TracksResponse,
} from "@prepquest/shared";
import { coverageText } from "@/features/learning/learning-view";
import { scoreText } from "@/features/planning/plan-view";
import { api, ApiError } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

/** Company tracks (P4) and the overlap between two of them. */
export function TracksList() {
  const [data, setData] = useState<TracksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [cmp, setCmp] = useState<TrackCompareResponse | null>(null);

  useEffect(() => {
    api<TracksResponse>("/tracks")
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't reach the server."),
      );
  }, []);

  const compare = useSubmit(async () => {
    setCmp(await api<TrackCompareResponse>(`/tracks/compare?a=${a}&b=${b}`));
  });

  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading company tracks" />;

  return (
    <div className="grid max-w-5xl gap-6" data-testid="tracks">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Company tracks</h1>
      <p className="m-0">
        A track shows what a kind of company tends to ask, a problem list shaped around it, and how
        ready you are for it. These are practice profiles built from public patterns, not official
        processes.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.tracks.map((t) => (
          <Window key={t.slug} title={t.title} tone="sky">
            <div className="grid gap-2" data-testid="track-card">
              <span className="text-sm text-ink-soft">
                {t.role} · {t.level}
              </span>
              <span>
                {t.solved} of {t.total} curated problems solved
              </span>
              {t.started && <Chip tone="easy">started</Chip>}
              <div>
                <Link
                  href={`/tracks/${t.slug}`}
                  className={buttonClasses({ variant: "accent", size: "sm" })}
                >
                  Open the track
                </Link>
              </div>
            </div>
          </Window>
        ))}
      </div>

      <Window title="Compare two tracks" tone="olive">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void compare.run();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Preparing for" value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">Choose a track</option>
              {data.tracks.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.title}
                </option>
              ))}
            </Select>
            <Select label="Also applying to" value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">Choose a track</option>
              {data.tracks
                .filter((t) => t.slug !== a)
                .map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.title}
                  </option>
                ))}
            </Select>
          </div>
          <FormError message={compare.error} />
          <div>
            <Button type="submit" loading={compare.pending} disabled={!a || !b || a === b}>
              Compare
            </Button>
          </div>
        </form>
        {cmp && (
          <div className="mt-4 grid gap-2" data-testid="compare-result">
            <strong>
              {coverageText(cmp.coversB)} of {cmp.b.title} is already covered by {cmp.a.title}
            </strong>
            <span>{cmp.shared.length} problems are in both lists.</span>
            {cmp.addForB.length > 0 ? (
              <>
                <span>
                  Add these {cmp.addForB.length} for {cmp.b.title}:
                </span>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {cmp.addForB.map((p) => (
                    <li key={p.slug}>
                      <Link href={`/problems/${p.slug}`} className="underline">
                        {p.title}
                      </Link>{" "}
                      <span className="text-sm text-ink-soft">{p.difficulty}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <span>Nothing left to add: you have covered {cmp.b.title}&apos;s list.</span>
            )}
          </div>
        )}
      </Window>
    </div>
  );
}

/** One track: the process, what is asked most, the curated list, and ways to practise it. */
export function TrackDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [track, setTrack] = useState<TrackDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planMade, setPlanMade] = useState<boolean | null>(null);

  useEffect(() => {
    api<TrackDto>(`/tracks/${slug}`)
      .then(setTrack)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't reach the server."),
      );
  }, [slug]);

  const start = useSubmit(async () => {
    const r = await api<StartTrackResponse>(`/tracks/${slug}/start`, { method: "POST" });
    setTrack(r.track);
    setPlanMade(r.planCreated);
  });

  if (error) return <FormError message={error} />;
  if (!track) return <LoadingBar label="Loading the track" />;

  return (
    <div className="grid max-w-5xl gap-6" data-testid="track">
      <div>
        <Link href="/tracks" className="text-sm underline">
          All tracks
        </Link>
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">{track.title}</h1>
        <p className="m-0 text-sm text-ink-soft">{track.disclaimer}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Window title="Where you stand" tone="sun">
          <div className="grid gap-3">
            <span className="pq-font-display text-2xl" data-testid="track-readiness">
              {scoreText(track.readiness.score, track.readiness.band)}
            </span>
            <Chip>{track.readiness.label}</Chip>
            <span>
              {track.solved} of {track.total} curated problems solved
            </span>
            <FormError message={start.error} />
            {track.started ? (
              <p role="status" className="m-0 text-sm" data-testid="track-started">
                {planMade === false
                  ? "Track started. We couldn't build the plan just now: open the plan page to try again."
                  : "Track started. Your study plan now aims at this company."}
              </p>
            ) : (
              <div>
                <Button variant="accent" loading={start.pending} onClick={() => start.run()}>
                  Start this track
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Link href={track.planHref} className={buttonClasses({ size: "sm" })}>
                Plan around it
              </Link>
              <Link
                href={track.interview.href}
                className={buttonClasses({ size: "sm", variant: "ghost" })}
              >
                Practise the interview
              </Link>
            </div>
          </div>
        </Window>

        <Window title="The process" tone="sky">
          <ol className="m-0 grid list-none gap-2 p-0" data-testid="track-process">
            {track.process.map((r) => (
              <li key={r.round} className="flex flex-wrap items-center gap-2">
                <strong>{r.round}</strong>
                <span className="text-sm text-ink-soft">
                  {[r.type, r.format].filter(Boolean).join(", ")} · {r.minutes} min
                </span>
              </li>
            ))}
          </ol>
          <p className="mb-0 mt-3 text-sm">{track.interviewStyle.notes}</p>
        </Window>
      </div>

      <Window title="What gets asked most" tone="olive">
        <ul className="m-0 grid list-none gap-2 p-0" data-testid="track-heatmap">
          {track.heatmap.map((h) => (
            <li key={h.topic} className="grid grid-cols-[140px_1fr] items-center gap-3">
              <span>{h.name}</span>
              <span
                className="block h-3 bg-ink"
                style={{ width: `${h.heat * 20}%` }}
                role="img"
                aria-label={`Heat ${h.heat} of 5`}
              />
            </li>
          ))}
        </ul>
      </Window>

      <Window title="Curated problems">
        <ul className="m-0 grid list-none gap-1 p-0" data-testid="track-problems">
          {track.problems.map((p) => (
            <li key={p.slug} className="flex flex-wrap items-center gap-2">
              <Chip tone={p.solved ? "easy" : undefined}>{p.solved ? "solved" : p.difficulty}</Chip>
              <Link href={`/problems/${p.slug}`} className="underline">
                {p.title}
              </Link>
              <span className="text-sm text-ink-soft">{p.topics.join(", ")}</span>
            </li>
          ))}
        </ul>
      </Window>

      <div className="grid gap-6 md:grid-cols-2">
        <Window title="Checklist">
          <ul className="m-0 grid list-disc gap-1 pl-5">
            {track.checklist.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Window>
        <Window title="Common pitfalls">
          <ul className="m-0 grid list-disc gap-1 pl-5">
            {track.pitfalls.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Window>
      </div>
    </div>
  );
}
