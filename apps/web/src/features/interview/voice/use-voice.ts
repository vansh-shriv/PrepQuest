"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speakableText } from "@prepquest/interview-core";
import {
  UtteranceBuffer,
  approximateWords,
  mapSpokenToOriginal,
  speechSupport,
  splitForSpeech,
  type RecognitionPiece,
  type SpeechSupport,
} from "./speech";

// Browser speech for interviews (doc 03 I5): recognition (push-to-talk or hands-free with a silence
// timer), text-to-speech of finished interviewer replies, barge-in and captions. The Web Speech API is
// the MVP engine; its transcripts are final text only (no word times), so timing is approximate.

interface RecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface RecognitionEventLike {
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

interface SpeechWindow {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
  speechSynthesis?: SpeechSynthesis;
}

export type VoiceMode = "ptt" | "handsfree";

export interface Utterance {
  text: string;
  words: { w: string; startMs: number; endMs: number }[];
}

export interface VoiceOptions {
  /** Voice is switched on for this interview (and the browser allows it). */
  enabled: boolean;
  onUtterance: (u: Utterance) => void;
  /** The candidate cut a reply short; `charIndex` is a position in the original reply text. */
  onBargeIn: (turnId: string, charIndex: number) => void;
}

interface Speaking {
  turnId: string;
  original: string;
  spoken: string;
  /** Chunks still to say, with their offsets in `spoken`. */
  queue: { text: string; offset: number }[];
  charIndex: number;
}

const SILENCE_CHOICES = [500, 800, 1200, 2000] as const;
export { SILENCE_CHOICES };

export function useVoice({ enabled, onUtterance, onBargeIn }: VoiceOptions) {
  const [support] = useState<SpeechSupport>(() =>
    typeof window === "undefined"
      ? { recognition: false, synthesis: false }
      : speechSupport(window as SpeechWindow),
  );
  const [mode, setModeState] = useState<VoiceMode>("ptt");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ttsOn, setTtsOn] = useState(true);
  const [rate, setRate] = useState(1);
  const [silenceMs, setSilenceMs] = useState<number>(800);
  const [headphones, setHeadphones] = useState(false);

  const recRef = useRef<RecognitionLike | null>(null);
  const want = useRef(false);
  const buffer = useRef(new UtteranceBuffer());
  const baseIndex = useRef(0);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<Speaking | null>(null);
  const speakingRef = useRef(false);
  const modeRef = useRef<VoiceMode>("ptt");
  const settings = useRef({ ttsOn, rate, silenceMs, headphones });
  settings.current = { ttsOn, rate, silenceMs, headphones };
  const cb = useRef({ onUtterance, onBargeIn });
  cb.current = { onUtterance, onBargeIn };
  modeRef.current = mode;

