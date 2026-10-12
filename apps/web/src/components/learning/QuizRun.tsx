"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buttonClasses,
  Button,
  Checkbox,
  Chip,
  Input,
  LoadingBar,
  Textarea,
  Window,
} from "@prepquest/ui";
import type {
  QuizAnswerResult,
  QuizAttemptDto,
  QuizQuestionDto,
  QuizResultDto,
} from "@prepquest/shared";
import {
  clock,
  isAnswerReady,
  MODE_LABELS,
  secondsLeft,
  toggleOption,
  type QuizResponse,
} from "@/features/learning/learning-view";
import { api, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";
import { Markdown } from "../problems/Markdown";

type Feedback = NonNullable<QuizAnswerResult["feedback"]>;

/** One quiz attempt: answer questions (with instant feedback or against the clock), then the result. */
export function QuizRun({ id }: { id: string }) {
  const [attempt, setAttempt] = useState<QuizAttemptDto | null>(null);
  const [result, setResult] = useState<QuizResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<Record<string, QuizResponse>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const shownAt = useRef(Date.now());
  const finishing = useRef(false);

  useEffect(() => {
    api<{ attempt: QuizAttemptDto | null; result: QuizResultDto | null }>(`/quizzes/attempts/${id}`)
      .then((r) => {
        setAttempt(r.attempt);
        setResult(r.result);
        if (r.attempt) {
          const firstOpen = r.attempt.questions.findIndex(
            (q) => !r.attempt!.answered.includes(q.id),
          );
          setIndex(firstOpen === -1 ? r.attempt.questions.length - 1 : firstOpen);
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the quiz."));
  }, [id]);

  const question = attempt?.questions[index];
  useEffect(() => {
    shownAt.current = Date.now();
  }, [question?.id]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    try {
      const r = await api<QuizResultDto>(`/quizzes/attempts/${id}/finish`, { method: "POST" });
      setResult(r);
      setAttempt(null);
    } catch (err) {
      finishing.current = false;
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }, [id]);

  // the countdown of a timed test: the server's deadline decides, this only displays it
  const deadline = attempt?.deadlineAt ?? null;
  useEffect(() => {
    if (!deadline) return;
    const tick = () => {
      const s = secondsLeft(deadline, Date.now());
      setLeft(s);
      if (s === 0) void finish();
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [deadline, finish]);

  if (error && !attempt && !result) return <FormError message={error} />;
  if (result) return <QuizResult result={result} />;
  if (!attempt || !question) return <LoadingBar label="Loading the quiz" />;

  const timed = attempt.mode === "timed";
  const current = responses[question.id];
  const shown = feedback[question.id];
  const last = index === attempt.questions.length - 1;

  const send = async (q: QuizQuestionDto): Promise<QuizAnswerResult | null> => {
    const response = responses[q.id];
    if (!isAnswerReady(q.type, response)) return null;
    try {
      return await api<QuizAnswerResult>(`/quizzes/attempts/${id}/answers`, {
        method: "POST",
        json: { questionId: q.id, response, timeMs: Date.now() - shownAt.current },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "ALREADY_ANSWERED") return null;
      throw err;
    }
  };

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await send(question);
      if (r?.feedback) setFeedback((f) => ({ ...f, [question.id]: r.feedback! }));
      setAttempt((a) => (a ? { ...a, answered: [...new Set([...a.answered, question.id])] } : a));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const move = async (to: number) => {
    if (timed) {
      setBusy(true);
      try {
        await send(question);
        setAttempt((a) =>
          a && isAnswerReady(question.type, current)
            ? { ...a, answered: [...new Set([...a.answered, question.id])] }
            : a,
        );
      } catch {
        /* the clock may have run out; finishing will settle it */
      } finally {
        setBusy(false);
      }
    }
    setIndex(to);
  };

  const submitTimed = async () => {
    setBusy(true);
    try {
      await send(question);
    } catch {
      /* the answer may be too late; the score uses what was saved */
    }
    setBusy(false);
    await finish();
  };

  return (
    <div className="grid max-w-3xl gap-4" data-testid="quiz-run">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">{MODE_LABELS[attempt.mode]}</h1>
        <div className="flex items-center gap-3">
          {timed && left !== null && (
            <span
              className="pq-font-pixel text-xl"
              role="timer"
              aria-label="Time left"
              data-testid="quiz-clock"
            >
              {clock(left)}
            </span>
          )}
          <Chip>
            Question {index + 1} of {attempt.total}
          </Chip>
        </div>
      </div>
      <FormError message={error} />

      <Window title={`${question.subject.toUpperCase()} · ${question.topic}`} tone="sky">
        <div className="grid gap-4" data-testid="quiz-question">
          <Markdown>{question.body}</Markdown>
          <Answer
            question={question}
            value={current}
            disabled={Boolean(shown) || busy}
            onChange={(v) => setResponses((r) => ({ ...r, [question.id]: v }))}
          />
          {shown && (
            <div className="grid gap-2" data-testid="quiz-feedback" role="status">
              <strong>{shown.correct ? "Correct." : "Not quite."}</strong>
              {!shown.correct && (
                <span>
                  Answer: <code>{answerText(question, shown.answer)}</code>
                </span>
              )}
              <Markdown>{shown.explanation}</Markdown>
              {shown.interviewLine && (
                <p className="m-0 text-sm text-ink-soft">In an interview: {shown.interviewLine}</p>
              )}
            </div>
          )}
        </div>
      </Window>

      <div className="flex flex-wrap gap-3">
        {timed ? (
          <>
            <Button variant="ghost" disabled={index === 0 || busy} onClick={() => move(index - 1)}>
              Back
            </Button>
            {!last && (
              <Button disabled={busy} onClick={() => move(index + 1)}>
                Next
              </Button>
            )}
            <Button variant="accent" loading={busy} onClick={submitTimed}>
              Finish test
            </Button>
          </>
        ) : shown ? (
          last ? (
            <Button variant="accent" loading={busy} onClick={finish}>
              See my results
            </Button>
          ) : (
            <Button variant="accent" onClick={() => setIndex(index + 1)}>
              Next question
            </Button>
          )
        ) : (
          <Button
            variant="accent"
            loading={busy}
            disabled={!isAnswerReady(question.type, current)}
            onClick={check}
          >
            Check answer
          </Button>
        )}
      </div>
    </div>
  );
}

function answerText(q: QuizQuestionDto, answer: unknown): string {
  if (q.type === "tf") return answer ? "True" : "False";
  const text = (id: string) => q.options?.find((o) => o.id === id)?.text ?? id;
  if (q.type === "single") return text(String(answer));
  if (Array.isArray(answer)) {
    return q.type === "multi" ? answer.map((a) => text(String(a))).join("; ") : String(answer[0]);
  }
  return String(answer);
}

function Answer({
  question,
  value,
  disabled,
  onChange,
}: {
  question: QuizQuestionDto;
  value: QuizResponse | undefined;
  disabled: boolean;
  onChange: (v: QuizResponse) => void;
}) {
  if (question.type === "single" || question.type === "tf") {
    const options =
      question.type === "tf"
        ? [
            { id: "true", text: "True" },
            { id: "false", text: "False" },
          ]
        : (question.options ?? []);
    const selected =
      question.type === "tf" ? (typeof value === "boolean" ? String(value) : "") : value;
    return (
      <fieldset className="m-0 grid gap-2 border-0 p-0" disabled={disabled}>
        <legend className="pq-sr-only">Choose one answer</legend>
        {options.map((o) => (
          <label key={o.id} className="pq-box flex cursor-pointer items-center gap-3 p-2">
            <input
              type="radio"
              name={`q-${question.id}`}
              value={o.id}
              checked={selected === o.id}
              onChange={() => onChange(question.type === "tf" ? o.id === "true" : o.id)}
            />
            <span>{o.text}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  if (question.type === "multi") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="m-0 grid gap-2 border-0 p-0" disabled={disabled}>
        <legend className="pq-sr-only">Choose all that apply</legend>
        {(question.options ?? []).map((o) => (
          <Checkbox
            key={o.id}
            label={o.text}
            checked={selected.includes(o.id)}
            onChange={() => onChange(toggleOption(selected, o.id))}
          />
        ))}
      </fieldset>
    );
  }
  if (question.type === "output") {
    return (
      <Textarea
        label="Your answer (what it prints)"
        rows={3}
        disabled={disabled}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Input
      label="Your answer"
      disabled={disabled}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function QuizResult({ result }: { result: QuizResultDto }) {
  return (
    <div className="grid max-w-3xl gap-4" data-testid="quiz-result">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Results</h1>
      <Window title={`${result.correct} of ${result.total} correct`} tone="sun">
        <div className="grid gap-2">
          <span className="pq-font-display text-3xl" data-testid="quiz-score">
            {result.percent}%
          </span>
          {result.expired && <Chip tone="medium">Time ran out</Chip>}
          {result.medianSeconds !== null && (
            <span className="text-sm text-ink-soft">
              Typical time per answer: {result.medianSeconds}s
            </span>
          )}
          {result.xpAwarded > 0 && <span data-testid="quiz-xp">+{result.xpAwarded} XP</span>}
          <div className="flex flex-wrap gap-3">
            <Link href="/quizzes" className={buttonClasses({ variant: "accent" })}>
              Another quiz
            </Link>
            <Link href="/roadmaps" className={buttonClasses({ variant: "ghost" })}>
              Back to the roadmaps
            </Link>
          </div>
        </div>
      </Window>

      <ol className="m-0 grid list-none gap-3 p-0" aria-label="Question review">
        {result.review.map((r, i) => (
          <li key={r.question.id} data-correct={r.correct} data-testid="quiz-review-item">
            <Window
              title={`${i + 1}. ${r.answered ? (r.correct ? "Correct" : "Missed") : "Not answered"}`}
              tone={r.correct ? "olive" : undefined}
            >
              <div className="grid gap-2">
                <Markdown>{r.question.body}</Markdown>
                {!r.correct && (
                  <span>
                    Answer: <code>{answerText(r.question, r.answer)}</code>
                  </span>
                )}
                <Markdown>{r.explanation}</Markdown>
                {r.interviewLine && (
                  <p className="m-0 text-sm text-ink-soft">In an interview: {r.interviewLine}</p>
                )}
              </div>
            </Window>
          </li>
        ))}
      </ol>
    </div>
  );
}
