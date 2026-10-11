"use client";

import { useEffect } from "react";
import { Button, Checkbox, Select } from "@prepquest/ui";
import { SILENCE_CHOICES, type useVoice } from "@/features/interview/voice/use-voice";

type Voice = ReturnType<typeof useVoice>;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable);

/**
 * Voice controls: push-to-talk (hold the button or Space), hands-free, captions that are always on,
 * and the settings that matter. Typing keeps working: a mixed interview is the default experience.
 */
export function VoiceBar({ voice, disabled }: { voice: Voice; disabled: boolean }) {
  const { mode, listening, speaking, caption, error } = voice;

  // Space holds the mic in push-to-talk mode (not while typing in a field)
  useEffect(() => {
    if (disabled || mode !== "ptt") return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      voice.pressToTalk();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) voice.releaseToTalk();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [disabled, mode, voice]);

  const status = disabled
    ? "Voice is paused."
    : speaking
      ? "Interviewer is speaking. Talk to cut in."
      : listening
        ? "Listening..."
        : mode === "ptt"
          ? "Hold the button or press and hold Space to talk."
          : "Waiting for you to speak.";

  return (
    <div
      className="grid gap-2 border-t-[3px] border-ink bg-surface px-3 py-2"
      data-testid="voice-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Voice mode" className="flex gap-1">
          <Button
            size="sm"
            variant={mode === "ptt" ? "accent" : "ghost"}
            aria-pressed={mode === "ptt"}
            onClick={() => voice.setMode("ptt")}
          >
            Push to talk
          </Button>
          <Button
            size="sm"
            variant={mode === "handsfree" ? "accent" : "ghost"}
            aria-pressed={mode === "handsfree"}
            onClick={() => voice.setMode("handsfree")}
          >
            Hands-free
          </Button>
        </div>
        {mode === "ptt" && (
          <button
            type="button"
            className="pq-btn pq-btn--accent"
            data-testid="ptt"
            data-listening={listening ? "true" : undefined}
            disabled={disabled || !voice.support.recognition}
            aria-pressed={listening}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId); // keeps the release even if the pointer drifts off
              } catch {
                /* synthetic or unsupported pointer: the press still works */
              }
              voice.pressToTalk();
            }}
            onPointerUp={() => voice.releaseToTalk()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
                e.preventDefault();
                voice.pressToTalk();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === "Enter" || e.key === " ") voice.releaseToTalk();
            }}
          >
            {listening ? "Release to send" : "Hold to talk"}
          </button>
        )}
        <span
          role="status"
          aria-live="polite"
          className="pq-font-pixel text-lg text-ink-soft"
          data-testid="voice-status"
        >
          {status}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          <Checkbox
            label="Read replies aloud"
            checked={voice.ttsOn}
            onChange={(e) => voice.setTtsOn(e.target.checked)}
          />
          {voice.speaking && (
            <Button size="sm" variant="ghost" onClick={() => voice.cancelSpeech()}>
              Skip
            </Button>
          )}
        </span>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer">Voice settings</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <Select
            label="Speaking speed"
            value={String(voice.rate)}
            onChange={(e) => voice.setRate(Number(e.target.value))}
          >
            <option value="0.85">Slower</option>
            <option value="1">Normal</option>
            <option value="1.2">Faster</option>
          </Select>
          <Select
            label="Pause that ends your turn"
            value={String(voice.silenceMs)}
            onChange={(e) => voice.setSilenceMs(Number(e.target.value))}
            helper="Hands-free only."
          >
            {SILENCE_CHOICES.map((ms) => (
              <option key={ms} value={ms}>
                {ms / 1000} s
              </option>
            ))}
          </Select>
          <Checkbox
            label="I'm wearing headphones"
            helper="Lets you interrupt the interviewer in hands-free mode."
            checked={voice.headphones}
            onChange={(e) => voice.setHeadphones(e.target.checked)}
          />
        </div>
      </details>

      <p
        className="m-0 min-h-[1.5em] border-l-[3px] border-ink pl-3 text-sm"
        aria-live="off"
        data-testid="captions"
      >
        {caption ? (
          <>You: {caption}</>
        ) : (
          <span className="text-ink-soft">Captions appear here as you speak.</span>
        )}
      </p>
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          ! {error}{" "}
          <button type="button" className="underline" onClick={voice.clearError}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
