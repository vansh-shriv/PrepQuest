// Cheap local moderation pre-check (doc 13, guardrails). The model also flags abuse; either one counts.

const ABUSE = [
  /\b(idiot|stupid|moron|dumb ?ass|shut up|piece of (shit|crap))\b/i,
  /\bf+u+c+k+(ing)? (you|off|this)\b/i,
  /\b(kill yourself|kys)\b/i,
];

export function detectAbuse(text: string): boolean {
  return ABUSE.some((re) => re.test(text));
}

/** Abusive messages before the session is closed: the first is warned, the second ends it. */
export const ABUSE_LIMIT = 2;
