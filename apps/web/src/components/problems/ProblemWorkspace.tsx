"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, Dialog, LoadingBar, Sprite, Tabs, Window } from "@prepquest/ui";
import type { DraftHistoryItem, LanguageValue, ProblemDetail } from "@prepquest/shared";
import { useDraft, type DraftStatus } from "@/features/problems/use-draft";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { readLocal, writeLocal } from "@/lib/local-store";
import { CodeEditor } from "./CodeEditor";
import { CustomTests } from "./CustomTests";
import { Markdown } from "./Markdown";
import { SplitPane } from "./SplitPane";

const LANGUAGE_LABEL: Record<LanguageValue, string> = {
  cpp: "C++17",
  java: "Java 17",
  python: "Python 3",
};
const DIFFICULTY_TONE = { easy: "easy", medium: "medium", hard: "hard" } as const;
const STATUS_TEXT: Record<DraftStatus, string> = {
  loading: "Loading draft...",
  saved: "All changes saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  conflict: "Newer draft found",
  offline: "Offline: will retry",
};

export function ProblemWorkspace({ slug }: { slug: string }) {
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [error, setError] = useState<{ missing: boolean; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setProblem(null);
    setError(null);
    api<ProblemDetail>(`/problems/${slug}`)
      .then((p) => alive && setProblem(p))
      .catch((err: unknown) => {
        if (!alive) return;
        const missing = err instanceof ApiError && err.status === 404;
        setError({
          missing,
          message: missing
            ? "This problem doesn't exist."
            : "Couldn't load the problem. Try again.",
        });
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (error) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <Sprite name="dino" scale={6} label="Dino" />
        <h1 className="pq-font-display m-0 text-base leading-relaxed">
          {error.missing ? "THIS PAGE WENT EXTINCT" : "OOPS"}
        </h1>
        <p className="m-0">{error.message}</p>
        <Link href="/problems" className="underline">
          Back to problems
        </Link>
      </div>
    );
  }
  if (!problem) {
    return (
      <div className="mx-auto max-w-xs py-24">
        <LoadingBar label="Loading problem" />
      </div>
    );
  }
  return <Workspace problem={problem} />;
}

function Description({ problem }: { problem: ProblemDetail }) {
  return (
    <article className="grid gap-5 p-4">
      <header className="grid gap-3">
        <h1 className="pq-font-display m-0 text-base leading-relaxed">{problem.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={DIFFICULTY_TONE[problem.difficulty]}>{problem.difficulty}</Chip>
          {problem.estMinutes ? <Chip>~{problem.estMinutes} min</Chip> : null}
          {problem.topics.map((t) => (
            <Chip key={t} tone="info">
              {t.replace(/-/g, " ")}
            </Chip>
          ))}
          {problem.archived ? <Chip tone="hard">archived</Chip> : null}
        </div>
      </header>

      <Markdown>{problem.statementMd}</Markdown>

      <section aria-labelledby="examples" className="grid gap-3">
        <h2 id="examples" className="pq-font-ui m-0 text-sm uppercase">
          Examples
        </h2>
        {problem.examples.map((ex, i) => (
          <div key={i} className="pq-card p-3" style={{ padding: 12 }}>
            <p className="pq-font-ui m-0 text-xs uppercase">Example {i + 1}</p>
            <pre
              className="m-0 mt-1 whitespace-pre-wrap text-sm"
              style={{ fontFamily: "var(--font-code)" }}
            >
              <strong>Input</strong>
              {"\n"}
              {ex.input}
              {"\n"}
              <strong>Output</strong>
              {"\n"}
              {ex.output}
            </pre>
            {ex.explanation ? <p className="m-0 mt-2 text-sm">{ex.explanation}</p> : null}
          </div>
        ))}
      </section>

      {problem.constraintsMd ? (
        <section aria-labelledby="constraints" className="grid gap-2">
          <h2 id="constraints" className="pq-font-ui m-0 text-sm uppercase">
            Constraints
          </h2>
          <Markdown>{problem.constraintsMd}</Markdown>
        </section>
      ) : null}
    </article>
  );
}

function ComingSoon({ phase, what }: { phase: number; what: string }) {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <Sprite name="dino" scale={4} label="Dino" />
      <p className="pq-font-pixel m-0 text-2xl">NOTHING HERE YET.</p>
      <p className="m-0 text-sm text-ink-soft">
        {what} arrives in build phase {phase}.
      </p>
    </div>
  );
}

function Workspace({ problem }: { problem: ProblemDetail }) {
  const { user } = useAuth();
  const [language, setLanguage] = useState<LanguageValue>(() => {
    const saved = typeof window === "undefined" ? null : readLocal<LanguageValue>("pq:language");
    const preferred = saved ?? (user?.settings.defaultLanguage as LanguageValue | undefined);
    return problem.languages.some((l) => l.language === preferred)
      ? (preferred as LanguageValue)
      : (problem.languages[0]?.language ?? "python");
  });
  const starter = problem.languages.find((l) => l.language === language)?.starterCode ?? "";
  const draft = useDraft(problem.slug, language, starter);

  const [mobileView, setMobileView] = useState<"left" | "right">("left");
  const [focus, setFocus] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [history, setHistory] = useState<DraftHistoryItem[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocus(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focus]);

  const chooseLanguage = (next: LanguageValue) => {
    writeLocal("pq:language", next);
    setLanguage(next);
  };

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setHistory(null);
    try {
      setHistory(await draft.loadHistory());
    } catch {
      setHistory([]);
    }
  }, [draft]);

  const left = (
    <Tabs
      aria-label="Problem sections"
      items={[
        { id: "description", label: "Description", content: <Description problem={problem} /> },
        {
          id: "submissions",
          label: "Submissions",
          content: <ComingSoon phase={4} what="Your submission history" />,
        },
        { id: "notes", label: "Notes", content: <ComingSoon phase={5} what="Personal notes" /> },
      ]}
    />
  );

  const right = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b-[3px] border-ink bg-surface-alt px-3 py-2">
        <select
          aria-label="Language"
          value={language}
          onChange={(e) => chooseLanguage(e.target.value as LanguageValue)}
          className="pq-input pq-select"
          style={{ width: "auto", height: 36, padding: "0 32px 0 10px" }}
        >
          {problem.languages.map((l) => (
            <option key={l.language} value={l.language}>
              {LANGUAGE_LABEL[l.language]}
            </option>
          ))}
        </select>
        <span
          role="status"
          aria-live="polite"
          className="pq-font-pixel text-lg text-ink-soft"
          data-testid="draft-status"
        >
          {STATUS_TEXT[draft.status]}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
            Reset
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void openHistory()}>
            History
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={focus}
            onClick={() => setFocus((f) => !f)}
          >
            {focus ? "Exit focus" : "Focus"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled
            title="The judge arrives in the next build phase"
          >
            Run
          </Button>
          <Button
            size="sm"
            variant="accent"
            disabled
            title="The judge arrives in the next build phase"
          >
            Submit
          </Button>
        </span>
      </div>

      {draft.conflict ? (
        <div className="p-3" role="alert">
          <Window title="Newer draft found" tone="sun">
            <p className="m-0 mb-3">
              Another tab or device saved a different version of this code.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={draft.acceptServer}>
                Load the newer one
              </Button>
              <Button size="sm" variant="ghost" onClick={draft.keepMine}>
                Keep mine
              </Button>
            </div>
          </Window>
        </div>
      ) : null}
      {draft.notice ? (
        <p role="status" className="m-0 bg-sky-light px-3 py-1 text-sm text-[#1a1a1a]">
          {draft.notice}
        </p>
      ) : null}

      <div className="min-h-[240px] flex-1">
        {draft.status === "loading" ? (
          <div className="p-6">
            <LoadingBar label="Loading your draft" />
          </div>
        ) : (
          <CodeEditor
            key={`${problem.slug}:${language}`}
            value={draft.code}
            revision={draft.revision}
            language={language}
            onChange={draft.edit}
            initialCursor={draft.initialCursor}
            onCursorChange={draft.setCursor}
            label={`${LANGUAGE_LABEL[language]} solution`}
          />
        )}
      </div>

      <div className="max-h-[40%] min-h-[140px] overflow-auto border-t-[3px] border-ink bg-bg">
        <Tabs
          aria-label="Test panel"
          items={[
            {
              id: "samples",
              label: "Samples",
              content: (
                <div className="grid gap-3">
                  {problem.examples.map((ex, i) => (
                    <pre
                      key={i}
                      className="m-0 whitespace-pre-wrap text-sm"
                      style={{ fontFamily: "var(--font-code)" }}
                    >
                      {ex.input}
                      {"\n=> "}
                      {ex.output}
                    </pre>
                  ))}
                </div>
              ),
            },
            { id: "custom", label: "Custom tests", content: <CustomTests slug={problem.slug} /> },
            {
              id: "result",
              label: "Result",
              content: <ComingSoon phase={4} what="Run and Submit results" />,
            },
          ]}
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-57px-56px)] flex-col md:h-[calc(100dvh-57px)]">
      <div
        className="flex gap-2 border-b-[3px] border-ink bg-bg p-2 md:hidden"
        role="tablist"
        aria-label="View"
      >
        {(["left", "right"] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={mobileView === v ? "accent" : "ghost"}
            role="tab"
            aria-selected={mobileView === v}
            onClick={() => setMobileView(v)}
          >
            {v === "left" ? "Problem" : "Code"}
          </Button>
        ))}
      </div>
      <SplitPane
        left={left}
        right={right}
        storageKey="pq:split:problem"
        mobileView={mobileView}
        hideLeft={focus}
      />

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset to starter?"
        tone="danger"
      >
        <p className="mt-0">
          Your current code is replaced by the starter code. You can get it back from History.
        </p>
        <div className="flex gap-3">
          <Button
            variant="danger"
            onClick={() => {
              draft.reset();
              setConfirmReset(false);
            }}
          >
            Reset
          </Button>
          <Button variant="ghost" onClick={() => setConfirmReset(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Earlier versions"
        tone="sky"
      >
        {history === null ? (
          <LoadingBar label="Loading" />
        ) : history.length === 0 ? (
          <p className="m-0">No earlier versions yet. Snapshots are kept as you edit.</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {history.map((h) => (
              <li key={h.savedAt} className="grid gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">{new Date(h.savedAt).toLocaleString()}</span>
                  <Button
                    size="sm"
                    onClick={() => {
                      draft.replace(h.code);
                      setHistoryOpen(false);
                    }}
                  >
                    Restore
                  </Button>
                </div>
                <pre
                  className="m-0 max-h-24 overflow-auto bg-surface-alt p-2 text-xs"
                  style={{ fontFamily: "var(--font-code)" }}
                >
                  {h.code.slice(0, 600)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
