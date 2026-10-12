"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonClasses, Chip, LoadingBar, Window } from "@prepquest/ui";
import type { RoadmapDto, RoadmapNodeDto, RoadmapsResponse } from "@prepquest/shared";
import { byLayer, masteryText, NODE_STATE_LABELS } from "@/features/learning/learning-view";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";

const STATE_TONE = {
  locked: undefined,
  open: "info",
  cleared: "medium",
  mastered: "easy",
} as const;

/** The roadmaps (P3) the learner can follow. */
export function RoadmapsList() {
  const [data, setData] = useState<RoadmapsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<RoadmapsResponse>("/roadmaps")
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't reach the server."),
      );
  }, []);
  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading roadmaps" />;
  return (
    <div className="grid max-w-4xl gap-6" data-testid="roadmaps">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Roadmaps</h1>
      <p className="m-0">
        Each roadmap is a map of topics. A topic unlocks the ones after it once you show you know
        it, so you always know what to learn next.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.roadmaps.map((r) => (
          <Window key={r.slug} title={r.title} tone="sky">
            <div className="grid gap-3" data-testid="roadmap-card">
              <p className="m-0 text-sm">{r.description}</p>
              <span>
                {r.cleared} of {r.nodes} topics cleared
                {r.mastered > 0 ? `, ${r.mastered} mastered` : ""}
              </span>
              {r.nextNode && (
                <span className="text-sm text-ink-soft">Next: {r.nextNode.title}</span>
              )}
              <div>
                <Link
                  href={`/roadmaps/${r.slug}`}
                  className={buttonClasses({ variant: "accent", size: "sm" })}
                >
                  Open the map
                </Link>
              </div>
            </div>
          </Window>
        ))}
      </div>
    </div>
  );
}

/** One roadmap as layers of topics, with the chosen topic's detail beside it. */
export function RoadmapMap() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<RoadmapDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api<RoadmapDto>(`/roadmaps/${slug}`)
      .then((r) => {
        setData(r);
        setSelected((s) => s ?? r.nextNode ?? r.nodes[0]?.id ?? null);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't reach the server."),
      );
  }, [slug]);

  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading the map" />;
  const node = data.nodes.find((n) => n.id === selected) ?? null;

  return (
    <div className="grid max-w-5xl gap-6" data-testid="roadmap-map">
      <div>
        <Link href="/roadmaps" className="text-sm underline">
          All roadmaps
        </Link>
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">{data.title}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <ol className="m-0 grid list-none gap-6 p-0" aria-label="Topics by level">
          {byLayer(data.nodes).map((layer, i) => (
            <li key={i} className="grid gap-2">
              <span className="text-xs uppercase tracking-wide text-ink-soft">Level {i + 1}</span>
              <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
                {layer.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`pq-box pq-lift grid gap-1 bg-surface p-3 text-left text-ink ${
                        n.state === "locked" ? "opacity-60" : ""
                      }`}
                      aria-pressed={selected === n.id}
                      data-testid="roadmap-node"
                      data-node={n.id}
                      data-state={n.state}
                      onClick={() => setSelected(n.id)}
                    >
                      <strong>{n.title}</strong>
                      <Chip tone={STATE_TONE[n.state]}>
                        {n.id === data.nextNode ? "Next up" : NODE_STATE_LABELS[n.state]}
                      </Chip>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        {node && <NodeDetail node={node} />}
      </div>
    </div>
  );
}

function NodeDetail({ node }: { node: RoadmapNodeDto }) {
  return (
    <Window title={node.title} tone="sun">
      <div className="grid gap-3" data-testid="node-detail">
        <Chip tone={STATE_TONE[node.state]}>{NODE_STATE_LABELS[node.state]}</Chip>
        <p className="m-0">{node.summary}</p>
        <span className="text-sm">
          {node.measure.label}: {masteryText(node.mastery)}{" "}
          <span className="text-ink-soft">
            (clears at {Math.round(node.unlockThreshold * 100)}%, mastered at{" "}
            {Math.round(node.masterThreshold * 100)}%)
          </span>
        </span>
        {node.state === "locked" && (
          <p className="m-0 text-sm" data-testid="node-blocked">
            Locked until you clear: {node.blockedBy.join(", ")}.
          </p>
        )}
        {node.ladder.length > 0 && (
          <div className="grid gap-1">
            <strong>Problem ladder</strong>
            <ol className="m-0 grid list-none gap-1 p-0">
              {node.ladder.map((p) => (
                <li key={p.slug} className="flex flex-wrap items-center gap-2">
                  <Chip tone={p.solved ? "easy" : undefined}>
                    {p.solved ? "solved" : p.difficulty}
                  </Chip>
                  <Link href={`/problems/${p.slug}`} className="underline">
                    {p.title}
                  </Link>
                  {p.checkpoint && <Chip tone="info">checkpoint</Chip>}
                </li>
              ))}
            </ol>
          </div>
        )}
        {node.quiz && (
          <Link href={node.quiz.href} className={buttonClasses({ size: "sm" })}>
            Take the {node.quiz.subject.toUpperCase()} quiz
          </Link>
        )}
        {node.resources.length > 0 && (
          <ul className="m-0 grid list-none gap-1 p-0">
            {node.resources.map((r) => (
              <li key={r.title}>
                {r.title}
                {r.note ? <span className="text-sm text-ink-soft"> - {r.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Window>
  );
}
