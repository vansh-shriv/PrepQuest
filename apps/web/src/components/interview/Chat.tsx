"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, ChatBubble } from "@prepquest/ui";
import { clock } from "@/features/interview/format";
import type { ChatItem } from "@/features/interview/room-state";

const MAX_CHARS = 2000;

export interface ChatProps {
  items: ChatItem[];
  /** Candidate can type (the interview is live and not paused). */
  enabled: boolean;
  disabledReason?: string;
  hintsLeft: number;
  /** DSA interviews offer a hint button. */
  hintButton: boolean;
  error: string | null;
  onSend: (text: string, retryId?: string) => Promise<{ ok: boolean }>;
  onDismissError: () => void;
}

/** The transcript (a live region) and the message box. Enter sends, Shift+Enter adds a line. */
export function Chat({
  items,
  enabled,
  disabledReason,
  hintsLeft,
  hintButton,
  error,
  onSend,
  onDismissError,
}: ChatProps) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // follow new text unless the user scrolled up to read
  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [items]);

  const send = async (text: string, retryId?: string) => {
    const clean = text.trim();
    if (!clean || !enabled) return;
    if (!retryId) setDraft("");
    await onSend(clean, retryId);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        role="log"
        aria-label="Interview conversation"
        aria-live="polite"
        data-testid="chat-log"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="grid min-h-0 flex-1 content-start gap-3 overflow-auto p-3"
      >
        {items.length === 0 && (
          <p className="m-0 text-ink-soft">The interviewer will start in a moment...</p>
        )}
        {items.map((item) => (
          <div key={item.key} data-testid={`msg-${item.speaker}`}>
            <ChatBubble
              who={item.speaker}
              streaming={item.streaming}
              hint={item.hint}
              time={item.offsetMs !== null ? clock(item.offsetMs) : undefined}
            >
              {item.text}
            </ChatBubble>
            {item.pending && (
              <p className="pq-font-pixel m-0 mt-1 text-right text-sm text-ink-soft">sending...</p>
            )}
            {item.failed && (
              <p className="m-0 mt-1 text-right text-sm text-danger">
                Not delivered.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void send(item.text, item.key)}
                >
                  Try again
                </button>
              </p>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && (
        <p
          role="alert"
          className="m-0 flex items-center justify-between gap-2 bg-danger px-3 py-1 text-sm text-on-danger"
        >
          <span>! {error}</span>
          <button type="button" className="underline" onClick={onDismissError}>
            Dismiss
          </button>
        </p>
      )}

      <div className="grid gap-2 border-t-[3px] border-ink bg-surface-alt p-3">
        <label className="pq-label" htmlFor="chat-input">
          Your answer
        </label>
        <textarea
          id="chat-input"
          value={draft}
          maxLength={MAX_CHARS}
          disabled={!enabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          rows={3}
          placeholder={
            enabled
              ? "Type your answer. Enter sends, Shift+Enter adds a line."
              : (disabledReason ?? "")
          }
          className="pq-input"
          style={{ height: "auto", resize: "vertical" }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="pq-font-pixel text-base text-ink-soft">
            {draft.length}/{MAX_CHARS}
          </span>
          <span className="flex gap-2">
            {hintButton && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!enabled || hintsLeft <= 0}
                onClick={() => void send("Could I get a hint, please?")}
                title={hintsLeft > 0 ? "Ask the interviewer for a nudge" : "No hints left"}
              >
                Hint ({hintsLeft})
              </Button>
            )}
            <Button
              size="sm"
              variant="accent"
              disabled={!enabled || draft.trim() === ""}
              onClick={() => void send(draft)}
            >
              Send
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
