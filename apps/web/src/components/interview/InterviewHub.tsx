"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Chip, LoadingBar, Sprite, Window, buttonClasses } from "@prepquest/ui";
import type { InterviewListItemDto, ResumeDto } from "@prepquest/shared";
import { BAND_TONE, END_REASON_TEXT, PERSONA_LABEL } from "@/features/interview/format";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";

type Access = "checking" | "allowed" | "unverified" | "error";

/** AI interviews cost money per session, so they require a verified email. */
export function InterviewHub() {
  const { user } = useAuth();
  const [access, setAccess] = useState<Access>("checking");
  const [sent, setSent] = useState(false);
  const [items, setItems] = useState<InterviewListItemDto[] | null>(null);
  const [resumes, setResumes] = useState<ResumeDto[] | null>(null);

  useEffect(() => {
    api("/interviews/access")
      .then(() => setAccess("allowed"))
      .catch((err: unknown) =>
        setAccess(
          err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED" ? "unverified" : "error",
        ),
      );
  }, [user?.emailVerified]);

  useEffect(() => {
    if (access !== "allowed") return;
    api<{ items: InterviewListItemDto[] }>("/interviews")
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
    api<{ items: ResumeDto[] }>("/resumes")
      .then((r) => setResumes(r.items))
      .catch(() => setResumes([]));
  }, [access]);

  const resend = useSubmit(async () => {
    await api("/auth/resend-verification", { method: "POST", json: {} });
    setSent(true);
  });

  const live = items?.find(
    (i) => i.state !== "COMPLETED" && i.state !== "ABANDONED" && i.state !== "FAILED" && !i.endedAt,
  );

  return (
    <div className="grid max-w-4xl gap-6">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Boss fights</h1>

      {access === "checking" && <LoadingBar label="Checking access" />}

      {access === "unverified" && (
        <Window title="Verify your email" tone="sun">
          <p className="mt-0">
            AI mock interviews unlock once your email is verified. Check your inbox for the link
            {sent ? " (a new one is on its way)" : ""}.
          </p>
          {resend.error && (
            <p role="alert" className="text-danger">
              ! {resend.error}
            </p>
          )}
          <Button size="sm" loading={resend.pending} onClick={() => void resend.run()}>
            Resend link
          </Button>
        </Window>
      )}

      {access === "allowed" && (
        <>
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <Window title="Mock interviews" tone="sky">
              <div className="flex flex-wrap items-center gap-4">
                <Sprite name="interviewer" scale={5} label="Interviewer" />
                <div className="grid flex-1 gap-2">
                  <p className="m-0">
                    A live DSA round with a real judge, or a deep-dive into your own projects. You
                    get a scorecard with evidence, a transcript with notes, and next steps.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {live ? (
                      <Link
                        href={`/interview/${live.id}`}
                        className={buttonClasses({ variant: "accent" })}
                      >
                        Continue interview
                      </Link>
                    ) : (
                      <Link
                        href="/interview/new"
                        className={buttonClasses({ variant: "accent" })}
                        data-testid="new-interview"
                      >
                        New interview
                      </Link>
                    )}
                    <Link href="/resumes" className={buttonClasses({ variant: "ghost" })}>
                      Resumes
                      {resumes ? ` (${resumes.filter((r) => r.status === "ready").length})` : ""}
                    </Link>
                  </div>
                </div>
              </div>
            </Window>
          </div>

          <section aria-label="Past interviews" className="grid gap-3">
            <h2 className="pq-font-ui m-0 text-base uppercase">Your interviews</h2>
            {items === null ? (
              <LoadingBar label="Loading" />
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Sprite name="dino" scale={6} label="Dino" />
                <p className="pq-font-pixel m-0 text-2xl">NO BOSS FIGHTS YET. START ONE!</p>
              </div>
            ) : (
              <ul className="m-0 grid list-none gap-3 p-0">
                {items.map((i) => {
                  const running = !i.endedAt && i.state !== "SETUP";
                  return (
                    <li
                      key={i.id}
                      className="pq-box flex flex-wrap items-center justify-between gap-3 bg-surface p-3"
                      data-testid="interview-row"
                    >
                      <div className="grid gap-1">
                        <strong>{i.title}</strong>
                        <span className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                          {PERSONA_LABEL[i.persona] ?? i.persona} · {i.difficulty}/5 ·{" "}
                          {new Date(i.createdAt).toLocaleString()}
                          {i.endReason && (
                            <Chip>{END_REASON_TEXT[i.endReason] ?? i.endReason}</Chip>
                          )}
                        </span>
                      </div>
                      <span className="flex items-center gap-3">
                        {i.scorecardStatus === "ready" && i.overall !== null && (
                          <>
                            <span className="pq-font-display text-lg">{i.overall}</span>
                            {i.band && <Chip tone={BAND_TONE[i.band] ?? "info"}>{i.band}</Chip>}
                          </>
                        )}
                        {i.scorecardStatus === "generating" && <Chip>scoring...</Chip>}
                        {i.scorecardStatus === "failed" && <Chip tone="hard">scoring failed</Chip>}
                        <Link
                          href={running ? `/interview/${i.id}` : `/interview/${i.id}/review`}
                          className={buttonClasses({
                            size: "sm",
                            variant: running ? "accent" : "ghost",
                          })}
                        >
                          {running ? "Continue" : "Review"}
                        </Link>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {access === "error" && (
        <Window title="Error" tone="danger">
          Couldn&apos;t check your access. Try again in a moment.
        </Window>
      )}
    </div>
  );
}
