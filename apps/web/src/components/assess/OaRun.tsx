"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClasses, Checkbox, Chip, Input, LoadingBar, Window } from "@prepquest/ui";
import type { OaAttemptDto, OaItemDto, OaReportDto } from "@prepquest/shared";
import {
  marksText,
  minutesText,
  negativeText,
  paceText,
  percentileText,
  sectionLabel,
} from "@/features/assess/assess-view";
import { clock, toggleOption } from "@/features/learning/learning-view";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";
import { Markdown } from "../problems/Markdown";
import { Calculator } from "./Calculator";

/** One online assessment: between sections, inside a running section, or the report. */
export function OaRun() {
  const { id } = useParams<{ id: string }>();
  const [attempt, setAttempt] = useState<OaAttemptDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAttempt(await api<OaAttemptDto>(`/oa/attempts/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the test.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      setAttempt(await api<OaAttemptDto>(`/oa/attempts/${id}/${path}`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (error && !attempt) return <FormError message={error} />;
  if (!attempt) return <LoadingBar label="Loading the test" />;

  if (attempt.step === "finished" && attempt.report) {
    return <Report attempt={attempt} report={attempt.report} />;
  }
  if (attempt.step === "section" && attempt.current) {
    return (
      <Section
        key={attempt.current.key}
        attempt={attempt}
        onSubmit={() => act("submit-section")}
        onExpired={load}
        busy={busy}
        error={error}
      />
    );
  }
  return <Between attempt={attempt} busy={busy} error={error} act={act} />;
}

function Between({
  attempt,
  busy,
  error,
  act,
}: {
  attempt: OaAttemptDto;
  busy: boolean;
  error: string | null;
  act: (path: string) => Promise<void>;
}) {
  const next = attempt.index ?? 0;
  const section = attempt.sections[next];
  const first = next === 0;
  return (
    <div className="grid max-w-3xl gap-4" data-testid="oa-between">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">{attempt.template.title}</h1>
      <FormError message={error} />
      <ol className="m-0 grid list-none gap-1 p-0" aria-label="Sections">
        {attempt.sections.map((s) => (
          <li
            key={s.key}
            className="flex flex-wrap items-center gap-2"
            data-testid="oa-section-row"
          >
            <strong>{s.title}</strong>
            <span className="text-sm text-ink-soft">
              {s.count} questions · {minutesText(s.minutes)}
            </span>
            <Chip tone={s.status === "done" ? "easy" : "neutral"}>{sectionLabel(s)}</Chip>
          </li>
        ))}
      </ol>
      {section && (
        <Window title={first ? "Before you start" : "Next section"} tone="sun">
          <div className="grid gap-3">
            <p className="m-0">
              <strong>{section.title}</strong>: {section.count} questions in{" "}
              {minutesText(section.minutes)}.
            </p>
            <ul className="m-0 list-disc pl-5 text-sm">
              <li>The clock starts when you press the button and keeps running if you leave.</li>
              <li>When the section ends you cannot go back to it.</li>
              <li>{negativeText(attempt.template.negativeMarking)}.</li>
              <li>
                {attempt.template.calculator
                  ? "An on-screen calculator is available."
                  : "No calculator."}
              </li>
              <li>
                An unanswered question scores nothing, so leaving a hard one is never penalised.
              </li>
            </ul>
            <div className="flex flex-wrap gap-3">
              <Button variant="accent" loading={busy} onClick={() => act(`sections/${next}/start`)}>
                Start section
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => act("finish")}>
                End the test now
              </Button>
            </div>
          </div>
        </Window>
      )}
    </div>
  );
}

function Section({
  attempt,
  onSubmit,
  onExpired,
  busy,
  error,
}: {
  attempt: OaAttemptDto;
  onSubmit: () => void;
  onExpired: () => void;
  busy: boolean;
  error: string | null;
}) {
  const current = attempt.current!;
  const section = attempt.sections[attempt.index ?? 0]!;
  const [answers, setAnswers] = useState<Record<string, string>>(current.answers);
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState(current.secondsLeft);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const deadline = useRef(Date.now() + current.secondsLeft * 1000);
  const expired = useRef(false);

  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0 && !expired.current) {
        expired.current = true;
        onExpired();
      }
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [onExpired]);

  const item = current.items[index]!;
  const save = async (itemId: string, response: string | null) => {
    try {
      setSaveError(null);
      await api(`/oa/attempts/${attempt.id}/answers`, {
        method: "PUT",
        json: { itemId, response },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "OA_SECTION_CLOSED") {
        onExpired();
        return;
      }
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save that answer.");
    }
  };
  const set = (itemId: string, value: string) => {
    setAnswers((a) => {
      const next = { ...a };
      if (value === "") delete next[itemId];
      else next[itemId] = value;
      return next;
    });
  };
  const choose = (value: string) => {
    set(item.id, value);
    void save(item.id, value === "" ? null : value);
  };
  const answered = current.items.filter((i) => answers[i.id] !== undefined).length;

  return (
    <div className="grid max-w-4xl gap-4" data-testid="oa-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">{section.title}</h1>
        <div className="flex items-center gap-3">
          <span
            className={`pq-font-pixel text-xl ${left <= 60 ? "text-danger" : ""}`}
            role="timer"
            aria-label="Time left in this section"
            data-testid="oa-clock"
          >
            {clock(left)}
          </span>
          <Chip>
            {answered} of {current.items.length} answered
          </Chip>
        </div>
      </div>
      <FormError message={error ?? saveError} />

      <nav aria-label="Questions" className="flex flex-wrap gap-1">
        {current.items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            className={`pq-box min-w-9 px-2 py-1 ${i === index ? "bg-sun" : answers[it.id] !== undefined ? "bg-surface-alt" : ""}`}
            aria-current={i === index ? "step" : undefined}
            aria-label={`Question ${i + 1}${answers[it.id] !== undefined ? ", answered" : ""}`}
            onClick={() => setIndex(i)}
          >
            {i + 1}
          </button>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <Window title={`Question ${index + 1} of ${current.items.length}`} tone="sky">
          <div className="grid gap-4" data-testid="oa-question">
            <Markdown>{item.body}</Markdown>
            <Answer item={item} value={answers[item.id] ?? ""} onChange={set} onCommit={choose} />
            <div>
              <Button
                variant="ghost"
                onClick={() => choose("")}
                disabled={answers[item.id] === undefined}
              >
                Clear answer
              </Button>
            </div>
          </div>
        </Window>
        {attempt.template.calculator && <Calculator />}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          Previous
        </Button>
        <Button disabled={index === current.items.length - 1} onClick={() => setIndex(index + 1)}>
          Next
        </Button>
        {confirming ? (
          <>
            <span className="self-center">Hand in this section? You cannot come back to it.</span>
            <Button variant="accent" loading={busy} onClick={onSubmit}>
              Yes, hand in
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep working
            </Button>
          </>
        ) : (
          <Button variant="accent" onClick={() => setConfirming(true)}>
            Hand in section
          </Button>
        )}
      </div>
    </div>
  );
}

function Answer({
  item,
  value,
  onChange,
  onCommit,
}: {
  item: OaItemDto;
  value: string;
  onChange: (itemId: string, v: string) => void;
  onCommit: (v: string) => void;
}) {
  if (item.type === "single" || item.type === "tf") {
    return (
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="pq-sr-only">Choose one answer</legend>
        {(item.options ?? []).map((o) => (
          <label key={o.id} className="pq-box flex cursor-pointer items-center gap-3 p-2">
            <input
              type="radio"
              name={`q-${item.id}`}
              value={o.id}
              checked={value === o.id}
              onChange={() => onCommit(o.id)}
            />
            <span>{o.text}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  if (item.type === "multi") {
    const selected = value ? value.split(",") : [];
    return (
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="pq-sr-only">Choose all that apply</legend>
        {(item.options ?? []).map((o) => (
          <Checkbox
            key={o.id}
            label={o.text}
            checked={selected.includes(o.id)}
            onChange={() => onCommit(toggleOption(selected, o.id).join(","))}
          />
        ))}
      </fieldset>
    );
  }
  return (
    <Input
      label="Your answer"
      value={value}
      onChange={(e) => onChange(item.id, e.target.value)}
      onBlur={() => onCommit(value.trim())}
      autoComplete="off"
    />
  );
}

function Report({ attempt, report }: { attempt: OaAttemptDto; report: OaReportDto }) {
  const [onlyMissed, setOnlyMissed] = useState(true);
  const review = onlyMissed ? report.review.filter((r) => !r.correct) : report.review;
  const allowed =
    attempt.sections.reduce((a, s) => a + s.minutes * 60, 0) / Math.max(1, report.review.length);
  return (
    <div className="grid max-w-4xl gap-6" data-testid="oa-report">
      <div>
        <Link href="/tests" className="text-sm underline">
          All tests
        </Link>
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">
          {attempt.template.title}: results
        </h1>
      </div>

      <Window title="Your score" tone="sun">
        <div className="grid gap-2">
          <p className="pq-font-pixel m-0 text-2xl" data-testid="oa-score">
            {marksText(report.marks)} / {report.maxMarks} · {report.percent}%
          </p>
          <span>{percentileText(report.percentile)}</span>
          <span className="text-sm text-ink-soft">
            {negativeText(attempt.template.negativeMarking)}.
          </span>
          {report.xpAwarded > 0 && <span>+{report.xpAwarded} XP</span>}
        </div>
      </Window>

      <Window title="Section by section" tone="sky">
        <table className="w-full border-collapse text-left text-sm" aria-label="Section scores">
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1">
                Section
              </th>
              <th scope="col" className="px-2 py-1">
                Marks
              </th>
              <th scope="col" className="px-2 py-1">
                Right
              </th>
              <th scope="col" className="px-2 py-1">
                Wrong
              </th>
              <th scope="col" className="px-2 py-1">
                Left blank
              </th>
              <th scope="col" className="px-2 py-1">
                Accuracy
              </th>
              <th scope="col" className="px-2 py-1">
                Rank
              </th>
            </tr>
          </thead>
          <tbody data-testid="oa-sections">
            {report.sections.map((s) => (
              <tr key={s.key}>
                <th scope="row" className="px-2 py-1 font-normal">
                  {s.title}
                  {s.endedBy === "time" && <span className="text-ink-soft"> (time ran out)</span>}
                </th>
                <td className="px-2 py-1">
                  {marksText(s.marks)} / {s.maxMarks}
                </td>
                <td className="px-2 py-1">{s.correct}</td>
                <td className="px-2 py-1">{s.wrong}</td>
                <td className="px-2 py-1">{s.skipped}</td>
                <td className="px-2 py-1">{s.accuracy === null ? "-" : `${s.accuracy}%`}</td>
                <td className="px-2 py-1">{s.percentile === null ? "-" : `${s.percentile}th`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Window>

      <Window title="What to work on">
        <div className="grid gap-2">
          <span>{paceText(report.secondsPerQuestion, allowed)}</span>
          {report.rushed.length > 0 && (
            <span>Ran out of time with questions left in: {report.rushed.join(", ")}.</span>
          )}
          {report.weakTopics.length > 0 ? (
            <ul className="m-0 list-disc pl-5">
              {report.weakTopics.map((t) => (
                <li key={t.topic}>
                  {t.topic}: missed or skipped {t.missed} of {t.total}
                </li>
              ))}
            </ul>
          ) : (
            <span>No topic stood out as weak.</span>
          )}
        </div>
      </Window>

      <section className="grid gap-3" aria-label="Review">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-base">Review</h2>
          <Checkbox
            label="Only questions I missed or skipped"
            checked={onlyMissed}
            onChange={(e) => setOnlyMissed(e.target.checked)}
          />
        </div>
        {review.length === 0 && <p>Nothing missed. Well done.</p>}
        <ul className="m-0 grid list-none gap-3 p-0" data-testid="oa-review">
          {review.map((r) => (
            <li key={r.id} className="pq-box grid gap-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={r.correct ? "easy" : "hard"}>
                  {r.correct ? "right" : r.answered ? "wrong" : "left blank"}
                </Chip>
                <Chip>{r.section}</Chip>
                <Chip>{r.topic}</Chip>
              </div>
              <Markdown>{r.body}</Markdown>
              {r.answered && !r.correct && <span>Your answer: {r.yourAnswer}</span>}
              <span>
                Answer: <strong>{r.answer}</strong>
              </span>
              <Markdown>{r.explanation}</Markdown>
              {r.shortcut && <p className="m-0 text-sm text-ink-soft">Shortcut: {r.shortcut}</p>}
            </li>
          ))}
        </ul>
      </section>

      <div>
        <Link href="/tests" className={buttonClasses({ variant: "accent" })}>
          Back to tests
        </Link>
      </div>
    </div>
  );
}
