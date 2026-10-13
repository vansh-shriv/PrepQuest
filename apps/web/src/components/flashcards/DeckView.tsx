"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonClasses, Chip, LoadingBar, Window } from "@prepquest/ui";
import type { CardDto, DeckDetailDto } from "@prepquest/shared";
import { dueText, KIND_LABEL, pluralCards, TYPE_LABEL } from "@/features/flashcards/flashcard-view";
import { api, apiDownload, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";
import { Markdown } from "../problems/Markdown";
import { CardForm } from "./CardForm";

/** One deck: study it, add and edit cards, export it, or delete it. */
export function DeckView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [deck, setDeck] = useState<DeckDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      setDeck(await api<DeckDetailDto>(`/flashcards/decks/${id}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  };

  const download = () =>
    act(async () => {
      const { blob, filename } = await apiDownload(`/flashcards/decks/${id}/export`, {
        method: "GET",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });

  if (error && !deck) return <FormError message={error} />;
  if (!deck) return <LoadingBar label="Loading the deck" />;

  return (
    <div className="grid max-w-4xl gap-6" data-testid="deck">
      <div>
        <Link href="/flashcards" className="text-sm underline">
          All decks
        </Link>
        <h1 className="pq-font-display m-0 flex flex-wrap items-center gap-3 text-lg leading-relaxed">
          {deck.title}
          <Chip>{KIND_LABEL[deck.kind]}</Chip>
        </h1>
        <p className="m-0 mt-1 text-sm text-ink-soft">
          {pluralCards(deck.cards)} · {dueText(deck)}
          {deck.description ? ` · ${deck.description}` : ""}
        </p>
      </div>
      <FormError message={error} />

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/flashcards/study?deck=${deck.id}`}
          className={buttonClasses({ variant: "accent" })}
        >
          Study this deck
        </Link>
        <Link
          href={`/flashcards/study?deck=${deck.id}&cram=1`}
          className={buttonClasses({ variant: "ghost" })}
        >
          Cram
        </Link>
        <Button variant="ghost" onClick={() => void download()}>
          Export
        </Button>
        {confirmDelete ? (
          <>
            <Button
              variant="danger"
              onClick={() =>
                void act(async () => {
                  await api(`/flashcards/decks/${id}`, { method: "DELETE" });
                  router.push("/flashcards");
                })
              }
            >
              Yes, delete the deck
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            Delete deck
          </Button>
        )}
      </div>

      <Window title="Add a card" tone="sky">
        <CardForm deckId={deck.id} onSaved={() => void load()} />
      </Window>

      <Window title={`Cards (${deck.items.length})`}>
        {deck.items.length === 0 ? (
          <p className="m-0" data-testid="cards-empty">
            This deck has no cards yet.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0" data-testid="card-list">
            {deck.items.map((c) => (
              <li
                key={c.id}
                className="grid gap-2 border-b border-dashed pb-3"
                data-testid="card-row"
              >
                {editing === c.id ? (
                  <CardForm
                    deckId={deck.id}
                    card={c}
                    onSaved={() => {
                      setEditing(null);
                      void load();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <CardRow
                    card={c}
                    onEdit={() => setEditing(c.id)}
                    onSuspend={() =>
                      act(() =>
                        api(`/flashcards/cards/${c.id}`, {
                          method: "PATCH",
                          json: { suspended: !c.suspended },
                        }),
                      )
                    }
                    onDelete={() =>
                      act(() => api(`/flashcards/cards/${c.id}`, { method: "DELETE" }))
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Window>
    </div>
  );
}

function CardRow({
  card,
  onEdit,
  onSuspend,
  onDelete,
}: {
  card: CardDto;
  onEdit: () => void;
  onSuspend: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip>{TYPE_LABEL[card.type]}</Chip>
        {card.isNew ? <Chip tone="info">new</Chip> : <Chip>due {card.dueOn}</Chip>}
        {card.suspended && <Chip tone="medium">paused</Chip>}
        {card.lapses > 0 && <Chip tone="hard">forgotten {card.lapses}x</Chip>}
      </div>
      <Markdown>{card.prompt}</Markdown>
      <details>
        <summary className="cursor-pointer text-sm">Show the answer</summary>
        <Markdown>{card.answer}</Markdown>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={onSuspend}>
          {card.suspended ? "Resume" : "Pause"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </>
  );
}
