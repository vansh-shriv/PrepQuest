"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, LoadingBar, Window } from "@prepquest/ui";
import type { DesignCanvasFull, DesignCanvasListItem, DesignPromptItem } from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";

const LEVEL = ["", "Easier", "Medium", "Harder"];
const LEVEL_TONE = ["neutral", "easy", "medium", "hard"] as const;

/** `/design`: the practice prompts and the designs the learner has started. */
export function DesignHome() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<DesignPromptItem[] | null>(null);
  const [mine, setMine] = useState<DesignCanvasListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([
        api<{ items: DesignPromptItem[] }>("/design/prompts"),
        api<{ items: DesignCanvasListItem[] }>("/design/canvases"),
      ]);
      setPrompts(p.items);
      setMine(m.items);
    } catch {
      setError("Couldn't reach the server.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const start = async (slug: string) => {
    setError(null);
    try {
      const c = await api<DesignCanvasFull>("/design/canvases", {
        method: "POST",
        json: { promptSlug: slug },
      });
      router.push(`/system-design/${c.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the design.");
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/design/canvases/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete it.");
    }
  };

  return (
    <div className="grid max-w-5xl gap-6" data-testid="design-home">
      <div>
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">System design</h1>
        <p className="m-0 mt-1 text-sm text-ink-soft">
          Draw the architecture, write down the requirements and numbers, then get a review that
          reads your drawing. A reference answer opens after your own attempt has been reviewed.
        </p>
      </div>
      <FormError message={error} />

      <section className="grid gap-3" aria-labelledby="dp-h">
        <h2 id="dp-h" className="pq-font-ui m-0 text-sm uppercase">
          Problems
        </h2>
        {!prompts ? (
          !error && <LoadingBar label="Loading problems" />
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2" data-testid="design-prompts">
            {prompts.map((p) => (
              <li key={p.slug}>
                <Window title={p.title}>
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={LEVEL_TONE[p.difficulty] ?? "neutral"}>
                        {LEVEL[p.difficulty]}
                      </Chip>
                      {p.tags.map((t) => (
                        <Chip key={t}>{t}</Chip>
                      ))}
                    </div>
                    <div>
                      <Button size="sm" onClick={() => void start(p.slug)}>
                        {p.started ? "Start another attempt" : "Start"}
                        <span className="sr-only"> {p.title}</span>
                      </Button>
                    </div>
                  </div>
                </Window>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3" aria-labelledby="dm-h">
        <h2 id="dm-h" className="pq-font-ui m-0 text-sm uppercase">
          Your designs
        </h2>
        {mine && mine.length === 0 ? (
          <p className="m-0" data-testid="design-empty">
            You have not started one yet.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0" data-testid="design-list">
            {mine?.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-3"
                data-testid="design-item"
              >
                <Link href={`/system-design/${m.id}`} className="underline">
                  {m.prompt.title}
                </Link>
                <span className="text-sm text-ink-soft">
                  {m.components} component{m.components === 1 ? "" : "s"} · saved{" "}
                  {new Date(m.updatedAt).toLocaleString()}
                </span>
                {m.reviewed && <Chip tone="easy">Reviewed</Chip>}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void remove(m.id)}
                  aria-label={`Delete ${m.prompt.title}`}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
