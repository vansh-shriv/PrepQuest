"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip, LoadingBar, Select, Textarea, Window } from "@prepquest/ui";
import {
  PEER_REPORT_REASONS,
  PEER_TOPIC_LABEL,
  type PeerFeedbackResult,
  type PeerSessionDetail,
} from "@prepquest/shared";
import { STATE_TEXT, clockText, reputationText, whenLabel } from "@/features/peer/peer-view";
import { api, apiDownload, ApiError } from "@/lib/api";
import { FormError } from "../auth/AuthCard";
import { Markdown } from "../problems/Markdown";

const POLL_MS = 5000;
const msg = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** `/peer/[id]`: one peer session: roles, the clock, the question card, the interviewer's panel, feedback. */
export function PeerSession({ id }: { id: string }) {
  const [s, setS] = useState<PeerSessionDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedAt = useRef(0);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const d = await api<PeerSessionDetail>(`/peer/sessions/${id}`);
      fetchedAt.current = Date.now();
      setS(d);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  // the clock runs on the server's numbers plus the time since they arrived; the page re-reads often
  const running = s?.state === "live" || s?.state === "scheduled";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const p = setInterval(() => void load(), POLL_MS);
    return () => {
      clearInterval(t);
      clearInterval(p);
    };
  }, [running, load]);

  const post = async (path: string, json: unknown = {}) => {
    setError(null);
    try {
      setS(await api<PeerSessionDetail>(`/peer/sessions/${id}/${path}`, { method: "POST", json }));
      fetchedAt.current = Date.now();
    } catch (err) {
      setError(msg(err, "Something went wrong."));
    }
  };

  const downloadIcs = async () => {
    try {
      const { blob, filename } = await apiDownload(`/peer/sessions/${id}/calendar.ics`, {
        method: "GET",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(msg(err, "Couldn't make the calendar file."));
    }
  };

  if (missing)
    return (
      <div className="grid max-w-md gap-3">
        <h1 className="pq-font-display m-0 text-base leading-relaxed">NOT FOUND</h1>
        <Link href="/peer" className="underline">
          Back to peer mocks
        </Link>
      </div>
    );
  if (!s) return <LoadingBar label="Loading the session" />;

  const sinceFetch = Date.now() - fetchedAt.current;
  const clock = s.clock;
  const halfLeft = clock ? clock.halfRemainingMs - sinceFetch : 0;
  const totalLeft = clock ? clock.remainingMs - sinceFetch : 0;

  return (
    <div className="grid max-w-4xl gap-5" data-testid="peer-session-page">
      <header className="grid gap-1">
        <Link href="/peer" className="pq-font-ui text-xs uppercase underline">
          Peer mocks
        </Link>
        <h1 className="pq-font-display m-0 text-base leading-relaxed">
          {PEER_TOPIC_LABEL[s.topic]} with {s.partner.handle}
        </h1>
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <span>
            {whenLabel(s.scheduledAt)}, {s.minutes} minutes
          </span>
          <Chip tone={s.state === "completed" ? "easy" : s.state === "no_show" ? "hard" : "info"}>
            <span data-testid="peer-state">{STATE_TEXT[s.state]}</span>
          </Chip>
        </p>
        <p className="m-0 text-sm" data-testid="partner-reputation">
          {s.partner.handle}: {reputationText(s.partner.reputation)}
        </p>
      </header>
      <FormError message={error} />

      {(s.state === "scheduled" || s.state === "live") && (
        <Window title={s.state === "live" ? "Session" : "Before you start"} tone="sky">
          <div className="grid gap-3">
            {s.state === "scheduled" && (
              <p className="m-0">
                You take turns: one half each, {s.minutes / 2} minutes every half.{" "}
                {s.youAreFirstCandidate
                  ? "You are the candidate first."
                  : "You are the interviewer first."}{" "}
                The room opens 10 minutes before the start. Meet on your own video call; the
                question and the clock are here.
              </p>
            )}
            {clock && (
              <div data-testid="peer-clock" className="grid gap-1">
                <p className="pq-font-pixel m-0 text-2xl">
                  Half {clock.half}: you are the{" "}
                  <strong data-testid="peer-role">{clock.you}</strong>
                </p>
                <p className="m-0">
                  <span data-testid="peer-half-left">{clockText(halfLeft)}</span> left in this half,{" "}
                  {clockText(totalLeft)} in all.
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {s.canOpen && (
                <Button onClick={() => void post("open")}>
                  {s.state === "live" ? "Rejoin" : "Open the room"}
                </Button>
              )}
              {s.state === "live" && (
                <Button variant="ghost" onClick={() => void post("complete")}>
                  End the session
                </Button>
              )}
              {s.canReportNoShow && (
                <Button variant="ghost" onClick={() => void post("no-show")}>
                  My partner did not come
                </Button>
              )}
              {s.canCancel && (
                <Button variant="ghost" onClick={() => void post("cancel")}>
                  Cancel the session
                </Button>
              )}
              <Button variant="ghost" onClick={() => void downloadIcs()}>
                Add to my calendar
              </Button>
            </div>
          </div>
        </Window>
      )}

      {s.state === "live" && s.question && (
        <Window title={clock?.you === "candidate" ? "Your question" : "The question you ask"}>
          <div data-testid="peer-question" className="grid gap-2">
            <h2 className="pq-font-ui m-0 text-sm uppercase">{s.question.title}</h2>
            <Markdown>{s.question.statementMd}</Markdown>
          </div>
        </Window>
      )}

      {s.panel && (
        <Window title="Interviewer panel (private)" tone="sun">
          <div data-testid="peer-panel" className="grid gap-3">
            <p className="m-0 text-sm">
              Only you can see this. Do not read it out; ask your own follow-ups.
            </p>
            {s.panel.reference.length > 0 && (
              <PanelList title="What a good answer covers" items={s.panel.reference} />
            )}
            {s.panel.followups.length > 0 && (
              <PanelList title="Follow-ups to try" items={s.panel.followups} />
            )}
            <PanelList title="Checklist" items={s.panel.rubric} />
          </div>
        </Window>
      )}

      {s.state !== "cancelled" && s.state !== "no_show" && <Consent s={s} onChange={post} />}

      {s.state === "completed" && (
        <>
          {s.questions && (
            <Window title="The two questions">
              <ol className="m-0 grid gap-2 pl-5" data-testid="peer-questions">
                {s.questions.map((q) => (
                  <li key={q.title}>{q.title}</li>
                ))}
              </ol>
            </Window>
          )}
          <Feedback s={s} onSent={load} />
        </>
      )}

      {s.state === "no_show" && (
        <p role="status" className="m-0" data-testid="peer-no-show">
          This session ended because a partner did not come. It counts in their record, not in
          yours.
        </p>
      )}

      <Safety s={s} onError={setError} onDone={load} />
    </div>
  );
}

function PanelList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="grid gap-1">
      <h3 className="pq-font-ui m-0 text-xs uppercase">{title}</h3>
      <ul className="m-0 grid gap-1 pl-5">
        {items.map((i, n) => (
          <li key={n}>{i}</li>
        ))}
      </ul>
    </section>
  );
}

function Consent({
  s,
  onChange,
}: {
  s: PeerSessionDetail;
  onChange: (path: string, json: unknown) => Promise<void>;
}) {
  return (
    <Window title="AI summary (optional)">
      <div className="grid gap-2" data-testid="peer-consent">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={s.consent.you}
            onChange={(e) => void onChange("consent", { ai: e.target.checked })}
          />
          <span>
            I agree to an AI summary of this session. It happens only when both of us agree, and
            nothing is recorded.
          </span>
        </label>
        <p className="m-0 text-sm text-ink-soft" role="status">
          {s.consent.both
            ? "Both of you agreed."
            : s.consent.partner
              ? `${s.partner.handle} agreed. Waiting for you.`
              : "Without both of you agreeing, nothing is analysed."}
        </p>
      </div>
    </Window>
  );
}

function Feedback({ s, onSent }: { s: PeerSessionDetail; onSent: () => Promise<void> }) {
  const [ratings, setRatings] = useState({ punctuality: 4, helpfulness: 4, preparedness: 4 });
  const [comments, setComments] = useState("");
  const [nudges, setNudges] = useState<PeerFeedbackResult["nudges"]>([]);
  const [error, setError] = useState<string | null>(null);

  if (s.feedbackGiven) {
    return (
      <Window title="Feedback" tone="olive">
        <div className="grid gap-2" data-testid="peer-feedback-done">
          <p className="m-0">You sent your feedback.</p>
          {s.feedbackFromPartner ? (
            <div data-testid="peer-feedback-received">
              <h3 className="pq-font-ui m-0 text-xs uppercase">What {s.partner.handle} wrote</h3>
              <p className="m-0 whitespace-pre-wrap">{s.feedbackFromPartner.comments}</p>
            </div>
          ) : (
            <p className="m-0 text-sm text-ink-soft">
              {s.partner.handle}&apos;s feedback shows here once they have sent it.
            </p>
          )}
        </div>
      </Window>
    );
  }

  const send = async (confirmed: boolean) => {
    setError(null);
    try {
      const res = await api<PeerFeedbackResult>(`/peer/sessions/${s.id}/feedback`, {
        method: "POST",
        json: { ratings, comments, confirmed },
      });
      setNudges(res.nudges);
      if (res.saved) await onSent();
    } catch (err) {
      setError(msg(err, "Couldn't send the feedback."));
    }
  };

  const labels = {
    punctuality: "Punctuality",
    helpfulness: "Helpfulness",
    preparedness: "Preparedness",
  };
  return (
    <Window title="Feedback for your partner">
      <div className="grid gap-3" data-testid="peer-feedback">
        <p className="m-0 text-sm">
          Your partner sees this once they have written theirs. Be specific and kind.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(labels) as (keyof typeof labels)[]).map((k) => (
            <Select
              key={k}
              label={labels[k]}
              value={ratings[k]}
              onChange={(e) => setRatings({ ...ratings, [k]: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} of 5
                </option>
              ))}
            </Select>
          ))}
        </div>
        <Textarea
          label="What went well, and what to change?"
          rows={5}
          value={comments}
          onChange={(e) => {
            setComments(e.target.value);
            setNudges([]);
          }}
        />
        <FormError message={error} />
        {nudges.length > 0 && (
          <div role="status" data-testid="peer-nudges" className="grid gap-1">
            {nudges.map((n) => (
              <p key={n.code} className="m-0">
                {n.message}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {nudges.length === 0 ? (
            <Button onClick={() => void send(false)}>Send feedback</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setNudges([])}>
                Let me improve it
              </Button>
              <Button onClick={() => void send(true)}>Send it as it is</Button>
            </>
          )}
        </div>
      </div>
    </Window>
  );
}

function Safety({
  s,
  onError,
  onDone,
}: {
  s: PeerSessionDetail;
  onError: (m: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof PEER_REPORT_REASONS)[number]>("abuse");
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);

  const report = async () => {
    onError(null);
    try {
      await api("/peer/report", {
        method: "POST",
        json: { userId: s.partner.userId, sessionId: s.id, reason, details },
      });
      setSent(true);
      setOpen(false);
    } catch (err) {
      onError(msg(err, "Couldn't send the report."));
    }
  };
  const block = async () => {
    onError(null);
    try {
      await api("/peer/blocks", { method: "POST", json: { userId: s.partner.userId } });
      await onDone();
    } catch (err) {
      onError(msg(err, "Couldn't block this person."));
    }
  };

  return (
    <section className="grid gap-2" aria-labelledby="safety-h" data-testid="peer-safety">
      <h2 id="safety-h" className="pq-font-ui m-0 text-sm uppercase">
        Safety
      </h2>
      <p className="m-0 text-sm text-ink-soft">
        You can leave any time. A report goes to people who review it; nothing happens to anyone
        automatically.
      </p>
      {sent && (
        <p role="status" className="m-0" data-testid="peer-report-sent">
          Thank you. The report was sent.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          Report {s.partner.handle}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void block()}>
          Block {s.partner.handle}
        </Button>
      </div>
      {open && (
        <div className="grid max-w-md gap-2">
          <Select
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as typeof reason)}
          >
            {PEER_REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </Select>
          <Textarea
            label="What happened?"
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
          <div>
            <Button size="sm" onClick={() => void report()}>
              Send the report
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
