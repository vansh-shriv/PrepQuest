import { describe, expect, it } from "vitest";
import {
  UtteranceBuffer,
  approximateWords,
  judgeMic,
  mapSpokenToOriginal,
  rms,
  speechSupport,
  splitForSpeech,
} from "./speech";

describe("feature detection", () => {
  it("needs both recognition and synthesis for full voice", () => {
    expect(speechSupport({})).toEqual({ recognition: false, synthesis: false });
    expect(speechSupport({ webkitSpeechRecognition: function () {}, speechSynthesis: {} })).toEqual(
      {
        recognition: true,
        synthesis: true,
      },
    );
    expect(speechSupport({ speechSynthesis: {} }).recognition).toBe(false);
  });
});

describe("UtteranceBuffer", () => {
  it("shows interim words as captions but only finals plus the last guess are flushed", () => {
    const b = new UtteranceBuffer();
    b.push([{ text: "I would use", final: false }], 1000);
    expect(b.caption).toBe("I would use");
    expect(b.interim).toBe("I would use");
    b.push(
      [
        { text: "I would use a hash map", final: true },
        { text: "for the", final: false },
      ],
      2500,
    );
    expect(b.caption).toBe("I would use a hash map for the");
    expect(b.flush()).toEqual({
      text: "I would use a hash map for the",
      startMs: 1000,
      endMs: 2500,
    });
    expect(b.flush()).toBeNull();
    expect(b.hasSpeech).toBe(false);
  });

  it("is empty until something is said, and ignores blank pieces", () => {
    const b = new UtteranceBuffer();
    b.push([], 10);
    b.push([{ text: "   ", final: true }], 20);
    expect(b.flush()).toBeNull();
  });
});

describe("approximateWords", () => {
  it("spreads words over the span in order, without overlap", () => {
    const w = approximateWords("one two three four", 1000, 3000);
    expect(w.map((x) => x.w)).toEqual(["one", "two", "three", "four"]);
    for (let i = 1; i < w.length; i++)
      expect(w[i]!.startMs).toBeGreaterThanOrEqual(w[i - 1]!.endMs);
    expect(w[0]!.startMs).toBe(1000);
    expect(approximateWords("", 0, 10)).toEqual([]);
  });

  it("never invents a faster pace than people can speak", () => {
    const w = approximateWords("a b c d e f g h", 0, 10);
    expect(w.at(-1)!.endMs).toBeGreaterThanOrEqual(8 * 100);
  });
});

describe("splitForSpeech", () => {
  it("chunks by sentence and keeps offsets into the original text", () => {
    const text = "First sentence. Second one here! Third?";
    const chunks = splitForSpeech(text, 20);
    expect(chunks.map((c) => c.text.trim())).toEqual([
      "First sentence.",
      "Second one here!",
      "Third?",
    ]);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });

  it("packs short sentences together up to the limit and breaks a very long one", () => {
    expect(splitForSpeech("A. B. C.", 50)).toHaveLength(1);
    const long = `${"word ".repeat(120)}end.`;
    const chunks = splitForSpeech(long, 100);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.text.length <= 160)).toBe(true);
    expect(chunks.map((c) => c.text).join("")).toBe(long);
  });
});

describe("barge-in mapping", () => {
  it("maps progress through the spoken text onto the original", () => {
    expect(mapSpokenToOriginal(25, 50, 100)).toBe(50);
    expect(mapSpokenToOriginal(999, 50, 100)).toBe(100);
    expect(mapSpokenToOriginal(5, 0, 100)).toBe(0);
  });
});

describe("microphone check", () => {
  it("computes the rms level", () => {
    expect(rms([])).toBe(0);
    expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
  });

  it("tells a dead mic, a faint voice, a noisy room and a good setup apart", () => {
    expect(judgeMic([0, 0.001], [0.002, 0.001])).toBe("no_signal");
    expect(judgeMic([0.005, 0.006], [0.01, 0.02])).toBe("too_quiet");
    expect(judgeMic([0.08, 0.09], [0.2, 0.3])).toBe("noisy");
    expect(judgeMic([0.03, 0.03], [0.05, 0.08])).toBe("noisy");
    expect(judgeMic([0.005, 0.006], [0.1, 0.2])).toBe("good");
  });
});
