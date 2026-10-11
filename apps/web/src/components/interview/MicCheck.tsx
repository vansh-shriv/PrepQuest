"use client";

import { useEffect, useRef, useState } from "react";
import { Button, LoadingBar, Window } from "@prepquest/ui";
import { MIC_ADVICE, judgeMic, rms, type MicVerdict } from "@/features/interview/voice/speech";

type Phase = "idle" | "asking" | "denied" | "ambient" | "speech" | "done";

interface AudioWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

const SAMPLE_MS = 2500;

/**
 * Mic check before a voice interview: permission, a level meter, a short quiet sample and a short
 * speech sample, then advice. Denying the microphone is fine: the interview continues in text.
 */
export function MicCheck({ onResult }: { onResult: (ok: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);
  const [verdict, setVerdict] = useState<MicVerdict | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const readings = useRef<{ ambient: number[]; speech: number[] }>({ ambient: [], speech: [] });
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      void ctx.current?.close();
    },
    [],
  );

  const start = async () => {
    setPhase("asking");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = media;
      const w = window as unknown as AudioWindow;
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) throw new Error("no audio context");
      const audio = new Ctor();
      ctx.current = audio;
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(media).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        const value = rms(data);
        setLevel(value);
        if (phaseRef.current === "ambient") readings.current.ambient.push(value);
        if (phaseRef.current === "speech") readings.current.speech.push(value);
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      setPhase("ambient");
      setTimeout(() => {
        setPhase("speech");
        setTimeout(() => {
          const v = judgeMic(readings.current.ambient, readings.current.speech);
          setVerdict(v);
          setPhase("done");
          onResult(v !== "no_signal");
        }, SAMPLE_MS);
      }, SAMPLE_MS);
    } catch {
      setPhase("denied");
      onResult(false);
    }
  };

  const testVoice = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance("Hi, I'm your interviewer. Can you hear me clearly?"));
  };

  return (
    <Window title="Microphone check" tone="sun" data-testid="mic-check">
      <div className="grid gap-3">
        {phase === "idle" && (
          <p className="m-0">
            Check your microphone and speakers before the interview. Your browser will ask for
            permission. Audio is not recorded or uploaded: your words are turned into text on the
            spot.
          </p>
        )}
        {(phase === "ambient" || phase === "speech" || phase === "done") && (
          <div className="grid gap-2">
            <LoadingBar
              value={Math.min(100, Math.round(level * 400))}
              label="Input level"
              size="sm"
            />
            <p role="status" aria-live="polite" className="m-0">
              {phase === "ambient" && "Stay quiet for a moment..."}
              {phase === "speech" && 'Now say: "I would start with a hash map."'}
              {phase === "done" && verdict && MIC_ADVICE[verdict]}
            </p>
          </div>
        )}
        {phase === "denied" && (
          <p role="alert" className="m-0">
            We couldn&apos;t use the microphone. Allow it with the lock icon in the address bar and
            try again, or continue with typing: nothing is lost and you can still hear the
            interviewer.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {(phase === "idle" || phase === "denied" || phase === "done") && (
            <Button size="sm" variant="accent" onClick={() => void start()}>
              {phase === "idle" ? "Test microphone" : "Test again"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={testVoice}>
            Test the interviewer&apos;s voice
          </Button>
        </div>
      </div>
    </Window>
  );
}
