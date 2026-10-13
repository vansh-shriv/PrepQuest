"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Chip, LoadingBar, Select } from "@prepquest/ui";
import {
  REVIEW_CATEGORIES,
  REVIEW_SEVERITIES,
  STRICTNESS_RULES,
  diffLines,
  type CodeReviewDto,
  type ReviewSeverity,
  type ReviewStrictness,
} from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";
import { CodeLines } from "@/components/library/CodeLines";
import {
  CATEGORY_LABEL,
  SEVERITY_LABEL,
  commentsByLine,
  numberedLines,
  ratingText,
  reviewPollMs,
  severityCounts,
} from "@/features/review/review-view";

const SEVERITY_TONE: Record<ReviewSeverity, "hard" | "medium" | "info"> = {
  important: "hard",
  suggestion: "medium",
  nit: "info",
};

/** Code review (X3): line comments from the AI, and a cleaner version that is shown only if the judge accepts it. */
export function ReviewPanel({
  submissionId,
  slug,
  language,
  code,
}: {
  submissionId: string;
  slug: string;
  language: string;
  code: string;
}) {
  const router = useRouter();
  const [strictness, setStrictness] = useState<ReviewStrictness>("strict");
  const [review, setReview] = useState<CodeReviewDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"unverified" | "error" | "limit" | null>(null);
  const [shown, setShown] = useState<ReadonlySet<ReviewSeverity>>(new Set(REVIEW_SEVERITIES));
  const [copied, setCopied] = useState(false);

  const fetchReview = useCallback(
    async (s: ReviewStrictness) => {
      const res = await api<{ review: CodeReviewDto | null }>(
        `/submissions/${submissionId}/review?strictness=${s}`,
      );
      setReview(res.review);
    },
    [submissionId],
  );

  // the saved strictness, then the review that already exists for it
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await api<{ strictness: ReviewStrictness }>("/code-review/settings");
        if (!alive) return;
        setStrictness(saved.strictness);
        const res = await api<{ review: CodeReviewDto | null }>(
          `/submissions/${submissionId}/review?strictness=${saved.strictness}`,
        );
        if (alive) setReview(res.review);
      } catch {
        /* the panel still works: the button starts a review */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [submissionId]);

  // follow a review that is being written, and the check of its refactor
  const delay = reviewPollMs(review);
  useEffect(() => {
    if (delay === null) return;
    const timer = setTimeout(() => void fetchReview(strictness).catch(() => undefined), delay);
    return () => clearTimeout(timer);
  }, [delay, review, strictness, fetchReview]);

  const changeStrictness = async (next: ReviewStrictness) => {
    setStrictness(next);
    setProblem(null);
    try {
      await api("/code-review/settings", { method: "PUT", json: { strictness: next } });
      await fetchReview(next);
    } catch {
      setReview(null);
    }
  };

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setReview(
        await api<CodeReviewDto>(`/submissions/${submissionId}/review`, {
          method: "POST",
          json: { strictness },
        }),
      );
    } catch (err) {
      setProblem(
        err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED"
          ? "unverified"
          : err instanceof ApiError && err.status === 429
            ? "limit"
            : "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const lines = useMemo(() => numberedLines(code), [code]);
  const byLine = useMemo(
    () => commentsByLine(review?.comments ?? [], shown),
    [review?.comments, shown],
  );
  const counts = useMemo(() => severityCounts(review?.comments ?? []), [review?.comments]);
  const working = review?.status === "pending";

  const toggle = (s: ReviewSeverity) => {
    const next = new Set(shown);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setShown(next);
  };

  const refactorCode = review?.refactor.code ?? null;
  const refactorDiff = useMemo(
    () => (refactorCode ? diffLines(code, refactorCode) : []),
    [code, refactorCode],
  );

  const openRefactor = () => {
    if (!refactorCode) return;
    try {
      sessionStorage.setItem(
        `pq:load-code:${slug}`,
        JSON.stringify({ code: refactorCode, language }),
      );
    } catch {
      /* storage blocked: the editor just opens normally */
    }
    router.push(`/problems/${slug}`);
  };

  const copyRefactor = async () => {
    if (!refactorCode) return;
    try {
      await navigator.clipboard.writeText(refactorCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section className="grid gap-3" aria-labelledby="review-h" data-testid="review-panel">
      <h2 id="review-h" className="pq-font-ui m-0 text-sm uppercase">
        Code review
      </h2>
      <p className="m-0 text-sm text-ink-soft">
        An AI reviewer reads your code the way an interviewer would: naming, idioms, complexity,
        edge cases and how it would look on a whiteboard.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="How strict?"
          value={strictness}
          helper={STRICTNESS_RULES[strictness].blurb}
          onChange={(e) => void changeStrictness(e.target.value as ReviewStrictness)}
        >
          <option value="gentle">Gentle</option>
          <option value="strict">Strict</option>
          <option value="pedantic">Pedantic</option>
        </Select>
        <Button
          onClick={() => void start()}
          disabled={busy || working || !loaded}
          data-testid="review-start"
        >
          {review?.status === "failed"
            ? "Try the review again"
            : review
              ? "Review again"
              : "Review my code"}
        </Button>
      </div>

      {problem === "unverified" ? (
        <p className="m-0 text-sm" role="status">
          Verify your email to ask for a review. You can resend the link from the{" "}
          <Link href="/dashboard" className="underline">
            dashboard
          </Link>
          .
        </p>
      ) : problem === "limit" ? (
        <p className="m-0 text-sm" role="status">
          That is a lot of reviews for now. Try again in a few minutes.
        </p>
      ) : problem === "error" ? (
        <p className="m-0 text-sm" role="status">
          The review could not be started. Try again.
        </p>
      ) : null}

      {working ? <LoadingBar label="Writing the review" /> : null}
      {review?.status === "failed" ? (
        <p className="m-0 text-sm" role="status">
          {review.error ?? "The review could not be written."}
        </p>
      ) : null}

      {review?.status === "ready" ? (
        <div className="grid gap-4" data-testid="review-result">
          <p className="m-0" data-testid="review-summary">
            {review.summary}
          </p>

          <ul
            className="m-0 grid list-none gap-x-8 gap-y-1 p-0 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]"
            aria-label="Ratings"
          >
            {REVIEW_CATEGORIES.map((cat) => (
              <li key={cat} className="flex items-center justify-between gap-3 text-sm">
                <span>{CATEGORY_LABEL[cat]}</span>
                <span aria-label={`${review.ratings[cat] ?? 0} out of 5`}>
                  <span aria-hidden="true">{ratingText(review.ratings[cat])}</span>
                </span>
              </li>
            ))}
          </ul>

          {review.comments.length > 0 ? (
            <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
              <legend className="pq-font-ui mb-1 text-xs uppercase">Show</legend>
              {REVIEW_SEVERITIES.map((s) => (
                <Checkbox
                  key={s}
                  label={`${SEVERITY_LABEL[s]} (${counts[s]})`}
                  checked={shown.has(s)}
                  disabled={counts[s] === 0}
                  onChange={() => toggle(s)}
                />
              ))}
            </fieldset>
          ) : null}

          <div
            className="max-h-[32rem] overflow-auto bg-surface-alt p-2 text-sm"
            style={{ fontFamily: "var(--font-code)" }}
            role="region"
            aria-label="Your code with review comments"
            tabIndex={0}
            data-testid="review-code"
          >
            {lines.map((l) => {
              const list = byLine.get(l.n);
              return (
                <div key={l.n}>
                  <div className="flex gap-3 whitespace-pre">
                    <span
                      className="w-8 shrink-0 select-none text-right text-ink-soft"
                      aria-hidden="true"
                    >
                      {l.n}
                    </span>
                    <span>
                      <span className="sr-only">Line {l.n}: </span>
                      {l.text}
                    </span>
                  </div>
                  {list?.map((c, i) => (
                    <div
                      key={i}
                      className="my-1 ml-11 grid gap-1 border-l-4 border-ink-soft bg-surface p-2 whitespace-normal"
                      data-testid="review-comment"
                      style={{ fontFamily: "var(--font-read)" }}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <Chip tone={SEVERITY_TONE[c.severity]}>{SEVERITY_LABEL[c.severity]}</Chip>
                        <span className="text-xs text-ink-soft">{CATEGORY_LABEL[c.category]}</span>
                      </span>
                      <span>{c.message}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {review.comments.length === 0 ? (
            <p className="m-0 text-sm">Nothing to flag. This is already clean.</p>
          ) : null}

          {review.refactor.status === "checking" ? (
            <p className="m-0 text-sm" role="status" data-testid="refactor-checking">
              A cleaner version is being checked against every test. It appears here only if it
              passes.
            </p>
          ) : review.refactor.status === "rejected" ? (
            <p className="m-0 text-sm text-ink-soft" role="status" data-testid="refactor-rejected">
              The suggested rewrite did not pass every test, so it is hidden. The comments above
              still stand.
            </p>
          ) : null}

          {review.refactor.status === "verified" && refactorCode ? (
            <div className="grid gap-2" data-testid="refactor">
              <h3 className="pq-font-ui m-0 text-xs uppercase">A cleaner version</h3>
              <p className="m-0 text-sm">
                <Chip tone="easy">Passes every test</Chip> {review.refactor.notes}
              </p>
              <CodeLines
                lines={refactorDiff}
                label="Changes from your code to the cleaner version"
              />
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => void copyRefactor()}>
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button size="sm" onClick={openRefactor}>
                  Open in editor
                </Button>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
