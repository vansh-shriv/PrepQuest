"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input, Textarea } from "@prepquest/ui";
import { MAX_CUSTOM_TESTS, type CustomTest } from "@prepquest/shared";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

/** Per-user test inputs for a problem (D2). Running them needs the judge, which arrives in Phase 4. */
export function CustomTests({ slug }: { slug: string }) {
  const [items, setItems] = useState<CustomTest[] | null>(null);
  const [label, setLabel] = useState("");
  const [input, setInput] = useState("");

  const load = useCallback(async () => {
    setItems((await api<{ items: CustomTest[] }>(`/problems/${slug}/custom-tests`)).items);
  }, [slug]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const add = useSubmit(async () => {
    await api(`/problems/${slug}/custom-tests`, {
      method: "POST",
      json: { ...(label.trim() ? { label: label.trim() } : {}), input },
    });
    setLabel("");
    setInput("");
    await load();
  });
  const remove = useSubmit(async (id: string) => {
    await api(`/problems/${slug}/custom-tests/${id}`, { method: "DELETE" });
    await load();
  });

  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-ink-soft">
        Save your own inputs here. Running them against your code arrives with the judge in the next
        build phase.
      </p>
      {items === null ? (
        <p className="m-0">Loading...</p>
      ) : items.length === 0 ? (
        <p className="m-0">No custom tests yet.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0" aria-label="Custom tests">
          {items.map((t, i) => (
            <li key={t.id} className="grid gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="pq-font-ui text-sm uppercase">{t.label ?? `Test ${i + 1}`}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${t.label ?? `test ${i + 1}`}`}
                  onClick={() => void remove.run(t.id)}
                >
                  Delete
                </Button>
              </div>
              <pre
                className="m-0 max-h-32 overflow-auto bg-surface-alt p-2 text-sm"
                style={{ fontFamily: "var(--font-code)" }}
              >
                {t.input}
              </pre>
            </li>
          ))}
        </ul>
      )}
      <FormError message={remove.error} />
      {(items?.length ?? 0) < MAX_CUSTOM_TESTS ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add.run();
          }}
        >
          <Input
            label="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
          />
          <Textarea
            label="Input"
            mono
            rows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            helper="Same format as the samples"
          />
          <FormError message={add.error} />
          <div>
            <Button type="submit" size="sm" loading={add.pending} disabled={input.trim() === ""}>
              Save test
            </Button>
          </div>
        </form>
      ) : (
        <p className="m-0">
          You&apos;ve reached the limit of {MAX_CUSTOM_TESTS} custom tests. Delete one to add
          another.
        </p>
      )}
    </div>
  );
}
