"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Chip, LoadingBar } from "@prepquest/ui";
import {
  DESIGN_RUBRIC,
  DESIGN_RUBRIC_LABEL,
  type DesignCanvasFull,
  type DesignReferenceDto,
} from "@prepquest/shared";
import type { DesignCanvas } from "@prepquest/analytics-core";
import { api, ApiError } from "@/lib/api";
import { CanvasEditor } from "./CanvasEditor";

const ratingText = (n: number | undefined) => {
  const v = Math.max(0, Math.min(5, Math.round(n ?? 0)));
  return `${"■".repeat(v)}${"□".repeat(5 - v)}`;
};

/** Review of the design: automatic checks, the model's scores and findings, and the questions to answer next. */
export function DesignReview({
  doc,
  canAsk,
  saveNow,
  onDoc,
  onRefresh,
  onHighlight,
}: {
  doc: DesignCanvasFull;
  canAsk: boolean;
  saveNow: () => Promise<boolean>;
  onDoc: (d: DesignCanvasFull) => void;
  onRefresh: () => Promise<void>;
  onHighlight: (ids: string[]) => void;
}) {
  const [problem, setProblem] = useState<"unverified" | "limit" | "empty" | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = doc.reviewStatus === "pending";

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => void onRefresh(), 1500);
    return () => clearTimeout(timer);
  }, [pending, doc, onRefresh]);

  const ask = async () => {
    setBusy(true);
    setProblem(null);
    try {
      // the model reviews what is stored, so store what is on the screen first
      if (!(await saveNow())) {
        setProblem("error");
        return;
      }
      onDoc(await api<DesignCanvasFull>(`/design/canvases/${doc.id}/review`, { method: "POST" }));
    } catch (err) {
      setProblem(
        err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED"
          ? "unverified"
          : err instanceof ApiError && err.status === 429
            ? "limit"
            : err instanceof ApiError && err.status === 422
              ? "empty"
              : "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const review = doc.review;
  const stale = review !== null && review.version < doc.version;

  return (
    <section className="grid gap-4" aria-labelledby="dr-h" data-testid="design-review">
      <h2 id="dr-h" className="pq-font-ui m-0 text-sm uppercase">
        Review
      </h2>

      <div className="grid gap-1" data-testid="design-checks">
        <h3 className="pq-font-ui m-0 text-xs uppercase">Quick checks</h3>
        {doc.findings.length === 0 ? (
          <p className="m-0 text-sm">Nothing obvious is missing.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-sm">
            {doc.findings.map((f) => (
              <li key={f.code} className="flex flex-wrap items-baseline gap-2">
                <Chip tone={f.severity === "important" ? "hard" : "medium"}>
                  {f.severity === "important" ? "Important" : "Suggestion"}
                </Chip>
                <button
                  type="button"
                  className="text-left underline"
                  onClick={() => onHighlight(f.nodeIds)}
                  disabled={f.nodeIds.length === 0}
                >
                  {f.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void ask()}
          disabled={busy || pending || !canAsk}
          data-testid="design-review-start"
        >
          {doc.reviewStatus === "failed"
            ? "Try the review again"
            : review
              ? "Review again"
              : "Ask for a review"}
        </Button>
        {!canAsk && (
          <span className="text-sm text-ink-soft">Draw at least two components first.</span>
        )}
      </div>
      {problem === "unverified" && (
        <p className="m-0 text-sm" role="status">
          Verify your email to ask for a review. You can resend the link from the{" "}
          <Link href="/dashboard" className="underline">
            dashboard
          </Link>
          .
        </p>
      )}
      {problem === "limit" && (
        <p className="m-0 text-sm" role="status">
          That is a lot of reviews for now. Try again in a few minutes.
        </p>
      )}
      {problem === "empty" && (
        <p className="m-0 text-sm" role="status">
          Draw at least two components first.
        </p>
      )}
      {problem === "error" && (
        <p className="m-0 text-sm" role="status">
          The review could not be started. Check that your design is saved and try again.
        </p>
      )}
      {pending && <LoadingBar label="Reading your design" />}
      {doc.reviewStatus === "failed" && (
        <p className="m-0 text-sm" role="status">
          {doc.reviewError}
        </p>
      )}

      {review && (
        <div className="grid gap-4" data-testid="design-review-result">
          {stale && (
            <p className="m-0 text-sm text-ink-soft" data-testid="review-stale">
              This review is of an earlier version. Ask again to review your latest changes.
            </p>
          )}
          <p className="m-0" data-testid="design-summary">
            {review.summary}
          </p>
          <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2" aria-label="Scores">
            {DESIGN_RUBRIC.map((k) => (
              <li key={k} className="flex items-center justify-between gap-3 text-sm">
                <span>{DESIGN_RUBRIC_LABEL[k]}</span>
                <span aria-label={`${review.scores[k] ?? 0} out of 5`}>
                  <span aria-hidden="true">{ratingText(review.scores[k])}</span>
                </span>
              </li>
            ))}
          </ul>
          {review.findings.length > 0 && (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="Findings">
              {review.findings.map((f, i) => (
                <li key={i} className="grid gap-1" data-testid="design-finding">
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip tone={f.severity === "important" ? "hard" : "medium"}>
                      {f.severity === "important" ? "Important" : "Suggestion"}
                    </Chip>
                    <span className="text-xs text-ink-soft">{f.area.replace(/_/g, " ")}</span>
                  </span>
                  <span className="text-sm">
                    {f.message}
                    {f.nodeIds.length > 0 && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => onHighlight(f.nodeIds)}
                        >
                          Show on the canvas
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-1">
            <h3 className="pq-font-ui m-0 text-xs uppercase">An interviewer would ask next</h3>
            <ol className="m-0 pl-5 text-sm" data-testid="design-questions">
              {review.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}

/** The layered reference designs: v1 simple, v2 scaled, v3 global. They open after the learner has been reviewed. */
export function DesignReference({ slug }: { slug: string }) {
  const [ref, setRef] = useState<DesignReferenceDto | null>(null);
  const [layer, setLayer] = useState<"v1" | "v2" | "v3">("v1");
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setError(null);
    try {
      setRef(await api<DesignReferenceDto>(`/design/prompts/${slug}/reference`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The reference could not be loaded.");
    }
  };

  return (
    <section className="grid gap-3" aria-labelledby="dref-h" data-testid="design-reference">
      <h2 id="dref-h" className="pq-font-ui m-0 text-sm uppercase">
        Reference designs
      </h2>
      {!ref ? (
        <>
          <p className="m-0 text-sm text-ink-soft">
            Three layers of one answer, from a simple version to a global one. They open once your
            own design has been reviewed.
          </p>
          <div>
            <Button variant="ghost" onClick={() => void open()}>
              Show the reference
            </Button>
          </div>
          {error && (
            <p className="m-0 text-sm" role="status" data-testid="reference-locked">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Reference layer">
            {(["v1", "v2", "v3"] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={layer === v ? "primary" : "ghost"}
                role="tab"
                aria-selected={layer === v}
                onClick={() => setLayer(v)}
              >
                {ref[v].title}
              </Button>
            ))}
          </div>
          <p className="m-0 text-sm">{ref[layer].description}</p>
          <CanvasEditor
            canvas={ref[layer].canvas as DesignCanvas}
            readOnly
            label={`Reference design, ${ref[layer].title}`}
          />
        </>
      )}
    </section>
  );
}
