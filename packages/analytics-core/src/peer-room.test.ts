import { describe, expect, it } from "vitest";
import {
  ROOM_DOC_BYTES,
  ROOM_UPDATE_BYTES,
  SUGGESTION_GAP_MS,
  SUGGESTIONS_PER_SESSION,
  acceptUpdate,
  cleanSuggestions,
  suggestionAllowed,
} from "./peer-room.js";

describe("acceptUpdate", () => {
  it("takes a normal update and refuses an empty, oversized or document-busting one", () => {
    expect(acceptUpdate(1000, 200)).toBe(true);
    expect(acceptUpdate(1000, 0)).toBe(false);
    expect(acceptUpdate(0, ROOM_UPDATE_BYTES + 1)).toBe(false);
    expect(acceptUpdate(ROOM_DOC_BYTES - 100, 200)).toBe(false);
    expect(acceptUpdate(ROOM_DOC_BYTES - 200, 200)).toBe(true);
  });
});

describe("suggestionAllowed", () => {
  it("allows the first request and counts what remains", () => {
    const v = suggestionAllowed({ count: 0, lastAt: null }, 1000);
    expect(v).toEqual({ ok: true, remaining: SUGGESTIONS_PER_SESSION - 1 });
  });
  it("asks for a pause between requests and says how long", () => {
    const v = suggestionAllowed({ count: 1, lastAt: 1000 }, 1000 + 5000);
    expect(v).toEqual({ ok: false, reason: "gap", waitMs: SUGGESTION_GAP_MS - 5000 });
    expect(suggestionAllowed({ count: 1, lastAt: 1000 }, 1000 + SUGGESTION_GAP_MS).ok).toBe(true);
  });
  it("stops at the session cap whatever the time", () => {
    const v = suggestionAllowed({ count: SUGGESTIONS_PER_SESSION, lastAt: 0 }, 10 ** 9);
    expect(v).toEqual({ ok: false, reason: "cap", waitMs: 0 });
  });
});

describe("cleanSuggestions", () => {
  it("drops repeats, things already on the panel, and fragments", () => {
    const out = cleanSuggestions(
      [
        { text: "What is the time complexity of your approach?", why: "checks analysis" },
        { text: "what is the TIME complexity of your approach", why: "same again" },
        { text: "Why so?", why: "too short to be a prompt" },
        { text: "How would you test this with an empty input?" },
        { text: "Already on the panel: what if the input is sorted?" },
      ],
      ["Already on the panel: what if the input is sorted?"],
    );
    expect(out.map((o) => o.text)).toEqual([
      "What is the time complexity of your approach?",
      "How would you test this with an empty input?",
    ]);
  });
  it("keeps at most four, trims long ones and collapses whitespace", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      text: `Question number ${i} about the design?`,
    }));
    expect(cleanSuggestions(many, [])).toHaveLength(4);
    const long = cleanSuggestions([{ text: `${"word ".repeat(100)}?`, why: "  a \n b " }], []);
    expect(long[0]!.text.length).toBeLessThanOrEqual(240);
    expect(long[0]!.text.endsWith("…")).toBe(true);
    expect(long[0]!.why).toBe("a b");
  });
});
