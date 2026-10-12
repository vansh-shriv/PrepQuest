"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, LoadingBar, Window } from "@prepquest/ui";
import type { IdealAnswerDto, SpeechMetricsDto, StarScoreDto } from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

/** The deeper review tabs: ideal answers (E3), STAR scores and speech analytics (E4). */

interface IdealResponse {
  status: "pending" | "running" | "ready" | "failed" | "none";
  items: IdealAnswerDto[];
}

function useExtras<T>(path: string, done: (r: T) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (data === null || done(data)) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [data, done, load]);
  return { data, error, reload: load };
}

const idealDone = (r: IdealResponse) => r.status !== "pending" && r.status !== "running";

export function IdealAnswers({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { data, error, reload } = useExtras<IdealResponse>(
    `/interviews/${sessionId}/ideal-answers`,
    idealDone,
  );
  const retryExtras = useSubmit(async () => {
    await api(`/interviews/${sessionId}/review/retry-extras`, { method: "POST", json: {} });
    await reload();
  });
  const again = useSubmit(async (index: number) => {
    const res = await api<{ session: { id: string } }>(`/interviews/${sessionId}/retry-question`, {
      method: "POST",
      json: { questionIndex: index },
    });
    router.push(`/interview/${res.session.id}`);
  });

  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading" />;
  if (data.status === "pending" || data.status === "running") {
    return <LoadingBar label="Writing ideal answers" />;
  }
  if (data.status === "failed") {
    return (
      <div className="grid gap-3">
        <p className="m-0">We couldn&apos;t write the ideal answers this time.</p>
        <FormError message={retryExtras.error} />
        <div>
          <Button size="sm" loading={retryExtras.pending} onClick={() => void retryExtras.run()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (data.items.length === 0) return <p className="m-0">Nothing to compare yet.</p>;
  return (
    <div className="grid gap-5" data-testid="ideal-answers">
      <FormError message={again.error} />
      {data.items.map((a) => (
        <Window key={a.questionIndex} title={`Question ${a.questionIndex + 1}`} tone="sky">
          <div className="grid gap-3">
            <p className="m-0 font-bold">{a.questionText}</p>
            <div>
              <strong>What you said</strong>
              <p className="m-0">{a.userAnswerSummary}</p>
            </div>
            <div>
              <strong>A strong answer</strong>
              <p className="m-0 whitespace-pre-wrap">{a.idealMd}</p>
            </div>
            {a.gaps.length > 0 && (
              <div>
                <strong>Missing from your answer</strong>
                <ul className="m-0 pl-5">
                  {a.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
            {a.extras.length > 0 && (
              <div>
                <strong>Beyond the reference (nice)</strong>
                <ul className="m-0 pl-5">
                  {a.extras.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
            {a.starRewriteMd && (
              <div>
                <strong>Your story, restructured</strong>
                <p className="m-0 whitespace-pre-wrap">{a.starRewriteMd}</p>
                {a.addedSuggestions.length > 0 && (
                  <p className="m-0 mt-1 text-sm text-ink-soft">
                    Parts in [added suggestion: …] are ideas to fill in only if they are true for
                    you.
                  </p>
                )}
              </div>
            )}
            <div>
              <Button
                size="sm"
                variant="ghost"
                loading={again.pending}
                onClick={() => void again.run(a.questionIndex)}
              >
                Practise this question again
              </Button>
            </div>
          </div>
        </Window>
      ))}
    </div>
  );
}

const pct = (n: number) => Math.round(n * 100);

export function StarScores({ sessionId }: { sessionId: string }) {
  const { data, error } = useExtras<{ items: StarScoreDto[] }>(
    `/interviews/${sessionId}/star`,
    () => true,
  );
  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading" />;
  if (data.items.length === 0) {
    return <p className="m-0">No behavioural stories were scored in this interview.</p>;
  }
  return (
    <div className="grid gap-5" data-testid="star-scores">
      {data.items.map((s, i) => (
        <Window key={s.turnSeq} title={`Story ${i + 1}`} tone="olive">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip
                tone={s.completeness >= 0.75 ? "easy" : s.completeness >= 0.5 ? "medium" : "hard"}
              >
                STAR {pct(s.completeness)}%
              </Chip>
              {s.ownershipRatio !== null && (
                <Chip>&ldquo;I&rdquo; vs &ldquo;we&rdquo;: {pct(s.ownershipRatio)}% I</Chip>
              )}
            </div>
            <div className="grid gap-2">
              <LoadingBar value={s.s * 50} size="sm" label={`Situation: ${s.s} of 2`} />
              <LoadingBar value={s.t * 50} size="sm" label={`Task: ${s.t} of 2`} />
              <LoadingBar value={s.a * 50} size="sm" label={`Action: ${s.a} of 2`} />
              <LoadingBar value={s.r * 50} size="sm" label={`Result: ${s.r} of 2`} />
              <LoadingBar
                value={s.specificity * 50}
                size="sm"
                label={`Specificity: ${s.specificity} of 2`}
              />
              <LoadingBar value={s.impact * 50} size="sm" label={`Impact: ${s.impact} of 2`} />
              <LoadingBar
                value={s.reflection * 50}
                size="sm"
                label={`Reflection: ${s.reflection} of 2`}
              />
            </div>
            {s.justification && <p className="m-0 text-sm text-ink-soft">{s.justification}</p>}
          </div>
        </Window>
      ))}
    </div>
  );
}

export function SpeechPanel({ sessionId }: { sessionId: string }) {
  const { data, error } = useExtras<{ speech: SpeechMetricsDto | null }>(
    `/interviews/${sessionId}/speech`,
    () => true,
  );
  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading" />;
  const sp = data.speech;
  if (!sp) return <p className="m-0">Speech analytics aren&apos;t available for this interview.</p>;
  const fillers = Object.entries(sp.fillerCounts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid gap-4" data-testid="speech-panel">
      <div className="flex flex-wrap gap-2">
        <Chip>{sp.words} words</Chip>
        {sp.wpm !== null && <Chip>{Math.round(sp.wpm)} words/min</Chip>}
        {sp.fillerPerMin !== null && <Chip>{sp.fillerPerMin.toFixed(1)} fillers/min</Chip>}
        <Chip>hedging {pct(sp.hedgingRate)}%</Chip>
        <Chip>{sp.basis === "voice" ? "from your voice answers" : "from your typed answers"}</Chip>
      </div>
      {fillers.length > 0 && (
        <p className="m-0">Filler words: {fillers.map(([w, n]) => `${w} ×${n}`).join(", ")}</p>
      )}
      {sp.longPauses.length > 0 && (
        <p className="m-0">
          Long pauses: {sp.longPauses.length} (
          {sp.longPauses.filter((p) => p.kind === "dead_air").length} with no activity).
        </p>
      )}
      {sp.flags.length > 0 && (
        <ul className="m-0 grid gap-1 pl-5">
          {sp.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <p className="m-0 text-sm text-ink-soft">{sp.note}</p>
    </div>
  );
}
