"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Chip,
  LoadingBar,
  RadarScore,
  ScoreBar,
  Sprite,
  Tabs,
  Window,
  buttonClasses,
} from "@prepquest/ui";
import type { AnnotationDto, InterviewReviewDto } from "@prepquest/shared";
import {
  BAND_TONE,
  END_REASON_TEXT,
  PERSONA_LABEL,
  actionHref,
  clock,
} from "@/features/interview/format";
import { api, apiDownload, ApiError } from "@/lib/api";
import { ShareButton } from "../share/ShareDialog";
import { CodeReplay } from "./CodeReplay";
import { DrawingReview } from "./DrawingReview";
import { IdealAnswers, SpeechPanel, StarScores } from "./ReviewExtras";
import { useSubmit } from "@/lib/use-submit";

const KIND_LABEL: Record<AnnotationDto["kind"], string> = {
  positive: "Good",
  improve: "Improve",
  missed: "Missed chance",
  red_flag: "Red flag",
};
const KIND_TONE = {
  positive: "easy",
  improve: "medium",
  missed: "info",
  red_flag: "hard",
} as const;

/** The scorecard (E1, E5) and the annotated transcript (E2) of a finished interview. */
export function ReviewView({ id }: { id: string }) {
  const [review, setReview] = useState<InterviewReviewDto | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setReview(await api<InterviewReviewDto>(`/interviews/${id}/review`));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { status: err.status, message: err.message }
          : { status: 0, message: "Couldn't reach the server." },
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // generation takes a few seconds: look again until it is done
  useEffect(() => {
    if (review?.status !== "generating") return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [review?.status, load]);

  if (error) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <Sprite name="dino" scale={6} label="Dino" />
        <p className="m-0">
          {error.status === 409
            ? "This interview is still running."
            : error.status === 404
              ? "This interview doesn't exist."
              : error.message}
        </p>
        <Link href={error.status === 409 ? `/interview/${id}` : "/interview"} className="underline">
          {error.status === 409 ? "Back to the interview" : "Back to interviews"}
        </Link>
      </div>
    );
  }
  if (!review) {
    return (
      <div className="mx-auto max-w-xs py-24">
        <LoadingBar label="Loading review" />
      </div>
    );
  }
  return <Loaded review={review} onChanged={load} />;
}

