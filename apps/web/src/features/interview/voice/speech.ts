// Pure helpers for browser speech (Web Speech API): feature detection, utterance assembly, sentence
// chunking for text-to-speech, and microphone level checks. No timers and no browser calls here, so
// they are testable; the hook in use-voice.ts does the wiring.

export interface SpeechSupport {
  recognition: boolean;
  synthesis: boolean;
}

export function speechSupport(w: {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  speechSynthesis?: unknown;
}): SpeechSupport {
  return {
    recognition: Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition),
    synthesis: Boolean(w.speechSynthesis),
  };
}

/** One recognition result as the browser reports it. */
export interface RecognitionPiece {
  text: string;
  final: boolean;
}

/**
 * Collects what the recogniser says into utterances. Final pieces accumulate; the latest interim
 * piece is shown as a caption but never sent. `flush` returns the finished utterance, if any.
 */
export class UtteranceBuffer {
  private finals: string[] = [];
  private interimText = "";
  private startedAt: number | null = null;
  private lastAt = 0;

  push(pieces: readonly RecognitionPiece[], atMs: number): void {
    if (pieces.length === 0) return;
    this.startedAt ??= atMs;
    this.lastAt = atMs;
    this.finals = pieces
      .filter((p) => p.final)
      .map((p) => p.text.trim())
      .filter(Boolean);
    this.interimText = pieces
      .filter((p) => !p.final)
      .map((p) => p.text.trim())
      .join(" ")
      .trim();
  }

  /** What to show as captions right now: finished words plus the guess in progress. */
  get caption(): string {
    return [...this.finals, this.interimText].filter(Boolean).join(" ");
  }

  get hasSpeech(): boolean {
    return this.caption.length > 0;
  }

  get interim(): string {
    return this.interimText;
  }

  /** The finished utterance with approximate word timing, or null when nothing was said. */
  flush(): { text: string; startMs: number; endMs: number } | null {
    // anything still interim at flush time was heard but not finalised (the user stopped talking): keep it
    const text = [...this.finals, this.interimText]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const startMs = this.startedAt ?? 0;
    const endMs = Math.max(this.lastAt, startMs);
    this.finals = [];
    this.interimText = "";
    this.startedAt = null;
    this.lastAt = 0;
    return text ? { text, startMs, endMs } : null;
  }
}

/**
 * Word timing spread evenly over the span of the utterance. The Web Speech API reports no per-word
 * times, so these are estimates (a streaming STT service replaces them later); sizes are bounded.
 */
export function approximateWords(
  text: string,
  startMs: number,
  endMs: number,
): { w: string; startMs: number; endMs: number }[] {
  const words = text.split(/\s+/).filter(Boolean).slice(0, 1500);
  if (words.length === 0) return [];
  const span = Math.max(endMs - startMs, words.length * 120);
  const step = span / words.length;
  return words.map((w, i) => ({
    w: w.slice(0, 80),
    startMs: Math.round(startMs + i * step),
    endMs: Math.round(startMs + (i + 1) * step - 20),
  }));
}

/** A sentence-sized chunk of text and where it starts in the original string. */
export interface Chunk {
  text: string;
  offset: number;
}

/**
 * Splits text into chunks the speech engine can say reliably (some engines stop after about 15
 * seconds of continuous speech). Offsets let a boundary index be mapped back to the full text.
 */
export function splitForSpeech(text: string, maxLen = 220): Chunk[] {
  const chunks: Chunk[] = [];
  const re = /[^.!?\n]+[.!?]*\s*/g;
  let m: RegExpExecArray | null;
  let current: Chunk | null = null;
  while ((m = re.exec(text)) !== null) {
    const piece = m[0];
    if (piece.trim() === "") continue;
    if (current && current.text.length + piece.length <= maxLen) {
      current.text += piece;
    } else {
      if (current) chunks.push(current);
      current = { text: piece, offset: m.index };
    }
    while (current.text.length > maxLen * 1.5) {
      const cut: number = current.text.lastIndexOf(" ", maxLen);
      const at: number = cut > 40 ? cut : maxLen;
      chunks.push({ text: current.text.slice(0, at), offset: current.offset });
      current = { text: current.text.slice(at), offset: current.offset + at };
    }
  }
  if (current && current.text.trim() !== "") chunks.push(current);
  return chunks;
}

/**
 * Maps how far the engine got in the spoken (sanitised) text to a position in the original reply,
 * for the server's "what was heard" record.
 */
export function mapSpokenToOriginal(
  spokenIndex: number,
  spokenLength: number,
  originalLength: number,
): number {
  if (spokenLength <= 0) return 0;
  const frac = Math.min(1, Math.max(0, spokenIndex / spokenLength));
  return Math.round(frac * originalLength);
}

// --- microphone level -----------------------------------------------------------------------

/** Root-mean-square level of audio samples in [-1, 1]. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += (samples[i] as number) ** 2;
  return Math.sqrt(sum / samples.length);
}

export type MicVerdict = "no_signal" | "too_quiet" | "noisy" | "good";

/**
 * Judges a mic check from level readings: `ambient` taken while the user is quiet, `speech` while
 * they talk. A loud room, a silent mic and a faint voice each get their own advice.
 */
export function judgeMic(ambient: readonly number[], speech: readonly number[]): MicVerdict {
  const peak = (xs: readonly number[]) => (xs.length ? Math.max(...xs) : 0);
  const mean = (xs: readonly number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  if (peak(speech) < 0.004 && peak(ambient) < 0.004) return "no_signal";
  if (mean(ambient) > 0.05) return "noisy";
  if (peak(speech) < 0.03) return "too_quiet";
  if (mean(ambient) > 0.02 && peak(speech) < mean(ambient) * 4) return "noisy";
  return "good";
}

export const MIC_ADVICE: Record<MicVerdict, string> = {
  good: "Sounds good.",
  no_signal: "We hear nothing. Check that the right microphone is selected and not muted.",
  too_quiet: "Your voice is very faint. Move closer to the microphone or raise its input level.",
  noisy:
    "There is a lot of background noise. Try a quieter spot or a headset, and keep push-to-talk handy.",
};
