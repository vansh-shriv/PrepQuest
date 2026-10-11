"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, LoadingBar, Tabs } from "@prepquest/ui";
import type { LanguageValue, ProblemDetail } from "@prepquest/shared";
import { useJudge } from "@/features/submissions/use-judge";
import { api } from "@/lib/api";
import { CodeEditor } from "../problems/CodeEditor";
import { Markdown } from "../problems/Markdown";
import { ResultPanel } from "../problems/ResultPanel";

const LABEL: Record<LanguageValue, string> = { cpp: "C++17", java: "Java 17", python: "Python 3" };
const SNAPSHOT_EVERY_MS = 5000;

export interface CodePanelProps {
  sessionId: string;
  slug: string;
  /** Posts a code event to the interview (snapshots, runs, pastes, focus loss). */
  sendEvent: (body: Record<string, unknown>) => Promise<unknown>;
  disabled: boolean;
}

/**
 * The editor of an interview. Hints, editorials and drafts are not part of it: the code lives in
 * this tab, the interviewer sees snapshots, and runs go through the judge tagged to the interview.
 */
export function CodePanel({ sessionId, slug, sendEvent, disabled }: CodePanelProps) {
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [language, setLanguage] = useState<LanguageValue>("python");
  const [code, setCode] = useState("");
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState("description");
  const codeRef = useRef("");
  const sentRef = useRef("");
  const sendRef = useRef(sendEvent);
  sendRef.current = sendEvent;

  const judge = useJudge((finished) => {
    void sendRef.current({ kind: finished.kind, submissionId: finished.id });
  });

  useEffect(() => {
    let alive = true;
    setProblem(null);
    setFailed(false);
    api<ProblemDetail>(`/problems/${slug}`)
      .then((p) => {
        if (!alive) return;
        setProblem(p);
        const lang = p.languages.some((l) => l.language === "python")
          ? "python"
          : (p.languages[0]?.language ?? "python");
        setLanguage(lang);
        const starter = p.languages.find((l) => l.language === lang)?.starterCode ?? "";
        codeRef.current = starter;
        sentRef.current = "";
        setCode(starter);
        setRevision((r) => r + 1);
        judge.reset();
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  const chooseLanguage = (next: LanguageValue) => {
    const starter = problem?.languages.find((l) => l.language === next)?.starterCode ?? "";
    setLanguage(next);
    codeRef.current = starter;
    setCode(starter);
    setRevision((r) => r + 1);
  };

  // the interviewer sees the code every few seconds, but only when it changed
  useEffect(() => {
    if (disabled || !problem) return;
    const t = setInterval(() => {
      if (codeRef.current && codeRef.current !== sentRef.current) {
        sentRef.current = codeRef.current;
        void sendRef.current({ kind: "snapshot", language, code: codeRef.current });
      }
    }, SNAPSHOT_EVERY_MS);
    return () => clearInterval(t);
  }, [disabled, problem, language]);

  // leaving the tab is recorded (the scorecard can mention it; it never blocks anything)
  useEffect(() => {
    if (disabled) return;
    const onBlur = () => void sendRef.current({ kind: "focus_lost" });
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [disabled]);

  const request = useCallback(
    () => ({ slug, language, code: codeRef.current, interviewSessionId: sessionId }),
    [slug, language, sessionId],
  );
  const runCode = () => {
    if (!judge.busy && !disabled) {
      setTab("result");
      void judge.run(request());
    }
  };
  const submitCode = () => {
    if (!judge.busy && !disabled) {
      setTab("result");
      void judge.submit(request());
    }
  };
  const runRef = useRef(runCode);
  runRef.current = runCode;
  const submitRef = useRef(submitCode);
  submitRef.current = submitCode;

  if (failed) return <p className="m-0 p-4">Couldn&apos;t load the problem. Reload the page.</p>;
  if (!problem) {
    return (
      <div className="p-6">
        <LoadingBar label="Loading the problem" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="interview-code">
      <div className="flex flex-wrap items-center gap-2 border-b-[3px] border-ink bg-surface-alt px-3 py-2">
        <strong className="pq-font-ui text-sm uppercase">{problem.title}</strong>
        <select
          aria-label="Language"
          value={language}
          disabled={disabled}
          onChange={(e) => chooseLanguage(e.target.value as LanguageValue)}
          className="pq-input pq-select"
          style={{ width: "auto", height: 36, padding: "0 32px 0 10px" }}
        >
          {problem.languages.map((l) => (
            <option key={l.language} value={l.language}>
              {LABEL[l.language]}
            </option>
          ))}
        </select>
        <span className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            loading={judge.busy && judge.state.kind === "run"}
            disabled={judge.busy || disabled}
            onClick={runCode}
          >
            Run
          </Button>
          <Button
            size="sm"
            variant="accent"
            loading={judge.busy && judge.state.kind === "submit"}
            disabled={judge.busy || disabled}
            onClick={submitCode}
          >
            Submit
          </Button>
        </span>
      </div>
      <div className="min-h-[220px] flex-1">
        <CodeEditor
          key={`${slug}:${language}`}
          value={code}
          revision={revision}
          language={language}
          onChange={(c) => {
            codeRef.current = c;
          }}
          onPaste={(chars) => void sendRef.current({ kind: "paste", meta: { chars } })}
          onRun={() => runRef.current()}
          onSubmit={() => submitRef.current()}
          label={`${LABEL[language]} solution`}
        />
      </div>
      <div className="max-h-[42%] min-h-[150px] overflow-auto border-t-[3px] border-ink bg-bg">
        <Tabs
          aria-label="Problem and results"
          value={tab}
          onChange={setTab}
          items={[
            {
              id: "description",
              label: "Problem",
              content: (
                <div className="grid gap-3">
                  <Markdown>{problem.statementMd}</Markdown>
                  {problem.constraintsMd && <Markdown>{problem.constraintsMd}</Markdown>}
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
            { id: "result", label: "Result", content: <ResultPanel state={judge.state} /> },
          ]}
        />
      </div>
    </div>
  );
}
