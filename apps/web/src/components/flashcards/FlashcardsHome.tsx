"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClasses, Chip, Input, LoadingBar, Select, Window } from "@prepquest/ui";
import { DECK_KINDS, type DeckKindValue, type FlashcardsResponse } from "@prepquest/shared";
import { dueText, KIND_LABEL, pluralCards } from "@/features/flashcards/flashcard-view";
import { useReviewSync } from "@/features/flashcards/use-review-sync";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";
import { SyncBadge } from "./SyncBadge";

/** Flashcards (X6): your decks, starter decks to copy, import, and the daily limits. */
export function FlashcardsHome() {
  const { user } = useAuth();
  const sync = useReviewSync(user?.id);
  const [data, setData] = useState<FlashcardsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<DeckKindValue>("custom");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<FlashcardsResponse>("/flashcards"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  }, []);
  // reload when answers finish syncing, so the counts follow
  useEffect(() => {
    void load();
  }, [load, sync.synced]);

  const create = useSubmit(async () => {
    await api("/flashcards/decks", { method: "POST", json: { title, kind } });
    setTitle("");
    await load();
  });
  const adopt = useSubmit(async (slug: string) => {
    await api(`/flashcards/starters/${slug}/adopt`, { method: "POST" });
    await load();
  });
  const upload = useSubmit(async (file: File) => {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      throw new ApiError(
        422,
        "VALIDATION_FAILED",
        "That file is not a PrepQuest deck (invalid JSON).",
      );
    }
    await api("/flashcards/import", { method: "POST", json });
    await load();
  });
  const limits = useSubmit(async (newPerDay: number, reviewsPerDay: number) => {
    await api("/flashcards/settings", { method: "PUT", json: { newPerDay, reviewsPerDay } });
    await load();
  });

  if (error && !data) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading your flashcards" />;

  const totalDue = data.decks.reduce((a, d) => a + d.due, 0);
  const totalNew = data.decks.reduce((a, d) => a + d.fresh, 0);

  return (
    <div className="grid max-w-4xl gap-6" data-testid="flashcards">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Flashcards</h1>
      <SyncBadge pending={sync.pending} online={sync.online} />
      <FormError message={error} />

      <Window title="Today" tone="sun">
        <div className="grid gap-3">
          <p className="m-0" data-testid="flash-summary">
            {data.decks.length === 0
              ? "Make a deck or copy a starter deck to begin."
              : totalDue + totalNew === 0
                ? "Nothing to study right now."
                : `${totalDue} to review and ${totalNew} new card${totalNew === 1 ? "" : "s"} waiting.`}{" "}
            {data.doneToday.fresh + data.doneToday.reviews > 0 &&
              `Done today: ${data.doneToday.reviews} reviews, ${data.doneToday.fresh} new.`}
          </p>
          {data.decks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Link href="/flashcards/study" className={buttonClasses({ variant: "accent" })}>
                Study everything due
              </Link>
              <Link href="/flashcards/study?cram=1" className={buttonClasses({ variant: "ghost" })}>
                Cram all decks
              </Link>
            </div>
          )}
        </div>
      </Window>

      <Window title="Your decks" tone="sky">
        {data.decks.length === 0 ? (
          <p className="m-0" data-testid="decks-empty">
            No decks yet.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0" data-testid="deck-list">
            {data.decks.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3">
                <Link href={`/flashcards/${d.id}`} className="font-bold underline">
                  {d.title}
                </Link>
                <Chip>{KIND_LABEL[d.kind]}</Chip>
                <span className="text-sm text-ink-soft">
                  {pluralCards(d.cards)} · {dueText(d)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Window>

      <Window title="New deck">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void create.run();
          }}
        >
          <Input
            label="Deck name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            error={create.fields.title}
          />
          <Select
            label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as DeckKindValue)}
          >
            {DECK_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="accent" loading={create.pending} disabled={!title.trim()}>
            Create deck
          </Button>
        </form>
        <FormError message={create.error} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Deck file"
            data-testid="deck-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload.run(file);
              e.target.value = "";
            }}
          />
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            Import a deck file
          </Button>
          <span className="text-sm text-ink-soft">A .json file exported from PrepQuest.</span>
        </div>
        <FormError message={upload.error} />
      </Window>

      {data.starters.length > 0 && (
        <Window title="Starter decks" tone="olive">
          <ul className="m-0 grid list-none gap-3 p-0" data-testid="starter-list">
            {data.starters.map((s) => (
              <li key={s.slug} className="grid gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <strong>{s.title}</strong>
                  <Chip>{KIND_LABEL[s.kind]}</Chip>
                  <span className="text-sm text-ink-soft">{pluralCards(s.cards)}</span>
                  {s.adoptedAs ? (
                    <Link href={`/flashcards/${s.adoptedAs}`} className="text-sm underline">
                      Open my copy
                    </Link>
                  ) : (
                    <Button
                      size="sm"
                      loading={adopt.pending}
                      aria-label={`Add ${s.title} to my decks`}
                      onClick={() => void adopt.run(s.slug)}
                    >
                      Add to my decks
                    </Button>
                  )}
                </div>
                {s.description && <p className="m-0 text-sm text-ink-soft">{s.description}</p>}
              </li>
            ))}
          </ul>
          <FormError message={adopt.error} />
        </Window>
      )}

      <Window title="Daily limits">
        <LimitsForm
          key={`${data.settings.newPerDay}-${data.settings.reviewsPerDay}`}
          initial={data.settings}
          pending={limits.pending}
          error={limits.error}
          onSave={(n, r) => void limits.run(n, r)}
        />
      </Window>
    </div>
  );
}

function LimitsForm({
  initial,
  pending,
  error,
  onSave,
}: {
  initial: { newPerDay: number; reviewsPerDay: number };
  pending: boolean;
  error: string | null;
  onSave: (newPerDay: number, reviewsPerDay: number) => void;
}) {
  const [n, setN] = useState(String(initial.newPerDay));
  const [r, setR] = useState(String(initial.reviewsPerDay));
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(Number(n), Number(r));
      }}
    >
      <Input
        label="New cards per day"
        type="number"
        min={0}
        max={100}
        value={n}
        onChange={(e) => setN(e.target.value)}
      />
      <Input
        label="Reviews per day"
        type="number"
        min={0}
        max={500}
        value={r}
        onChange={(e) => setR(e.target.value)}
      />
      <Button type="submit" loading={pending}>
        Save limits
      </Button>
      <div className="sm:col-span-3">
        <FormError message={error} />
      </div>
    </form>
  );
}
