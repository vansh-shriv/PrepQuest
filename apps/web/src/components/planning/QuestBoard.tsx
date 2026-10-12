"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClasses, Chip, LoadingBar, Sprite, Window } from "@prepquest/ui";
import type { QuestBoardResponse } from "@prepquest/shared";
import { minutesLabel, scoreText } from "@/features/planning/plan-view";
import { api } from "@/lib/api";

/** Today's quest board (A1, P2): goals, today's planned tasks, readiness and the one next step. */
export function QuestBoard() {
  const [q, setQ] = useState<QuestBoardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api<QuestBoardResponse>("/me/quest-board")
      .then((r) => alive && setQ(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return null;
  if (!q) return <LoadingBar label="Loading today's quests" />;
  const { goals } = q;

  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="quest-board">
      <Window title="Today's quests" tone="sun">
        <div className="grid gap-3">
          <ul className="m-0 grid list-none gap-3 p-0" aria-label="Daily goals">
            {goals.items.map((g) => (
              <li key={g.type} className="grid gap-1" data-done={g.done}>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>{g.label}</span>
                  <span className="pq-font-pixel text-xl">
                    {Math.min(g.progress, g.target)}/{g.target}
                  </span>
                </span>
                <LoadingBar
                  value={(Math.min(g.progress, g.target) / g.target) * 100}
                  size="sm"
                  label={`${g.label}: ${g.progress} of ${g.target}`}
                />
              </li>
            ))}
          </ul>
          {goals.completed && (
            <p role="status" className="m-0 flex items-center gap-2" data-testid="goals-complete">
              <Sprite name="coin" scale={2} animate label="Coin" />
              All goals done{goals.rewardXp > 0 ? `: +${goals.rewardXp} XP` : ""}. Nice work.
            </p>
          )}
          {goals.suggestion && (
            <p className="m-0 text-sm text-ink-soft" data-testid="goal-suggestion">
              {goals.suggestion.message}{" "}
              <Link href="/plan" className="underline">
                Change your goal
              </Link>
            </p>
          )}
          {q.hasPlan ? (
            <div className="grid gap-2">
              <strong>On today&apos;s plan</strong>
              {q.tasks.length === 0 ? (
                <p className="m-0 text-ink-soft">Nothing planned for today.</p>
              ) : (
                <ul className="m-0 grid list-none gap-1 p-0">
                  {q.tasks.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-2">
                      <Chip tone={t.status === "done" ? "easy" : undefined}>
                        {t.status === "done" ? "done" : minutesLabel(t.estMinutes)}
                      </Chip>
                      {t.href && t.status !== "done" ? (
                        <Link href={t.href} className="underline">
                          {t.title}
                        </Link>
                      ) : (
                        <span className={t.status === "done" ? "line-through opacity-70" : ""}>
                          {t.title}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/plan" className="text-sm underline">
                Open the full plan
              </Link>
            </div>
          ) : (
            <p className="m-0 text-sm">
              You don&apos;t have a study plan yet.{" "}
              <Link href="/plan" className="underline">
                Build one
              </Link>
              .
            </p>
          )}
        </div>
      </Window>

      <div className="grid content-start gap-6">
        <Window title="Readiness" tone="sky">
          <div className="grid gap-2" data-testid="readiness-card">
            <span className="pq-font-display text-2xl" data-testid="readiness-score">
              {scoreText(q.readiness.score, q.readiness.band)}
            </span>
            <Chip>{q.readiness.label}</Chip>
            <Link href="/analytics" className="text-sm underline">
              {q.readiness.needsDiagnostic
                ? "Take the diagnostic to get a score"
                : "See the breakdown"}
            </Link>
          </div>
        </Window>
        {q.next && (
          <Window title="Do this next" tone="olive">
            <div className="grid gap-2" data-testid="next-action">
              <strong>{q.next.title}</strong>
              <span className="text-sm text-ink-soft">{q.next.why}</span>
              <div>
                <Link
                  href={q.next.href}
                  className={buttonClasses({ size: "sm", variant: "accent" })}
                >
                  Start
                </Link>
              </div>
            </div>
          </Window>
        )}
      </div>
    </div>
  );
}
