import { describe, expect, it } from "vitest";
import { loadFlashcards, validateFlashcards, type LoadedFlashcards } from "./flashcards.js";
import { findContentRoot } from "./root.js";

const deck = (over: Partial<LoadedFlashcards["decks"][number]> = {}) => ({
  slug: "demo",
  title: "Demo deck",
  kind: "custom" as const,
  description: "A deck used in tests.",
  cards: [
    { type: "basic" as const, front: "One?", back: "1" },
    { type: "basic" as const, front: "Two?", back: "2" },
    { type: "cloze" as const, front: "{{c1::Three}}", back: "" },
  ],
  ...over,
});

describe("starter flashcard decks", () => {
  it("the shipped decks load and pass every rule", async () => {
    const loaded = await loadFlashcards(findContentRoot());
    expect(loaded.issues).toEqual([]);
    expect(loaded.decks.length).toBeGreaterThanOrEqual(4);
    expect(validateFlashcards(loaded)).toEqual([]);
  });

  it("flags a cloze card without a gap, an empty back and a repeated front", () => {
    const issues = validateFlashcards({
      issues: [],
      decks: [
        deck({
          cards: [
            { type: "cloze", front: "no gap", back: "" },
            { type: "basic", front: "Q", back: "" },
            { type: "basic", front: "q", back: "A" },
            { type: "basic", front: "Fine", back: "yes" },
          ],
        }),
      ],
    }).map((i) => i.message);
    expect(issues).toEqual([
      "card 1: A cloze card needs at least one {{c1::hidden}} part.",
      "card 2: The back is empty.",
      "card 3: duplicate front",
    ]);
  });

  it("flags a repeated deck slug", () => {
    const issues = validateFlashcards({ issues: [], decks: [deck(), deck()] });
    expect(issues.map((i) => i.message)).toContain("duplicate slug");
  });
});
