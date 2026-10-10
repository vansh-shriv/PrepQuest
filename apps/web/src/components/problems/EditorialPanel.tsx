"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Chip, Dialog, LoadingBar, Tabs } from "@prepquest/ui";
import type {
  EditorialApproachDto,
  EditorialDto,
  EditorialLockedDetails,
  LanguageValue,
  SolveRating,
} from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";
import { formatClock, useSecondsUntil } from "./HintsPanel";
import { Markdown } from "./Markdown";

const LANGUAGE_LABEL: Record<string, string> = { cpp: "C++", java: "Java", python: "Python" };

export const RATINGS: Array<{ value: SolveRating; label: string; hint: string }> = [
  { value: "easy", label: "Easy", hint: "I could do this again without thinking" },
  { value: "good", label: "Good", hint: "Solid, with a little effort" },
  { value: "hard", label: "Hard", hint: "I got there, but it was a struggle" },
  { value: "again", label: "Again", hint: "I need to practise this one more" },
];

/** How did it feel? Feeds spaced repetition later (D6). Only offered once a problem is solved. */
export function RatingButtons({
  slug,
  onRated,
}: {
  slug: string;
  onRated?: (r: SolveRating) => void;
}) {
  const [rated, setRated] = useState<SolveRating | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rate = async (rating: SolveRating) => {
    setError(null);
    try {
      await api(`/problems/${slug}/rating`, { method: "POST", json: { rating } });
      setRated(rating);
      onRated?.(rating);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that.");
    }
  };
  return (
    <div className="grid gap-2" role="group" aria-label="How did this problem feel?">
      <p className="pq-font-ui m-0 text-xs uppercase">How did it feel?</p>
      <div className="flex flex-wrap gap-2">
        {RATINGS.map((r) => (
          <Button
            key={r.value}
            size="sm"
            variant={rated === r.value ? "accent" : "ghost"}
            aria-pressed={rated === r.value}
            title={r.hint}
            onClick={() => void rate(r.value)}
          >
            {r.label}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Approach({ a, index }: { a: EditorialApproachDto; index: number }) {
  const languages = Object.keys(a.code) as LanguageValue[];
  return (
    <section className="pq-card pq-box grid gap-3" aria-label={`Approach ${index + 1}: ${a.name}`}>
      <h3 className="pq-font-ui m-0 text-sm uppercase">
        {index + 1}. {a.name}
      </h3>
      <Markdown>{a.intuition}</Markdown>
      <ol className="m-0 grid gap-1 pl-5">
        {a.steps.map((s, i) => (
          <li key={i}>
            <Markdown>{s}</Markdown>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Chip tone="info">time: {a.time}</Chip>
        <Chip tone="info">space: {a.space}</Chip>
      </div>
      {a.pitfalls && a.pitfalls.length > 0 ? (
        <div>
          <p className="pq-font-ui m-0 mb-1 text-xs uppercase">Common pitfalls</p>
          <ul className="m-0 grid gap-1 pl-5">
            {a.pitfalls.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {languages.length > 0 ? (
        <Tabs
          aria-label={`Code for ${a.name}`}
          items={languages.map((lang) => ({
            id: lang,
            label: LANGUAGE_LABEL[lang] ?? lang,
            content: (
              <pre
                className="m-0 max-h-96 overflow-auto bg-surface-alt p-3 text-sm"
                style={{ fontFamily: "var(--font-code)" }}
                tabIndex={0}
              >
                {a.code[lang]}
              </pre>
            ),
          }))}
        />
      ) : null}
    </section>
  );
}

function Locked({
  details,
  onGiveUp,
  busy,
  error,
}: {
  details: EditorialLockedDetails;
  onGiveUp: () => void;
  busy: boolean;
  error: string | null;
}) {
  const wait = useSecondsUntil(details.giveUpAt ?? undefined);
  const [confirm, setConfirm] = useState(false);
  const ready = details.canGiveUp || (details.giveUpAt !== null && wait === 0);
  return (
    <div className="grid gap-3 p-1" data-testid="editorial-locked">
      <p className="pq-font-pixel m-0 text-2xl">THE EDITORIAL IS LOCKED</p>
      <p className="m-0">Working it out yourself is how it sticks. You can unlock it by:</p>
      <ul className="m-0 grid gap-1 pl-5">
        {details.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="ghost"
          disabled={!ready || busy}
          onClick={() => setConfirm(true)}
        >
          I give up
        </Button>
        {!ready && wait > 0 ? (
          <span className="pq-font-pixel text-lg">Available in {formatClock(wait)}</span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      ) : null}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Give up on this one?"
        tone="sun"
      >
        <p className="mt-0">
          You will see the full solution. It counts like using all three hints, so this problem will
          earn less XP if you solve it afterwards.
        </p>
        <div className="flex gap-3">
          <Button
            onClick={() => {
              setConfirm(false);
              onGiveUp();
            }}
          >
            Show me the editorial
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Keep trying
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error" }
  | { kind: "locked"; details: EditorialLockedDetails }
  | { kind: "open"; editorial: EditorialDto };

/** The editorial (D5): locked until earned; the unlock rules live on the server. */
export function EditorialPanel({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    api<EditorialDto>(`/problems/${slug}/editorial`)
      .then((editorial) => alive && setState({ kind: "open", editorial }))
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) setState({ kind: "none" });
        else if (err instanceof ApiError && err.code === "EDITORIAL_LOCKED") {
          setState({ kind: "locked", details: err.details as EditorialLockedDetails });
        } else setState({ kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const giveUp = async () => {
    setBusy(true);
    setError(null);
    try {
      const editorial = await api<EditorialDto>(`/problems/${slug}/editorial/give-up`, {
        method: "POST",
        json: { confirm: true },
      });
      setState({ kind: "open", editorial });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't unlock the editorial.");
    } finally {
      setBusy(false);
    }
  };

  if (state.kind === "loading") return <LoadingBar label="Loading editorial" />;
  if (state.kind === "none") return <p className="m-0 p-2">This problem has no editorial yet.</p>;
  if (state.kind === "error") return <p className="m-0 p-2">Couldn&apos;t load the editorial.</p>;
  if (state.kind === "locked") {
    return (
      <Locked details={state.details} onGiveUp={() => void giveUp()} busy={busy} error={error} />
    );
  }
  const { editorial } = state;
  return (
    <div className="grid gap-4 p-1" data-testid="editorial-open">
      {editorial.approaches.map((a, i) => (
        <Approach key={a.name} a={a} index={i} />
      ))}
      {editorial.talkTrackMd ? (
        <section className="grid gap-1" aria-label="Interview talk track">
          <h3 className="pq-font-ui m-0 text-sm uppercase">How to say it in an interview</h3>
          <Markdown>{editorial.talkTrackMd}</Markdown>
        </section>
      ) : null}
      {editorial.related.length > 0 ? (
        <section className="grid gap-1" aria-label="Related problems">
          <h3 className="pq-font-ui m-0 text-sm uppercase">Related problems</h3>
          <ul className="m-0 flex flex-wrap gap-3 p-0" style={{ listStyle: "none" }}>
            {editorial.related.map((r) => (
              <li key={r.slug}>
                <Link href={`/problems/${r.slug}`} className="underline">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {editorial.via === "solved" ? <RatingButtons slug={slug} /> : null}
    </div>
  );
}
