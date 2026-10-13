"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Chip, LoadingBar, Window } from "@prepquest/ui";
import type { ShareDto } from "@prepquest/shared";
import { ENTITY_LABEL, optionsText, statusText, viewsText } from "@/features/share/share-view";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";

/** The links the learner made: how many times each was opened, and a way to switch each one off. */
export function SharedLinksSection() {
  const [items, setItems] = useState<ShareDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: ShareDto[] }>("/shares")).items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    try {
      await api(`/shares/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  };

  return (
    <Window title="Shared links" tone="sky">
      <div className="grid gap-3" data-testid="shared-links">
        <FormError message={error} />
        {!items ? (
          !error && <LoadingBar label="Loading your links" />
        ) : items.length === 0 ? (
          <p className="m-0" data-testid="shared-links-empty">
            You have not shared anything. Use Share on an interview review, a contest result or your
            readiness.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {items.map((s) => (
              <li key={s.id} className="grid gap-1" data-testid="shared-link">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{s.title}</strong>
                  <Chip>{ENTITY_LABEL[s.entityType]}</Chip>
                  <Chip tone={s.status === "active" ? "easy" : "hard"}>{statusText(s)}</Chip>
                </div>
                <p className="m-0 text-sm text-ink-soft">
                  {viewsText(s.views)} ·{" "}
                  {s.visibility === "public" ? "public link" : "unlisted link"} ·{" "}
                  {optionsText(s.options)}
                </p>
                {s.status === "active" && (
                  <div>
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`Revoke the link for ${s.title}`}
                      onClick={() => void revoke(s.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Window>
  );
}
