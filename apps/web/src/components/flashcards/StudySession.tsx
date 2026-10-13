"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClasses, Chip, LoadingBar, Window } from "@prepquest/ui";
import type { CardDto, StudyResponse } from "@prepquest/shared";
import {
  newClientId,
  RATINGS,
  ratingForKey,
  summaryText,
  pluralCards,
} from "@/features/flashcards/flashcard-view";
import { cacheStudy, loadCachedStudy, withoutAnswered } from "@/features/flashcards/offline";
import { browserStore, useReviewSync } from "@/features/flashcards/use-review-sync";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { FormError } from "../auth/AuthCard";
import { Markdown } from "../problems/Markdown";
import { SyncBadge } from "./SyncBadge";

/**
 * A study session. The day's cards are kept on this device when they load, so the session carries on if the
 * connection drops; each answer is saved on the device first and synced when the browser is online. Cram
 * mode never changes a schedule.
 */
export function StudySession() {
  const { user } = useAuth();
  const params = useSearchParams();
  const deckId = params.get("deck") ?? undefined;
  const cram = params.get("cram") === "1";
  const scope = `${deckId ?? "all"}`;
  const sync = useReviewSync(user?.id);
  const [queue, setQueue] = useState<CardDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromDevice, setFromDevice] = useState(false);
  const answering = useRef(false);

  // load once per learner: online from the server, otherwise the set kept on this device
  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const qs = new URLSearchParams();
      if (deckId) qs.set("deckId", deckId);
      if (cram) qs.set("cram", "true");
      try {
        const study = await api<StudyResponse>(`/flashcards/study?${qs}`);
        if (!alive) return;
        if (!cram) cacheStudy(browserStore, user.id, scope, study);
        setQueue(study.cards);
        setTotal(study.cards.length);
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError) {
          setError(err.message);
          return;
        }
        // no connection: use the saved set, minus what was answered since
        const saved = cram ? null : loadCachedStudy(browserStore, user.id, scope);
        if (!saved) {
          setError(
            "You are offline and there is no saved set for this deck yet. Open it once while online.",
          );
          return;
        }
        const left = withoutAnswered(saved, sync.queue?.list().map((r) => r.cardId) ?? []);
        setFromDevice(true);
        setQueue(left.cards);
        setTotal(left.cards.length);
      }
    })();
    return () => {
      alive = false;
    };
    // sync.queue is stable per learner
  }, [user?.id, deckId, cram, scope]);

  const current = queue?.[0] ?? null;

  const rate = useCallback(
    (quality: number) => {
      if (!current || !user || answering.current) return;
      answering.current = true;
      if (!cram) {
        sync.record({
          clientId: newClientId(),
          cardId: current.id,
          quality,
          reviewedAt: new Date().toISOString(),
        });
        // keep the saved set in step, so a reload offline does not show this card again
        const saved = loadCachedStudy(browserStore, user.id, scope);
        if (saved) cacheStudy(browserStore, user.id, scope, withoutAnswered(saved, [current.id]));
      }
      setQueue((q) => (q ? q.slice(1) : q));
      setDone((n) => n + 1);
      setFlipped(false);
      answering.current = false;
    },
    [current, user, cram, scope, sync],
  );

  // keyboard: space flips, 1-4 answers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " && !flipped && current && el?.tagName !== "BUTTON") {
        e.preventDefault();
        setFlipped(true);
        return;
      }
      const r = flipped ? ratingForKey(e.key) : null;
      if (r) rate(r.quality);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, current, rate]);

  if (error && !queue) {
    return (
      <div className="grid max-w-3xl gap-4">
        <FormError message={error} />
        <Link href="/flashcards" className={buttonClasses({ variant: "ghost" })}>
          Back to flashcards
        </Link>
      </div>
    );
  }
  if (!queue) return <LoadingBar label="Getting your cards" />;

  return (
    <div className="grid max-w-3xl gap-4" data-testid="study">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">{cram ? "Cram" : "Study"}</h1>
        {cram && <Chip tone="medium">no scheduling</Chip>}
        {fromDevice && <Chip tone="info">saved on this device</Chip>}
        <span className="text-sm text-ink-soft" data-testid="study-progress">
          {done} of {total}
        </span>
      </div>
      <SyncBadge pending={sync.pending} online={sync.online} />

      {current ? (
        <Window title={current.isNew ? "New card" : "Review"} tone="sun">
          <div className="grid gap-4" data-testid="study-card">
            <div data-testid="study-prompt">
              <Markdown>{current.prompt}</Markdown>
            </div>
            {flipped ? (
              <>
                <div className="border-t border-dashed pt-3" data-testid="study-answer">
                  <Markdown>{current.answer}</Markdown>
                </div>
                <div
                  role="group"
                  aria-label="How well did you remember?"
                  className="flex flex-wrap gap-2"
                >
                  {RATINGS.map((r) => (
                    <Button
                      key={r.id}
                      variant={r.id === "again" ? "danger" : "primary"}
                      title={`${r.hint} (key ${r.key})`}
                      onClick={() => rate(r.quality)}
                    >
                      {r.label}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <div>
                <Button variant="accent" onClick={() => setFlipped(true)}>
                  Show the answer
                </Button>
                <span className="ml-3 text-sm text-ink-soft">or press the space bar</span>
              </div>
            )}
          </div>
        </Window>
      ) : (
        <Window title="Finished" tone="olive">
          <div className="grid gap-3" data-testid="study-done">
            <p className="m-0">{summaryText(done, cram)}</p>
            {done > 0 && !cram && (
              <p className="m-0 text-sm text-ink-soft">
                {pluralCards(done)} scheduled. Come back when more are due.
              </p>
            )}
            <div>
              <Link href="/flashcards" className={buttonClasses({ variant: "accent" })}>
                Back to flashcards
              </Link>
            </div>
          </div>
        </Window>
      )}
    </div>
  );
}
