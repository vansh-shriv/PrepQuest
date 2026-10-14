"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Chip,
  Dialog,
  InterviewTimer,
  InterviewerAvatar,
  LoadingBar,
  Sprite,
  Window,
  buttonClasses,
} from "@prepquest/ui";
import type { InterviewSessionDto } from "@prepquest/shared";
import { PERSONA_HELP, PERSONA_LABEL, PERSONA_NAME } from "@/features/interview/format";
import { useInterviewRoom } from "@/features/interview/use-interview-room";
import { useSubmit } from "@/lib/use-submit";
import { SplitPane } from "../problems/SplitPane";
import { useVoice } from "@/features/interview/voice/use-voice";
import { Chat } from "./Chat";
import { MicCheck } from "./MicCheck";
import { VoiceBar } from "./VoiceBar";
import { CodePanel } from "./CodePanel";
import { DesignBoard } from "./DesignBoard";

const LIVE_STATES = new Set([
  "WARMUP",
  "PROBLEM",
  "CLARIFY",
  "APPROACH",
  "CODING",
  "TESTING",
  "OPTIMIZE",
  "FOLLOWUP",
  "WRAPUP",
  "ENDING",
]);

const VERBAL_LABEL: Record<string, string> = {
  cs: "CS fundamentals",
  behavioral: "Behavioural",
  hld: "System design",
  lld: "Low-level design",
};

function currentProblemSlug(s: InterviewSessionDto): string | null {
  const q = s.questions[s.questionIndex];
  return q && !q.hidden && q.kind === "problem" ? q.slug : null;
}

