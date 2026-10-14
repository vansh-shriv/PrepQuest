"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Chip, Textarea, Window } from "@prepquest/ui";
import type { MyIntegrityNotice } from "@prepquest/shared";
import { NOTICE_TEXT, noticeHeadline } from "@/features/integrity/integrity-view";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";

/** Decisions from fair-play reviews that concern this learner, and a way to appeal a confirmed one once. */
export function MyIntegritySection() {
  const [items, setItems] = useState<MyIntegrityNotice[] | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: MyIntegrityNotice[] }>("/me/integrity")).items);
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const appeal = async (id: string) => {
    setError(null);
    try {
      await api(`/me/integrity/${id}/appeal`, { method: "POST", json: { text: text[id] ?? "" } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  };

  // most learners never have one: show nothing rather than an empty box
  if (!items || items.length === 0) return null;

  return (
    <Window title="Fair-play reviews" tone="sun">
      <div className="grid gap-4" data-testid="my-integrity">
        <FormError message={error} />
        {items.map((n) => (
          <div key={n.id} className="grid gap-2" data-testid="integrity-notice">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{noticeHeadline(n)}</strong>
              {n.contest && <Chip>{n.contest.title}</Chip>}
            </div>
            <p className="m-0 text-sm">{NOTICE_TEXT[n.kind]}</p>
            {n.decisionNote && (
              <p className="m-0 text-sm text-ink-soft">Reviewer's note: {n.decisionNote}</p>
            )}
            {n.status === "confirmed" && (
              <p className="m-0 text-sm">
                You are left out of that contest's standings. If this is a mistake you can appeal
                once.
              </p>
            )}
            {n.appealText && (
              <p className="m-0 text-sm text-ink-soft">Your appeal: {n.appealText}</p>
            )}
            {n.canAppeal && (
              <div className="grid gap-2">
                <Textarea
                  label="Your appeal"
                  rows={4}
                  maxLength={1500}
                  value={text[n.id] ?? ""}
                  helper="Say what happened. A person reads it. At least 20 characters."
                  onChange={(e) => setText({ ...text, [n.id]: e.target.value })}
                />
                <div>
                  <Button size="sm" onClick={() => void appeal(n.id)}>
                    Send appeal
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Window>
  );
}
