export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export const PERSONA_NAME: Record<string, string> = {
  friendly: "Priya",
  neutral: "Alex",
  strict: "Dr. Rao",
  rapid: "Sam",
};

export const PERSONA_LABEL: Record<string, string> = {
  friendly: "Friendly mentor",
  neutral: "Neutral professional",
  strict: "Strict interviewer",
  rapid: "Rapid-fire",
};

export const PERSONA_HELP: Record<string, string> = {
  friendly: "Warm, encourages you and offers a hint early. Good for a first mock.",
  neutral: "Realistic and polite. Hints only when you ask or stay stuck.",
  strict: "Terse, drills edge cases and complexity. Hints only when you ask.",
  rapid: "Short questions, quick pace, many topics.",
};

export const END_REASON_TEXT: Record<string, string> = {
  completed: "Finished",
  user: "Ended early",
  timer: "Time ran out",
  abandoned: "Not started",
  abuse: "Ended by the interviewer",
  error: "Ended by an error",
};

export const BAND_TONE: Record<string, "easy" | "medium" | "hard" | "info"> = {
  Strong: "easy",
  Ready: "easy",
  Borderline: "medium",
  "Not ready": "hard",
};

/** Links for next actions the app can open; anything else is shown as text. */
export function actionHref(kind: string, ref: string): string | null {
  if (kind === "problem" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(ref)) return `/problems/${ref}`;
  if (kind === "mock" && (ref === "dsa" || ref === "project")) return `/interview/new?type=${ref}`;
  return null;
}