export function InterviewRoom({ id }: { id: string }) {
  const r = useInterviewRoom(id);
  const { session, room } = r;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [mobile, setMobile] = useState<"left" | "right">("left");
  const begin = useSubmit(async () => r.start());

  // voice: replies are read aloud once they are final, and what the candidate says becomes a message
  const wantsVoice = session !== null && session.mode !== "text";
  const voice = useVoice({
    enabled: wantsVoice,
    onUtterance: (u) => void r.send(u.text, undefined, { words: u.words }),
    onBargeIn: (turnId, charIndex) => void r.bargeIn(turnId, charIndex),
  });
  const spoken = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!wantsVoice || !room.live) return;
    const replies = room.items.filter((i) => i.speaker === "interviewer");
    if (spoken.current === null) {
      // what was already said before this page loaded is not read out again
      spoken.current = new Set(replies.map((i) => i.key));
      return;
    }
    for (const item of replies) {
      if (item.streaming || item.seq === null || spoken.current.has(item.key)) continue;
      spoken.current.add(item.key);
      voice.speak(item.key, item.text);
    }
  }, [wantsVoice, room.items, room.live, voice]);

  // keep the tab title useful when the user switches to the editor
  useEffect(() => {
    if (session) document.title = `${session.title} - PrepQuest`;
  }, [session]);

  if (r.loadError) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <Sprite name="dino" scale={6} label="Dino" />
        <p className="m-0">
          {r.loadError === "not_found"
            ? "This interview doesn't exist."
            : "Couldn't load the interview."}
        </p>
        <Link href="/interview" className="underline">
          Back to interviews
        </Link>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="mx-auto max-w-xs py-24">
        <LoadingBar label="Loading interview" />
      </div>
    );
  }

  if (session.state === "SETUP") {
    return (
      <Briefing
        session={session}
        onBegin={() => void begin.run()}
        pending={begin.pending}
        error={begin.error}
      />
    );
  }

  const ended = session.endedAt !== null || room.ended !== null;
  const live = room.live;
  const paused = live?.paused ?? session.paused;
  const typing = room.typing;
  const slug = currentProblemSlug(session);
  const name = PERSONA_NAME[session.persona] ?? "Interviewer";
  const enabled = !ended && !paused && LIVE_STATES.has(live?.state ?? session.state);

  const chat = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[3px] border-ink bg-surface px-3 py-2">
        <InterviewerAvatar
          name={name}
          subtitle={PERSONA_LABEL[session.persona]}
          state={typing ? "typing" : "idle"}
        />
        <InterviewTimer
          remainingMs={r.remainingMs}
          totalMs={session.minutes * 60_000}
          segments={session.segments}
          paused={paused}
        />
      </div>
      {r.connection === "offline" && !ended && (
        <p role="status" className="m-0 bg-sun px-3 py-1 text-sm text-[var(--on-coin)]">
          Reconnecting... You can keep typing; messages are sent over the fallback channel. The
          clock keeps running.
        </p>
      )}
      <Chat
        items={room.items}
        enabled={enabled}
        disabledReason={
          ended
            ? "The interview is over."
            : paused
              ? "Paused. Resume to continue."
              : "Wait for the interviewer."
        }
        hintsLeft={live?.hintsLeft ?? session.hintsLeft}
        hintButton={session.type === "dsa" && session.hintBudget > 0}
        error={room.error}
        onSend={r.send}
        onDismissError={r.clearError}
        aboveComposer={
          wantsVoice && voice.support.recognition ? (
            <VoiceBar voice={voice} disabled={!enabled} />
          ) : null
        }
      />
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b-[3px] border-ink bg-surface-alt px-3 py-2">
      <strong className="pq-font-ui text-sm uppercase">{session.title}</strong>
      <Chip>{PERSONA_LABEL[session.persona] ?? session.persona}</Chip>
      <span className="pq-font-pixel text-lg text-ink-soft" data-testid="interview-state">
        {(live?.state ?? session.state).toLowerCase()}
        {live && live.questionCount > 1
          ? ` · question ${live.questionIndex + 1}/${live.questionCount}`
          : ""}
      </span>
      <span className="ml-auto flex flex-wrap gap-2">
        {(session.type === "dsa" || session.usesCanvas) && (
          <span className="md:hidden">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMobile((m) => (m === "left" ? "right" : "left"))}
            >
              {mobile === "left" ? (session.usesCanvas ? "Show board" : "Show code") : "Show chat"}
            </Button>
          </span>
        )}
        {!ended && !session.realistic && (
          <Button
            size="sm"
            variant="ghost"
            disabled={!paused && session.pausesUsed >= 1}
            onClick={() => void r.control(paused ? "resume" : "pause")}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        )}
        {!ended && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(true)}>
            End interview
          </Button>
        )}
      </span>
    </div>
  );

  return (
    <div
      className="flex h-[calc(100dvh-57px-56px)] min-h-[480px] flex-col md:h-[calc(100dvh-57px)]"
      data-testid="interview-room"
    >
      {header}
      {ended && (
        <Finished
          sessionId={id}
          reason={room.ended?.reason ?? session.endReason}
          scorecardReady={room.scorecardReady}
        />
      )}
      {session.type === "dsa" && slug ? (
        <SplitPane
          storageKey="pq:interview-split"
          mobileView={mobile}
          left={chat}
          right={
            <CodePanel sessionId={id} slug={slug} sendEvent={r.codeEvent} disabled={!enabled} />
          }
        />
      ) : session.usesCanvas ? (
        <SplitPane
          storageKey="pq:interview-board-split"
          mobileView={mobile}
          left={
            <div className="flex min-h-0 flex-1 flex-col">
              <ProjectFocus session={session} />
              {chat}
            </div>
          }
          right={<DesignBoard sessionId={id} sendEvent={r.codeEvent} disabled={!enabled} />}
        />
      ) : session.type === "dsa" ? (
        <div className="flex min-h-0 flex-1 flex-col">{chat}</div>
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col border-x-[3px] border-ink">
          <ProjectFocus session={session} />
          {chat}
        </div>
      )}

      <Dialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End the interview?"
        tone="coin"
      >
        <p className="mt-0">
          You&apos;ll get a scorecard for what you covered so far. Ending early is noted in the
          report.
        </p>
        <div className="flex gap-2">
          <Button
            variant="accent"
            onClick={() => {
              setConfirmEnd(false);
              void r.control("end");
            }}
          >
            End and get my scorecard
          </Button>
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
            Keep going
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** Which resume item the current project question is about (shown for transparency, doc 03 I3). */
function ProjectFocus({ session }: { session: InterviewSessionDto }) {
  const q = session.questions[session.questionIndex];
  if (!q || q.hidden || q.kind === "problem") return null;
  const total = session.questions.length;
  return (
    <p className="m-0 border-b-[3px] border-ink bg-surface px-3 py-1 text-sm text-ink-soft">
      {q.kind === "verbal" ? (
        <>
          {VERBAL_LABEL[q.category] ?? "Question"}
          {total > 1 ? `, question ${session.questionIndex + 1} of ${total}` : ""}: {q.title}
        </>
      ) : (
        <>
          Topic from your resume: <code>{q.sourceRef}</code>
        </>
      )}
    </p>
  );
}

function Finished({
  sessionId,
  reason,
  scorecardReady,
}: {
  sessionId: string;
  reason: string | null;
  scorecardReady: boolean;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 bg-sun px-3 py-2 text-[var(--on-coin)]"
      data-testid="interview-finished"
    >
      <span>
        {reason === "timer"
          ? "Time's up. "
          : reason === "abuse"
            ? "The interviewer ended the session. "
            : ""}
        The interview is over.{" "}
        {scorecardReady ? "Your scorecard is ready." : "Your scorecard is being prepared."}
      </span>
      <Link
        href={`/interview/${sessionId}/review`}
        className={buttonClasses({ size: "sm", variant: "accent" })}
      >
        {scorecardReady ? "See my scorecard" : "Open the review"}
      </Link>
    </div>
  );
}

function Briefing({
  session,
  onBegin,
  pending,
  error,
}: {
  session: InterviewSessionDto;
  onBegin: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="grid max-w-2xl gap-5">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Ready for {session.title}?</h1>
      <Window title="Briefing" tone="sky">
        <ul className="m-0 grid gap-2 pl-5">
          <li>
            <strong>{session.minutes} minutes</strong>, kept by the server. Closing the tab
            doesn&apos;t stop the clock.
          </li>
          <li>
            Interviewer: <strong>{PERSONA_NAME[session.persona]}</strong>,{" "}
            {PERSONA_LABEL[session.persona]?.toLowerCase()}. {PERSONA_HELP[session.persona]}
          </li>
          <li>
            {session.type === "dsa"
              ? `Hints: ${session.hintBudget} available. Each one is noted in your report. Problem hints and editorials are switched off for the duration.`
              : session.type === "project" || session.type === "resume"
                ? "Questions come from your resume. Be ready to explain decisions, trade-offs and numbers."
                : session.type === "behavioral"
                  ? "Tell real stories: what the situation was, what you did yourself, and the result."
                  : session.type === "cs"
                    ? "Short fundamentals questions. Explain simply, then give an example."
                    : session.usesCanvas
                      ? "A design discussion with a drawing board. The interviewer sees what you draw: state requirements, sketch the components and talk through the trade-offs."
                      : "A text-based design discussion. State requirements and trade-offs as you go."}
          </li>
          <li>
            {session.realistic
              ? "Realistic mode: no pausing."
              : "Practice mode: you can pause once for up to 3 minutes."}
          </li>
          <li>Leaving the tab or pasting large code is recorded and can appear in your review.</li>
        </ul>
      </Window>
      {session.mode !== "text" && <MicCheck onResult={() => undefined} />}
      {error && (
        <p role="alert" className="m-0 text-danger">
          ! {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button variant="accent" loading={pending} onClick={onBegin}>
          Begin interview
        </Button>
        <Link href="/interview" className={buttonClasses({ variant: "ghost" })}>
          Not now
        </Link>
      </div>
    </div>
  );
}
