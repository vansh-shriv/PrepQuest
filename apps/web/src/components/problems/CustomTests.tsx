"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, Textarea } from "@prepquest/ui";
import { MAX_CUSTOM_TESTS, type CustomTest } from "@prepquest/shared";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

export interface CustomTestsProps {
  slug: string;
  /** Ids of the tests the next Run will include. */
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** Reports the loaded list so the workspace can default new tests to selected. */
  onLoaded?: (items: CustomTest[]) => void;
}

/** Per-user test inputs for a problem (D2). Ticked tests are included when you press Run. */
export function CustomTests({ slug, selected, onSelectedChange, onLoaded }: CustomTestsProps) {
  const [items, setItems] = useState<CustomTest[] | null>(null);
  const [label, setLabel] = useState("");
  const [input, setInput] = useState("");
  // a ref, so a parent passing a new function every render can't retrigger loading
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const load = useCallback(async () => {
    const loaded = (await api<{ items: CustomTest[] }>(`/problems/${slug}/custom-tests`)).items;
    setItems(loaded);
    onLoadedRef.current?.(loaded);
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
        Save your own inputs here. Ticked tests run together with the samples when you press Run,
        and show your program&apos;s output.
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
                <Checkbox
                  label={t.label ?? `Test ${i + 1}`}
                  checked={selected.has(t.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(t.id);
                    else next.delete(t.id);
                    onSelectedChange(next);
                  }}
                />
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
