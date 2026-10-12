"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonClasses, Chip, LoadingBar, Select, Window } from "@prepquest/ui";
import type { ReviewCardDto, ReviewGradeResponse, ReviewsResponse } from "@prepquest/shared";
import {
  barPercent,
  dueLabel,
  intervalLabel,
  retentionText,
} from "@/features/learning/learning-view";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";

const RATINGS = [
  { id: "again", label: "Again", hint: "I couldn't solve it" },
  { id: "hard", label: "Hard", hint: "Only with a struggle or hints" },
  { id: "good", label: "Good", hint: "Solved it with some thought" },
  { id: "easy", label: "Easy", hint: "Quick and clean" },
] as const;

const DIFFICULTY_TONE = { easy: "easy", medium: "medium", hard: "hard" } as const;

/** Spaced repetition (D6): today's reviews, capped, with the week ahead. */
export function ReviewsView() {
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ReviewGradeResponse | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<ReviewsResponse>("/me/reviews"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  }, []);
  useEffect(() => {
    void load();
    // solving a problem in another tab counts as its review: refresh when this tab is shown again
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  };

  if (error && !data) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading your reviews" />;

  const current = data.due[0] ?? null;
  const max = Math.max(0, ...data.upcoming.map((u) => u.count));

  return (
    <div className="grid max-w-4xl gap-6" data-testid="reviews">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Reviews</h1>
      <FormError message={error} />

      <Window title="Today" tone="sun">
        <div className="grid gap-4">
          <p className="m-0" data-testid="review-summary">
            {data.due.length === 0
              ? data.doneToday > 0
                ? `All done for today: ${data.doneToday} review${data.doneToday === 1 ? "" : "s"} finished.`
                : "Nothing is due today."
              : `${data.due.length} review${data.due.length === 1 ? "" : "s"} to do today (${data.doneToday} of ${data.cap} done).`}
            {data.waiting > 0 && ` ${data.waiting} more are waiting for tomorrow.`}
          </p>

          {current && (
            <div className="grid gap-3" data-testid="review-card">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-lg">{current.problem.title}</strong>
                <Chip tone={DIFFICULTY_TONE[current.problem.difficulty]}>
                  {current.problem.difficulty}
                </Chip>
                <Chip>{dueLabel(current.overdueDays)}</Chip>
                {current.lapses > 0 && <Chip tone="info">forgotten {current.lapses}x</Chip>}
              </div>
              <p className="m-0 text-sm text-ink-soft">
                Solve it again without looking, then rate how it went. A passing submission is
                counted for you.
              </p>
              <div>
                <Link
                  href={`/problems/${current.problem.slug}`}
                  className={buttonClasses({ variant: "accent" })}
                >
                  Open the problem
                </Link>
              </div>
              <div role="group" aria-label="How did it go?" className="flex flex-wrap gap-2">
                {RATINGS.map((r) => (
                  <Button
                    key={r.id}
                    size="sm"
                    variant={r.id === "again" ? "danger" : "primary"}
                    title={r.hint}
                    onClick={() =>
                      act(async () =>
                        setLast(
                          await api<ReviewGradeResponse>(`/me/reviews/${current.id}/grade`, {
                            method: "POST",
                            json: { rating: r.id },
                          }),
                        ),
                      )
                    }
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  label="Not now"
                  defaultValue=""
                  onChange={(e) => {
                    const days = Number(e.target.value);
                    if (days)
                      void act(() =>
                        api(`/me/reviews/${current.id}/snooze`, { method: "POST", json: { days } }),
                      );
                  }}
                >
                  <option value="">Snooze for...</option>
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7">A week</option>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    act(() =>
                      api(`/me/reviews/${current.id}/suspend`, {
                        method: "POST",
                        json: { suspended: true },
                      }),
                    )
                  }
                >
                  Never show again
                </Button>
              </div>
            </div>
          )}

          {last && (
            <p role="status" className="m-0 text-sm" data-testid="review-result">
              {last.lapsed
                ? `No problem. You'll see it again tomorrow (forgotten ${last.lapses}x).`
                : `Remembered. Next review in ${intervalLabel(last.intervalDays)}.`}
            </p>
          )}
        </div>
      </Window>

      {data.due.length > 1 && (
        <Window title="Up next today" tone="sky">
          <ul className="m-0 grid list-none gap-1 p-0" data-testid="review-queue">
            {data.due.slice(1).map((c) => (
              <QueueRow key={c.id} card={c} />
            ))}
          </ul>
        </Window>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Window title="The week ahead" tone="olive">
          <ul
            className="m-0 grid h-32 list-none grid-cols-7 items-end gap-2 p-0"
            aria-label="Reviews due in the next seven days"
          >
            {data.upcoming.map((u) => (
              <li key={u.date} className="grid h-full content-end justify-items-center gap-1">
                <span className="text-xs">{u.count}</span>
                <span
                  className="w-full bg-ink"
                  style={{ height: `${barPercent(u.count, max)}%`, minHeight: u.count ? 4 : 1 }}
                  aria-hidden="true"
                />
                <span className="text-xs text-ink-soft">{u.date.slice(8)}</span>
              </li>
            ))}
          </ul>
        </Window>

        <Window title="Your memory" tone="sky">
          <div className="grid gap-2" data-testid="review-stats">
            <span>
              {data.stats.cards} problem{data.stats.cards === 1 ? "" : "s"} in rotation
            </span>
            <span>{data.stats.mature} well learned (3 weeks or more between reviews)</span>
            <span>Remembered: {retentionText(data.stats.retention)}</span>
            <Select
              label="Reviews per day"
              value={String(data.cap)}
              onChange={(e) =>
                act(() =>
                  api("/me/reviews/settings", {
                    method: "PUT",
                    json: { cap: Number(e.target.value) },
                  }),
                )
              }
              helper="Extra reviews wait for the next day, most overdue first."
            >
              {[3, 5, 8, 10, 15, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </Window>
      </div>

      {data.paused.length > 0 && (
        <Window title="Paused">
          <ul className="m-0 grid list-none gap-2 p-0">
            {data.paused.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3">
                <span>{c.problem.title}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    act(() =>
                      api(`/me/reviews/${c.id}/suspend`, {
                        method: "POST",
                        json: { suspended: false },
                      }),
                    )
                  }
                >
                  Resume
                </Button>
              </li>
            ))}
          </ul>
        </Window>
      )}

      {data.stats.cards === 0 && (
        <p className="m-0" data-testid="review-empty">
          Solve a problem and it joins your review rotation. Reviews come back after a day, then
          three days, then further apart as you remember them.{" "}
          <Link href="/problems" className="underline">
            Find a problem
          </Link>
        </p>
      )}
    </div>
  );
}

function QueueRow({ card }: { card: ReviewCardDto }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Link href={`/problems/${card.problem.slug}`} className="underline">
        {card.problem.title}
      </Link>
      <Chip tone={DIFFICULTY_TONE[card.problem.difficulty]}>{card.problem.difficulty}</Chip>
      <span className="text-sm text-ink-soft">{dueLabel(card.overdueDays)}</span>
    </li>
  );
}