function Loaded({
  review,
  onChanged,
}: {
  review: InterviewReviewDto;
  onChanged: () => Promise<void>;
}) {
  const { session, scorecard } = review;
  const retry = useSubmit(async () => {
    await api(`/interviews/${session.id}/review/retry`, { method: "POST", json: {} });
    await onChanged();
  });
  const exportMd = useSubmit(async () => {
    const { blob, filename } = await apiDownload(`/interviews/${session.id}/transcript?format=md`, {
      method: "GET",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });

  return (
    <div className="grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="pq-font-display m-0 text-lg leading-relaxed">{session.title}: review</h1>
          <p className="m-0 text-sm text-ink-soft">
            {PERSONA_LABEL[session.persona]} · difficulty {session.difficulty}/5 · {session.minutes}{" "}
            min · {END_REASON_TEXT[session.endReason ?? ""] ?? "Finished"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            loading={exportMd.pending}
            onClick={() => void exportMd.run()}
          >
            Export transcript
          </Button>
          {scorecard && <ShareButton entityType="scorecard" refId={session.id} />}
          <Link href="/interview/new" className={buttonClasses({ size: "sm", variant: "accent" })}>
            Another interview
          </Link>
        </div>
      </div>

      {review.status === "generating" && (
        <Window title="Scoring" tone="sun" data-testid="review-generating">
          <LoadingBar label="Reading your transcript" />
          <p className="mb-0 mt-3 text-sm">
            This takes about half a minute. You can leave; we&apos;ll keep it for you.
          </p>
        </Window>
      )}
      {review.status === "failed" && (
        <Window title="Scoring failed" tone="danger">
          <p className="mt-0">We couldn&apos;t produce a reliable scorecard for this interview.</p>
          {retry.error && (
            <p role="alert" className="text-danger">
              ! {retry.error}
            </p>
          )}
          <Button size="sm" loading={retry.pending} onClick={() => void retry.run()}>
            Try again
          </Button>
        </Window>
      )}
      {review.status === "none" && (
        <Window title="No scorecard" tone="sky">
          You didn&apos;t answer anything, so there is nothing to score. Your transcript is below.
        </Window>
      )}

      {scorecard && <Scorecard review={review} />}

      <Tabs
        aria-label="Review sections"
        items={[
          {
            id: "transcript",
            label: "Transcript",
            content: <Transcript review={review} onChanged={onChanged} />,
          },
          ...(session.usesEditor
            ? [
                {
                  id: "replay",
                  label: "Code replay",
                  content: <CodeReplay sessionId={session.id} durationMs={session.elapsedMs} />,
                },
              ]
            : []),
          ...(session.usesCanvas
            ? [
                {
                  id: "drawing",
                  label: "Your drawing",
                  content: <DrawingReview sessionId={session.id} />,
                },
              ]
            : []),
          ...(scorecard
            ? [
                { id: "evidence", label: "Evidence", content: <Evidence review={review} /> },
                {
                  id: "ideal",
                  label: "Ideal answers",
                  content: <IdealAnswers sessionId={session.id} />,
                },
                ...(session.type === "behavioral"
                  ? [{ id: "star", label: "STAR", content: <StarScores sessionId={session.id} /> }]
                  : []),
                {
                  id: "speech",
                  label: "Speech",
                  content: <SpeechPanel sessionId={session.id} />,
                },
                {
                  id: "feedback",
                  label: "Feedback",
                  content: <Feedback id={session.id} helpful={scorecard.helpful} />,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

function Scorecard({ review }: { review: InterviewReviewDto }) {
  const sc = review.scorecard!;
  const hasScore = sc.overall !== null;
  return (
    <div className="grid gap-5" data-testid="scorecard">
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Window title="Overall" tone="sky">
          <div className="grid justify-items-center gap-3 text-center">
            {hasScore ? (
              <>
                <p className="pq-font-display m-0 text-3xl" data-testid="overall-score">
                  {sc.overall}
                  <span className="text-base text-ink-soft">/100</span>
                </p>
                {sc.band && <Chip tone={BAND_TONE[sc.band] ?? "info"}>{sc.band}</Chip>}
              </>
            ) : (
              <p className="m-0">Not enough evidence to give a score.</p>
            )}
            <RadarScore
              axes={sc.scores.map((s) => ({
                label: s.name.split(" ")[0] ?? s.name,
                value: s.score,
              }))}
            />
          </div>
        </Window>
        <div className="grid content-start gap-4">
          {sc.coverage?.lowConfidence && (
            <p
              role="note"
              className="m-0 border-[3px] border-ink bg-sun px-3 py-2 text-[var(--on-coin)]"
              data-testid="low-confidence"
            >
              Treat this score as a rough guide: only part of the interview could be judged (
              {Math.round((sc.coverage.session ?? 0) * 100)}% of the time,{" "}
              {Math.round((sc.coverage.rubric ?? 0) * 100)}% of the criteria).
            </p>
          )}
          {sc.summary && <p className="m-0 text-lg">{sc.summary}</p>}
          <Window title="Breakdown" tone="olive">
            <div className="grid gap-3">
              {sc.scores.map((s) => (
                <ScoreBar key={s.dimension} label={s.name} score={s.score} weight={s.weight} />
              ))}
            </div>
          </Window>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Window title="Strengths" tone="olive">
          {sc.strengths.length === 0 ? (
            <p className="m-0">None recorded.</p>
          ) : (
            <ul className="m-0 grid gap-3 pl-5">
              {sc.strengths.map((s, i) => (
                <li key={i}>
                  {s.text}
                  {s.evidence[0] && (
                    <q className="mt-1 block text-sm text-ink-soft">{s.evidence[0].quote}</q>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Window>
        <Window title="Red flags" tone="danger">
          {sc.redFlags.length === 0 ? (
            <p className="m-0">No red flags. Nice.</p>
          ) : (
            <ul className="m-0 grid gap-3 pl-5">
              {sc.redFlags.map((f, i) => (
                <li key={i}>
                  <span className="mr-2 inline-flex gap-2">
                    <Chip
                      tone={
                        f.severity === "high" ? "hard" : f.severity === "medium" ? "medium" : "info"
                      }
                    >
                      {f.severity}
                    </Chip>
                    <Chip>{f.category}</Chip>
                  </span>
                  {f.text}
                  {f.evidence[0] && (
                    <q className="mt-1 block text-sm text-ink-soft">{f.evidence[0].quote}</q>
                  )}
                  <span className="mt-1 block text-sm">Try: {f.remedy}</span>
                </li>
              ))}
            </ul>
          )}
        </Window>
      </div>

      <Window title="Next steps" tone="sun">
        <ul className="m-0 grid gap-3 pl-5">
          {sc.nextActions.map((a, i) => {
            const href = actionHref(a.kind, a.ref);
            return (
              <li key={i}>
                {href ? (
                  <Link href={href} className="underline">
                    {a.title}
                  </Link>
                ) : (
                  <strong>{a.title}</strong>
                )}
                {a.why && <span className="block text-sm text-ink-soft">{a.why}</span>}
              </li>
            );
          })}
        </ul>
      </Window>
    </div>
  );
}

function Transcript({
  review,
  onChanged,
}: {
  review: InterviewReviewDto;
  onChanged: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<AnnotationDto["kind"] | "all">("all");
  const [focus, setFocus] = useState<number | null>(null);
  const refs = useRef(new Map<number, HTMLElement>());
  const bySeq = useMemo(() => {
    const m = new Map<number, AnnotationDto[]>();
    for (const a of review.annotations) m.set(a.turnSeq, [...(m.get(a.turnSeq) ?? []), a]);
    return m;
  }, [review.annotations]);

  const jump = (seq: number) => {
    setFocus(seq);
    refs.current.get(seq)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <div className="grid gap-4">
      {review.annotations.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter annotations"
        >
          {(["all", "positive", "improve", "missed", "red_flag"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={filter === k ? "accent" : "ghost"}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {k === "all" ? "All" : KIND_LABEL[k]}
            </Button>
          ))}
          <span className="text-sm text-ink-soft">Click a note to jump to the moment.</span>
        </div>
      )}
      {filter !== "all" || review.annotations.length > 0 ? (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Annotations">
          {review.annotations
            .filter((a) => filter === "all" || a.kind === filter)
            .map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => jump(a.turnSeq)}
                  className="flex w-full items-start gap-3 border-0 bg-transparent p-0 text-left"
                >
                  <span className="pq-font-pixel text-lg text-ink-soft">{clock(a.offsetMs)}</span>
                  <Chip tone={KIND_TONE[a.kind]}>{KIND_LABEL[a.kind]}</Chip>
                  <span>{a.text}</span>
                </button>
              </li>
            ))}
        </ul>
      ) : null}
      <ol className="m-0 grid list-none gap-3 p-0" aria-label="Transcript">
        {review.transcript.map((t) => (
          <li
            key={t.seq}
            ref={(el) => {
              if (el) refs.current.set(t.seq, el);
            }}
            className={focus === t.seq ? "outline outline-[3px] outline-offset-4 outline-sky" : ""}
          >
            <p className="m-0">
              <span className="pq-font-pixel text-lg text-ink-soft">{clock(t.offsetMs)} </span>
              <strong>{t.speaker === "interviewer" ? "Interviewer" : "You"}</strong>
              {t.hintUsed && <Chip className="ml-2">hint</Chip>}
            </p>
            <p className="m-0 whitespace-pre-wrap">{t.text}</p>
            {(bySeq.get(t.seq) ?? []).map((a) => (
              <AnnotationNote key={a.id} a={a} sessionId={review.session.id} onSaved={onChanged} />
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}

function AnnotationNote({
  a,
  sessionId,
  onSaved,
}: {
  a: AnnotationDto;
  sessionId: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(a.note ?? "");
  const save = useSubmit(async () => {
    await api(`/interviews/${sessionId}/annotations/${a.id}/note`, {
      method: "POST",
      json: { note: text.trim() || null },
    });
    await onSaved();
    setOpen(false);
  });
  return (
    <div className="mt-1 border-l-[3px] border-ink pl-3 text-sm">
      <Chip tone={KIND_TONE[a.kind]}>{KIND_LABEL[a.kind]}</Chip> {a.text}
      {a.note && !open && <p className="m-0 mt-1 text-ink-soft">Your note: {a.note}</p>}
      {open ? (
        <div className="mt-2 grid gap-2">
          <textarea
            aria-label="Your note"
            className="pq-input"
            rows={2}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ height: "auto" }}
          />
          <div className="flex gap-2">
            <Button size="sm" loading={save.pending} onClick={() => void save.run()}>
              Save note
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className="ml-2 underline" onClick={() => setOpen(true)}>
          {a.note ? "Edit note" : "Add note"}
        </button>
      )}
    </div>
  );
}

function Evidence({ review }: { review: InterviewReviewDto }) {
  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-ink-soft">
        Every score points to what you said or wrote. Scores without evidence are not shown. The
        overall score is computed from the weights, not chosen by the model.
      </p>
      {review.scorecard!.scores.map((s) => (
        <details key={s.dimension} className="pq-box p-3">
          <summary className="cursor-pointer">
            <strong>{s.name}</strong> · {s.score === null ? "not enough evidence" : `${s.score}/5`}
          </summary>
          <p className="mb-2 mt-2">{s.justification}</p>
          {s.evidence.map((e, i) => (
            <p key={i} className="m-0 text-sm text-ink-soft">
              {e.type === "turn" ? `Turn ${e.ref}` : "Code"}: <q>{e.quote}</q>
            </p>
          ))}
        </details>
      ))}
    </div>
  );
}

function Feedback({ id, helpful }: { id: string; helpful: number | null }) {
  const [value, setValue] = useState<boolean | null>(helpful === null ? null : helpful === 1);
  const [text, setText] = useState("");
  const send = useSubmit(async (h: boolean) => {
    await api(`/interviews/${id}/feedback`, {
      method: "POST",
      json: { helpful: h, text: text.trim() || null },
    });
    setValue(h);
  });
  return (
    <div className="grid max-w-lg gap-3">
      <p className="m-0">Was this scorecard helpful?</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={value === true ? "accent" : "ghost"}
          aria-pressed={value === true}
          onClick={() => void send.run(true)}
        >
          Yes
        </Button>
        <Button
          size="sm"
          variant={value === false ? "accent" : "ghost"}
          aria-pressed={value === false}
          onClick={() => void send.run(false)}
        >
          Not really
        </Button>
      </div>
      <textarea
        aria-label="What could be better?"
        className="pq-input"
        rows={3}
        maxLength={1000}
        placeholder="What could be better? (optional)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ height: "auto" }}
      />
      {send.error && (
        <p role="alert" className="m-0 text-danger">
          ! {send.error}
        </p>
      )}
      {value !== null && (
        <p className="m-0 text-sm text-ink-soft">Thanks, this helps us tune the interviewer.</p>
      )}
    </div>
  );
}
