"use client";

import { useState } from "react";
import { Button, Select, Textarea } from "@prepquest/ui";
import { CARD_TYPES, type CardDto, type CardTypeValue } from "@prepquest/shared";
import { TYPE_LABEL } from "@/features/flashcards/flashcard-view";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

export interface CardFormProps {
  deckId: string;
  /** Edit this card; without it the form adds a new one. */
  card?: CardDto;
  /** Pre-filled text when a card is made from a note or a quiz question. */
  initial?: { front?: string; back?: string; originType?: string; originId?: string };
  onSaved: () => void;
  onCancel?: () => void;
}

/** Add or edit one card. A cloze card hides the parts written as {{c1::like this}}. */
export function CardForm({ deckId, card, initial, onSaved, onCancel }: CardFormProps) {
  const [type, setType] = useState<CardTypeValue>(card?.type ?? "basic");
  const [front, setFront] = useState(card?.front ?? initial?.front ?? "");
  const [back, setBack] = useState(card?.back ?? initial?.back ?? "");

  const save = useSubmit(async () => {
    if (card) {
      await api(`/flashcards/cards/${card.id}`, { method: "PATCH", json: { type, front, back } });
    } else {
      await api(`/flashcards/decks/${deckId}/cards`, {
        method: "POST",
        json: {
          type,
          front,
          back,
          ...(initial?.originType ? { originType: initial.originType } : {}),
          ...(initial?.originId ? { originId: initial.originId } : {}),
        },
      });
      setFront("");
      setBack("");
    }
    onSaved();
  });

  return (
    <form
      className="grid gap-3"
      data-testid="card-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <Select
        label="Card type"
        value={type}
        onChange={(e) => setType(e.target.value as CardTypeValue)}
      >
        {CARD_TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </Select>
      <Textarea
        label={type === "cloze" ? "Text with blanks" : "Front"}
        helper={
          type === "cloze"
            ? "Hide a part like this: {{c1::answer}} or {{c1::answer::hint}}."
            : undefined
        }
        value={front}
        onChange={(e) => setFront(e.target.value)}
        error={save.fields.front ?? save.fields._}
        rows={3}
        maxLength={2000}
      />
      <Textarea
        label={type === "cloze" ? "Extra detail (optional)" : "Back"}
        helper={type === "code" ? "Put code in a fenced block." : "Markdown works here."}
        value={back}
        onChange={(e) => setBack(e.target.value)}
        error={save.fields.back}
        rows={3}
        maxLength={2000}
      />
      <FormError message={save.error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="accent" loading={save.pending}>
          {card ? "Save card" : "Add card"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
