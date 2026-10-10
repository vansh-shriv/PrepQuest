"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LanguageValue, SubmissionCreated, SubmissionDetail } from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";

export type JudgePhase = "idle" | "sending" | "waiting" | "done" | "failed";

export interface JudgeState {
  phase: JudgePhase;
  kind: "run" | "submit" | null;
  /** Latest snapshot of the submission while it is being judged, and the final one afterwards. */
  submission: SubmissionDetail | null;
  /** Rough place in the queue right after sending. */
  queuePosition: number | null;
  error: string | null;
}

const IDLE: JudgeState = {
  phase: "idle",
  kind: null,
  submission: null,
  queuePosition: null,
  error: null,
};

/** Poll quickly at first (most runs finish in about a second), then back off. */
export const pollDelay = (attempt: number): number =>
  attempt < 20 ? 400 : attempt < 40 ? 1000 : 2000;
/** Give up waiting (the server closes stuck submissions on its own after 5 minutes). */
const GIVE_UP_MS = 120_000;

const errorText = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.code === "RATE_LIMITED" || err.code === "TOO_MANY_PENDING") return err.message;
    if (err.status === 503) return "The judge is unavailable right now. Try again in a moment.";
    return err.message;
  }
  return "Couldn't reach the server. Check your connection and try again.";
};

export interface JudgeRequest {
  slug: string;
  language: LanguageValue;
  code: string;
  customTestIds?: string[];
}

/**
 * Sends code to the judge and follows the submission until it has a verdict. Starting a new run
 * abandons the previous one (its result simply stops being shown).
 */
export function useJudge(onFinished?: (s: SubmissionDetail) => void) {
  const [state, setState] = useState<JudgeState>(IDLE);
  const generation = useRef(0);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(
    () => () => {
      generation.current++; // stop polling after unmount
    },
    [],
  );

  const start = useCallback(async (kind: "run" | "submit", req: JudgeRequest) => {
    const mine = ++generation.current;
    const alive = () => generation.current === mine;
    setState({ ...IDLE, phase: "sending", kind });
    try {
      const created = await api<SubmissionCreated>("/submissions", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        json: {
          problemSlug: req.slug,
          language: req.language,
          code: req.code,
          kind,
          customTestIds: req.customTestIds ?? [],
        },
      });
      if (!alive()) return;
      setState((s) => ({ ...s, phase: "waiting", queuePosition: created.queuePosition ?? null }));

      const deadline = Date.now() + GIVE_UP_MS;
      for (let attempt = 0; alive(); attempt++) {
        await new Promise((r) => setTimeout(r, pollDelay(attempt)));
        if (!alive()) return;
        const snapshot = await api<SubmissionDetail>(`/submissions/${created.submissionId}`);
        if (!alive()) return;
        if (snapshot.finished) {
          setState({ phase: "done", kind, submission: snapshot, queuePosition: null, error: null });
          finished.current?.(snapshot);
          return;
        }
        setState((s) => ({ ...s, submission: snapshot }));
        if (Date.now() > deadline) {
          setState((s) => ({
            ...s,
            phase: "failed",
            error: "The judge is taking longer than usual. Check Submissions in a minute.",
          }));
          return;
        }
      }
    } catch (err) {
      if (alive()) setState({ ...IDLE, phase: "failed", kind, error: errorText(err) });
    }
  }, []);

  const run = useCallback((req: JudgeRequest) => start("run", req), [start]);
  const submit = useCallback((req: JudgeRequest) => start("submit", req), [start]);
  const reset = useCallback(() => {
    generation.current++;
    setState(IDLE);
  }, []);

  return {
    state,
    run,
    submit,
    reset,
    busy: state.phase === "sending" || state.phase === "waiting",
  };
}
