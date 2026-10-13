"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, buttonClasses, Chip, LoadingBar, Window } from "@prepquest/ui";
import type { OaAttemptDto, OaCatalogResponse, OaTemplateDto } from "@prepquest/shared";
import { minutesText, negativeText } from "@/features/assess/assess-view";
import { api, ApiError } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

/** Online-assessment simulator (C2): company-style tests with section clocks, and short speed drills. */
export function OaHome() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<OaCatalogResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api<OaCatalogResponse>("/oa")
      .then(setCatalog)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Couldn't reach the server."),
      );
  }, []);

  const start = useSubmit(async (template: string) => {
    const a = await api<OaAttemptDto>("/oa/attempts", { method: "POST", json: { template } });
    router.push(`/tests/${a.id}`);
  });

  if (loadError) return <FormError message={loadError} />;
  if (!catalog) return <LoadingBar label="Loading tests" />;

  const tests = catalog.templates.filter((t) => t.kind === "oa");
  const drills = catalog.templates.filter((t) => t.kind === "drill");

  return (
    <div className="grid max-w-5xl gap-6" data-testid="oa-home">
      <div>
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">Tests and drills</h1>
        <p className="m-0 mt-2">
          Many hiring processes start with an online assessment. Practise the shape of one: every
          section has its own clock, you cannot go back to a finished section, and the timer keeps
          running on our side even if you close the tab. These are practice papers modelled on
          public descriptions, not copies of any company&apos;s test.
        </p>
      </div>

      {catalog.open && (
        <Window title="A test is open" tone="sun">
          <div className="flex flex-wrap items-center gap-3" data-testid="oa-open">
            <span>{catalog.open.title}</span>
            <Link
              href={`/tests/${catalog.open.id}`}
              className={buttonClasses({ variant: "accent" })}
            >
              Resume
            </Link>
          </div>
        </Window>
      )}
      <FormError message={start.error} />

      <section className="grid gap-3" aria-label="Tests">
        <h2 className="m-0 text-base">Full tests</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {tests.map((t) => (
            <TemplateCard
              key={t.slug}
              t={t}
              disabled={Boolean(catalog.open) || start.pending}
              onStart={() => start.run(t.slug)}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-3" aria-label="Speed drills">
        <h2 className="m-0 text-base">Speed drills</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {drills.map((t) => (
            <TemplateCard
              key={t.slug}
              t={t}
              disabled={Boolean(catalog.open) || start.pending}
              onStart={() => start.run(t.slug)}
            />
          ))}
        </div>
      </section>

      {catalog.recent.length > 0 && (
        <Window title="Recent results">
          <ul className="m-0 grid list-none gap-1 p-0" data-testid="oa-recent">
            {catalog.recent.map((r) => (
              <li key={r.id}>
                <Link href={`/tests/${r.id}`} className="underline">
                  {r.title}
                </Link>{" "}
                <span className="text-sm text-ink-soft">
                  {r.percent ?? 0}% · {new Date(r.finishedAt ?? r.startedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </Window>
      )}
    </div>
  );
}

function TemplateCard({
  t,
  disabled,
  onStart,
}: {
  t: OaTemplateDto;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <Window title={t.title} tone="sky">
      <div className="grid gap-2" data-testid="oa-template">
        <p className="m-0 text-sm">{t.description}</p>
        <div className="flex flex-wrap gap-1">
          <Chip>{t.totalQuestions} questions</Chip>
          <Chip>{minutesText(t.totalMinutes)}</Chip>
          {t.calculator && <Chip tone="info">calculator</Chip>}
        </div>
        <ul className="m-0 list-disc pl-5 text-sm">
          {t.sections.map((s) => (
            <li key={s.key}>
              {s.title}: {s.count} in {minutesText(s.minutes)}
            </li>
          ))}
        </ul>
        <span className="text-sm text-ink-soft">{negativeText(t.negativeMarking)}</span>
        {t.attempts > 0 && (
          <span className="text-sm text-ink-soft">
            Taken {t.attempts} time{t.attempts === 1 ? "" : "s"}, best {t.bestPercent ?? 0}%
          </span>
        )}
        <div>
          <Button variant="accent" disabled={disabled} onClick={onStart}>
            Start
          </Button>
        </div>
      </div>
    </Window>
  );
}
