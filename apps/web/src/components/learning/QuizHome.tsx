"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Chip, Input, LoadingBar, Select, Window } from "@prepquest/ui";
import type { QuizAttemptDto, QuizCatalogResponse } from "@prepquest/shared";
import { accuracyText, MODE_LABELS } from "@/features/learning/learning-view";
import { api, ApiError } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

type Mode = keyof typeof MODE_LABELS;

/** CS fundamentals quizzes (C1): choose a subject and a mode, or review what you got wrong. */
export function QuizHome() {
  const router = useRouter();
  const params = useSearchParams();
  const [catalog, setCatalog] = useState<QuizCatalogResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subject, setSubject] = useState(params.get("subject") ?? "");
  const [mode, setMode] = useState<Mode>("practice");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(10);
  const [minutes, setMinutes] = useState(15);

  useEffect(() => {
    api<QuizCatalogResponse>("/quizzes")
      .then(setCatalog)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Couldn't reach the server."),
      );
  }, []);

  const start = useSubmit(async () => {
    const attempt = await api<QuizAttemptDto>("/quizzes/attempts", {
      method: "POST",
      json: {
        mode,
        ...(subject ? { subject } : {}),
        ...(mode === "drill" && topic ? { topic } : {}),
        count,
        ...(mode === "timed" ? { minutes } : {}),
      },
    });
    router.push(`/quizzes/${attempt.id}`);
  });

  if (loadError) return <FormError message={loadError} />;
  if (!catalog) return <LoadingBar label="Loading quizzes" />;

  const chosen = catalog.subjects.find((s) => s.subject === subject);

  return (
    <div className="grid max-w-4xl gap-6" data-testid="quizzes">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Quizzes</h1>

      <Window title="Start a quiz" tone="sun">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void start.run();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Subject"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setTopic("");
              }}
            >
              <option value="">All subjects</option>
              {catalog.subjects.map((s) => (
                <option key={s.subject} value={s.subject}>
                  {s.label} ({s.questions})
                </option>
              ))}
            </Select>
            <Select label="Mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="practice">Practice: answers explained as you go</option>
              <option value="timed">Timed test: score at the end</option>
              <option value="drill">Topic drill: one topic</option>
              <option value="weak">Weak-area quiz: your mistakes ({catalog.weakCount})</option>
            </Select>
            {mode === "drill" && (
              <Select
                label="Topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                helper={subject ? undefined : "Choose a subject first."}
              >
                <option value="">Choose a topic</option>
                {(chosen?.topics ?? []).map((t) => (
                  <option key={t.topic} value={t.topic}>
                    {t.topic} ({t.questions})
                  </option>
                ))}
              </Select>
            )}
            <Input
              label="Questions"
              type="number"
              min={3}
              max={30}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
            {mode === "timed" && (
              <Input
                label="Minutes for the whole test"
                type="number"
                min={1}
                max={90}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                helper="The clock runs on our side, even if you close the tab."
              />
            )}
          </div>
          <FormError message={start.error} />
          <div>
            <Button
              type="submit"
              variant="accent"
              loading={start.pending}
              disabled={mode === "drill" && !topic}
            >
              Start
            </Button>
          </div>
        </form>
      </Window>

      <div className="grid gap-4 sm:grid-cols-2" data-testid="quiz-subjects">
        {catalog.subjects.map((s) => (
          <Window key={s.subject} title={s.label} tone="sky">
            <div className="grid gap-2">
              <span>{s.questions} questions</span>
              <span className="text-sm text-ink-soft">
                Your record: {accuracyText(s.correct, s.answered)}
              </span>
              <div className="flex flex-wrap gap-1">
                {s.topics.map((t) => (
                  <Chip key={t.topic}>{t.topic}</Chip>
                ))}
              </div>
            </div>
          </Window>
        ))}
      </div>

      {catalog.recent.length > 0 && (
        <Window title="Recent quizzes">
          <ul className="m-0 grid list-none gap-1 p-0" data-testid="quiz-recent">
            {catalog.recent.map((r) => (
              <li key={r.id}>
                <Link href={`/quizzes/${r.id}`} className="underline">
                  {MODE_LABELS[r.mode as Mode] ?? r.mode}
                  {r.subject ? `, ${r.subject}` : ""}
                </Link>{" "}
                <span className="text-sm text-ink-soft">
                  {r.correct ?? 0} of {r.total}
                </span>
              </li>
            ))}
          </ul>
        </Window>
      )}
    </div>
  );
}