  const flush = useCallback(() => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
    const done = buffer.current.flush();
    setCaption("");
    if (!done) return;
    cb.current.onUtterance({
      text: done.text,
      words: approximateWords(done.text, 0, Math.max(done.endMs - done.startMs, 1)),
    });
  }, []);

  // ---------------------------------------------------------------- speaking (TTS)

  const sayNext = useCallback(() => {
    const synth = (window as SpeechWindow).speechSynthesis;
    const cur = current.current;
    if (!synth || !cur) return;
    const chunk = cur.queue.shift();
    if (!chunk) {
      current.current = null;
      speakingRef.current = false;
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(chunk.text);
    u.rate = settings.current.rate;
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("en"));
    if (voice) u.voice = voice;
    u.onboundary = (e) => {
      if (current.current === cur) cur.charIndex = chunk.offset + e.charIndex;
    };
    u.onend = () => {
      if (current.current === cur) {
        cur.charIndex = chunk.offset + chunk.text.length;
        sayNext();
      }
    };
    u.onerror = () => {
      if (current.current === cur) sayNext();
    };
    speakingRef.current = true;
    setSpeaking(true);
    synth.speak(u);
  }, []);

  /** Stops speaking now; returns how far it got, for the barge-in record. */
  const cancelSpeech = useCallback((): { turnId: string; charIndex: number } | null => {
    const synth = (window as SpeechWindow).speechSynthesis;
    const cur = current.current;
    current.current = null;
    speakingRef.current = false;
    setSpeaking(false);
    synth?.cancel();
    if (!cur) return null;
    return {
      turnId: cur.turnId,
      charIndex: mapSpokenToOriginal(cur.charIndex, cur.spoken.length, cur.original.length),
    };
  }, []);

  const queued = useRef<{ turnId: string; text: string }[]>([]);

  /** Starts the next queued reply if nothing is being said. */
  const pump = useCallback(() => {
    while (!speakingRef.current) {
      const next = queued.current.shift();
      if (!next) return;
      const spoken = speakableText(next.text);
      if (!spoken) continue;
      current.current = {
        turnId: next.turnId,
        original: next.text,
        spoken,
        queue: splitForSpeech(spoken),
        charIndex: 0,
      };
      sayNext();
    }
  }, [sayNext]);

  const speak = useCallback(
    (turnId: string, text: string) => {
      if (!enabled || !support.synthesis || !settings.current.ttsOn) return;
      queued.current.push({ turnId, text });
      pump();
    },
    [enabled, support.synthesis, pump],
  );

  // when one reply finishes, the next queued one starts
  useEffect(() => {
    if (!speaking && enabled) pump();
  }, [speaking, enabled, pump]);

  // ---------------------------------------------------------------- listening (STT)

  const bargeIn = useCallback(() => {
    const cut = cancelSpeech();
    queued.current = [];
    if (cut) cb.current.onBargeIn(cut.turnId, cut.charIndex);
  }, [cancelSpeech]);

  const ensureRecognition = useCallback((): RecognitionLike | null => {
    if (recRef.current) return recRef.current;
    const w = window as SpeechWindow;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      const pieces: RecognitionPiece[] = [];
      for (let i = baseIndex.current; i < e.results.length; i++) {
        const r = e.results[i]!;
        pieces.push({ text: r[0]?.transcript ?? "", final: r.isFinal });
      }
      buffer.current.push(pieces, performance.now());
      setCaption(buffer.current.caption);
      // talking over the interviewer: push-to-talk always cuts in, hands-free only with headphones
      if (
        speakingRef.current &&
        buffer.current.hasSpeech &&
        (modeRef.current === "ptt" || settings.current.headphones)
      ) {
        bargeIn();
      }
      if (modeRef.current === "handsfree") {
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        silenceTimer.current = setTimeout(() => {
          baseIndex.current = e.results.length;
          flush();
        }, settings.current.silenceMs);
      }
    };
    rec.onend = () => {
      baseIndex.current = 0;
      if (modeRef.current === "ptt" || !want.current) {
        flush();
        setListening(false);
      }
      if (want.current) {
        try {
          rec.start(); // the browser ends long sessions on its own: keep listening
          setListening(true);
        } catch {
          setListening(false);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      want.current = false;
      setListening(false);
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "The microphone is blocked. Allow it in the address bar, or keep typing."
          : e.error === "network"
            ? "Speech recognition needs a network connection right now. You can keep typing."
            : "Speech recognition stopped. You can keep typing.",
      );
    };
    recRef.current = rec;
    return rec;
  }, [bargeIn, flush]);

  const startListening = useCallback(() => {
    if (!enabled || !support.recognition) return;
    const rec = ensureRecognition();
    if (!rec) return;
    setError(null);
    want.current = true;
    baseIndex.current = 0;
    try {
      rec.start();
      setListening(true);
    } catch {
      /* already started */
    }
  }, [enabled, support.recognition, ensureRecognition]);

  const stopListening = useCallback(() => {
    want.current = false;
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    try {
      recRef.current?.stop();
    } catch {
      /* not running */
    }
  }, []);

  /** Push-to-talk press: talking over the interviewer cuts them off. */
  const pressToTalk = useCallback(() => {
    if (speakingRef.current) bargeIn();
    startListening();
  }, [bargeIn, startListening]);

  const setMode = useCallback(
    (next: VoiceMode) => {
      stopListening();
      setModeState(next);
      modeRef.current = next;
    },
    [stopListening],
  );

  // hands-free: the mic is open, except while the interviewer talks (unless the user wears headphones)
  useEffect(() => {
    if (!enabled || mode !== "handsfree") return;
    if (speaking && !headphones) {
      stopListening();
      return;
    }
    startListening();
  }, [enabled, mode, speaking, headphones, startListening, stopListening]);

  useEffect(
    () => () => {
      want.current = false;
      recRef.current?.abort();
      (window as SpeechWindow).speechSynthesis?.cancel();
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
    },
    [],
  );

  return {
    support,
    mode,
    setMode,
    listening,
    speaking,
    caption,
    error,
    ttsOn,
    setTtsOn: (on: boolean) => {
      setTtsOn(on);
      if (!on) {
        queued.current = [];
        cancelSpeech();
      }
    },
    rate,
    setRate,
    silenceMs,
    setSilenceMs,
    headphones,
    setHeadphones,
    speak,
    cancelSpeech,
    pressToTalk,
    releaseToTalk: stopListening,
    clearError: () => setError(null),
  };
}
