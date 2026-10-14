// Rules for the live peer room (X1): what the shared document may hold, when the interviewer may ask for
// suggestions, and how the model's suggestions are cleaned before anyone sees them. Pure.

export const ROOM_UPDATE_BYTES = 48 * 1024;
export const ROOM_DOC_BYTES = 512 * 1024;
export const SUGGESTION_GAP_MS = 20_000;
export const SUGGESTIONS_PER_SESSION = 12;
export const SUGGESTIONS_PER_REQUEST = 4;
export const SUGGESTION_CHARS = 240;

/** Whether one more update fits: a single update has a cap and so does the document it grows. */
export function acceptUpdate(docBytes: number, updateBytes: number): boolean {
  return (
    updateBytes > 0 && updateBytes <= ROOM_UPDATE_BYTES && docBytes + updateBytes <= ROOM_DOC_BYTES
  );
}

export interface SuggestionState {
  /** Requests already made in this session. */
  count: number;
  /** When the last one was made (ms), or null. */
  lastAt: number | null;
}

export type SuggestionVerdict =
  { ok: true; remaining: number } | { ok: false; reason: "gap" | "cap"; waitMs: number };

/** At most one request every 20 seconds and 12 a session: suggestions help, they must not replace thinking. */
export function suggestionAllowed(state: SuggestionState, now: number): SuggestionVerdict {
  if (state.count >= SUGGESTIONS_PER_SESSION) return { ok: false, reason: "cap", waitMs: 0 };
  if (state.lastAt !== null && now - state.lastAt < SUGGESTION_GAP_MS)
    return { ok: false, reason: "gap", waitMs: SUGGESTION_GAP_MS - (now - state.lastAt) };
  return { ok: true, remaining: SUGGESTIONS_PER_SESSION - state.count - 1 };
}

export interface RawSuggestion {
  text: string;
  why?: string;
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Keeps the suggestions that are usable: a real question or prompt, no repeats of each other or of what the
 * interviewer already has in front of them, short enough to read at a glance, at most four. Returns what is
 * left in the model's order.
 */
export function cleanSuggestions(
  raw: readonly RawSuggestion[],
  alreadyShown: readonly string[],
): { text: string; why: string }[] {
  const seen = new Set(alreadyShown.map(norm));
  const out: { text: string; why: string }[] = [];
  for (const r of raw) {
    const text = r.text.replace(/\s+/g, " ").trim();
    const key = norm(text);
    if (text.length < 12 || key.length < 8 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      text:
        text.length > SUGGESTION_CHARS ? `${text.slice(0, SUGGESTION_CHARS - 1).trimEnd()}…` : text,
      why: (r.why ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
    });
    if (out.length >= SUGGESTIONS_PER_REQUEST) break;
  }
  return out;
}
