import type { CardTypeValue, DeckKindValue } from "@prepquest/shared";

// Pure helpers for the flashcard screens (no I/O, unit tested).

export const KIND_LABEL: Record<DeckKindValue, string> = {
  patterns: "Patterns",
  formulas: "Formulas",
  cs: "CS facts",
  behavioral: "Behavioral",
  mistakes: "Mistakes",
  custom: "Custom",
};

export const TYPE_LABEL: Record<CardTypeValue, string> = {
  basic: "Front and back",
  cloze: "Fill in the blank",
  code: "Code snippet",
};

/** The four answer buttons and the SM-2 quality each one sends. */
export const RATINGS = [
  { id: "again", label: "Again", quality: 1, key: "1", hint: "I did not remember" },
  { id: "hard", label: "Hard", quality: 3, key: "2", hint: "Remembered with effort" },
  { id: "good", label: "Good", quality: 4, key: "3", hint: "Remembered" },
  { id: "easy", label: "Easy", quality: 5, key: "4", hint: "Instant" },
] as const;

export function ratingForKey(key: string) {
  return RATINGS.find((r) => r.key === key) ?? null;
}

export function dueText(d: { due: number; fresh: number; cards: number }): string {
  if (d.cards === 0) return "No cards yet";
  const parts = [];
  if (d.due > 0) parts.push(`${d.due} due`);
  if (d.fresh > 0) parts.push(`${d.fresh} new`);
  return parts.length > 0 ? parts.join(", ") : "Nothing due";
}

export function pluralCards(n: number): string {
  return `${n} card${n === 1 ? "" : "s"}`;
}

/** A unique id for one answer, made on the device: the server stores each id once. */
export function newClientId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** "3 reviews waiting to sync" for the badge; empty when there is nothing to say. */
export function syncText(pending: number, online: boolean): string {
  if (pending === 0) return online ? "" : "Offline: your answers are saved on this device.";
  const n = `${pending} answer${pending === 1 ? "" : "s"}`;
  return online ? `Syncing ${n}...` : `Offline: ${n} will sync when you are back online.`;
}

export function summaryText(done: number, cram: boolean): string {
  if (done === 0) return cram ? "No cards to cram." : "You are done for today.";
  return `${pluralCards(done)} ${cram ? "crammed" : "reviewed"}.`;
}
