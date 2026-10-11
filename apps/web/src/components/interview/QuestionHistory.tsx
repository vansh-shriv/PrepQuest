"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, LoadingBar, Window } from "@prepquest/ui";
import type { QuestionHistoryItemDto } from "@prepquest/shared";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

/** The questions the interviewer has asked you (X5). You can delete any of them, or all. */
export function QuestionHistory() {
  const [items, setItems] = useState<QuestionHistoryItemDto[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ items: QuestionHistoryItemDto[] }>("/me/question-history");
    setItems(r.items);
  }, []);
  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [load]);

  const remove = useSubmit(async (id: string) => {
    await api(`/me/question-history/${id}`, { method: "DELETE" });
    await load();
  });
  const clear = useSubmit(async () => {
    await api("/me/question-history", { method: "DELETE" });
    await load();
  });

  return (
    <div className="grid max-w-3xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">Question history</h1>
        <Link href="/interview" className="underline">
          Back
        </Link>
      </div>
      <p className="m-0 text-sm text-ink-soft">
        Interviews avoid repeating these and may bring back topics you struggled with. Delete
        anything you don&apos;t want remembered, or turn this off in Settings.
      </p>
      <FormError message={remove.error ?? clear.error} />
      {items === null ? (
        <LoadingBar label="Loading" />
      ) : items.length === 0 ? (
        <p className="m-0">Nothing here yet.</p>
      ) : (
        <Window title={`${items.length} questions`} tone="sky">
          <ul className="m-0 grid list-none gap-3 p-0" data-testid="question-history">
            {items.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  {q.weak && <Chip tone="medium">revisit</Chip>}
                  {q.topic && <Chip>{q.topic}</Chip>}
                  <span>{q.questionText}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Forget: ${q.questionText}`}
                  onClick={() => void remove.run(q.id)}
                >
                  Forget
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Button size="sm" loading={clear.pending} onClick={() => void clear.run()}>
              Clear all
            </Button>
          </div>
        </Window>
      )}
    </div>
  );
}
