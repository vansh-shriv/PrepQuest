// Peer mock interviews (X1): matching, the two halves of a session, reputation, feedback quality and the
// calendar file. Pure: no clock, no I/O. The API loads offers and sessions and stores the outcome.

export const PEER_TOPICS = ["dsa", "cs", "hld", "behavioral"] as const;
export type PeerTopic = (typeof PEER_TOPICS)[number];

export const PEER_MINUTES = [40, 60, 90] as const;
export type PeerMinutes = (typeof PEER_MINUTES)[number];

const MIN = 60_000;
/** A session can be opened this long before its start. */
export const EARLY_START_MS = 10 * MIN;
/** A partner who has not shown up this long after the start can be reported as a no-show. */
export const NO_SHOW_AFTER_MS = 15 * MIN;
/** Matches never start sooner than this, so both people get a reminder. */
export const MIN_LEAD_MS = 30 * MIN;

export interface TimeWindow {
  startsAt: number;
  endsAt: number;
}

export interface PeerPrefs {
  topics: PeerTopic[];
  /** 1 easy, 2 medium, 3 hard. */
  difficulty: 1 | 2 | 3;
  language: string | null;
}

export interface PeerOffer {
  userId: string;
  window: TimeWindow;
  prefs: PeerPrefs;
  /** Peer rating 1-5 once there is one, and the share of booked sessions missed. */
  rating: number | null;
  noShowRate: number;
}

export interface PeerMatch {
  userId: string;
  topic: PeerTopic;
  startsAt: number;
  score: number;
  /** The partner's offer that matched (so the caller knows which window to use up). */
  offer: PeerOffer;
}

/** Length of the common part of two windows (0 when they do not meet). */
export function overlapMs(a: TimeWindow, b: TimeWindow): number {
  return Math.max(0, Math.min(a.endsAt, b.endsAt) - Math.max(a.startsAt, b.startsAt));
}

/**
 * The best partner for `me` among `pool`: someone who shares a topic and a stretch of time long enough for the
 * session, is not blocked either way, and is not the same person. Higher score is better; ties go to the earlier
 * start and then the user id so the result is stable. Null when nobody fits.
 */
export function bestMatch(
  me: PeerOffer,
  pool: readonly PeerOffer[],
  opts: { minutes: number; now: number; blocked?: ReadonlySet<string> },
): PeerMatch | null {
  const need = opts.minutes * MIN;
  let best: PeerMatch | null = null;
  for (const other of pool) {
    if (other.userId === me.userId || opts.blocked?.has(other.userId)) continue;
    const topic = me.prefs.topics.find((t) => other.prefs.topics.includes(t));
    if (!topic) continue;
    const startsAt = Math.max(me.window.startsAt, other.window.startsAt, opts.now + MIN_LEAD_MS);
    const end = Math.min(me.window.endsAt, other.window.endsAt);
    if (end - startsAt < need) continue;
    let score = 40;
    score += 30 - 15 * Math.abs(me.prefs.difficulty - other.prefs.difficulty);
    if (me.prefs.language && me.prefs.language === other.prefs.language) score += 10;
    if (other.rating !== null) score += (other.rating - 3) * 5;
    score -= other.noShowRate * 40;
    const cand: PeerMatch = { userId: other.userId, topic, startsAt, score, offer: other };
    if (
      !best ||
      cand.score > best.score ||
      (cand.score === best.score &&
        (cand.startsAt < best.startsAt ||
          (cand.startsAt === best.startsAt && cand.userId < best.userId)))
    )
      best = cand;
  }
  return best;
}

/** The window left over after a session took `[startsAt, startsAt + minutes)` out of it (null when too short to keep). */
export function leftover(
  w: TimeWindow,
  startsAt: number,
  minutes: number,
  keepAtLeastMs = 40 * MIN,
): TimeWindow[] {
  const end = startsAt + minutes * MIN;
  const out: TimeWindow[] = [];
  if (startsAt - w.startsAt >= keepAtLeastMs) out.push({ startsAt: w.startsAt, endsAt: startsAt });
  if (w.endsAt - end >= keepAtLeastMs) out.push({ startsAt: end, endsAt: w.endsAt });
  return out;
}

// ---------------------------------------------------------------- the two halves

export type PeerSide = "a" | "b";

export interface PeerClock {
  /** 1 or 2, or "over" once the session time is used up. */
  half: 1 | 2 | "over";
  candidate: PeerSide;
  interviewer: PeerSide;
  /** Time left in the current half and in the whole session. */
  halfRemainingMs: number;
  remainingMs: number;
  /** The question for this half (0 or 1). */
  questionIndex: 0 | 1;
}

const flip = (s: PeerSide): PeerSide => (s === "a" ? "b" : "a");

/** Who is the candidate right now: the first candidate for the first half, the other person after the swap. */
export function peerClock(input: {
  startedAt: number;
  now: number;
  minutes: number;
  firstCandidate: PeerSide;
}): PeerClock {
  const total = input.minutes * MIN;
  const half = total / 2;
  const elapsed = Math.max(0, input.now - input.startedAt);
  const which: 1 | 2 | "over" = elapsed < half ? 1 : elapsed < total ? 2 : "over";
  const candidate = which === 1 ? input.firstCandidate : flip(input.firstCandidate);
  return {
    half: which,
    candidate,
    interviewer: flip(candidate),
    halfRemainingMs: which === 1 ? half - elapsed : which === 2 ? total - elapsed : 0,
    remainingMs: Math.max(0, total - elapsed),
    questionIndex: which === 1 ? 0 : 1,
  };
}

/** The session can be opened from a little before its start until it would be over. */
export function canOpen(scheduledAt: number, minutes: number, now: number): boolean {
  return now >= scheduledAt - EARLY_START_MS && now < scheduledAt + minutes * MIN;
}

export function noShowDue(scheduledAt: number, now: number): boolean {
  return now >= scheduledAt + NO_SHOW_AFTER_MS;
}

// ---------------------------------------------------------------- reputation

export interface PeerStats {
  /** Completed sessions. */
  sessions: number;
  /** Booked sessions the person did not attend. */
  noShows: number;
  /** What partners gave for helpfulness (1-5), one entry per feedback. */
  helpfulness: number[];
  punctuality: number[];
}

export type ReputationLabel = "new" | "reliable" | "mixed" | "unreliable";

export interface Reputation {
  sessions: number;
  noShows: number;
  noShowRate: number;
  rating: number | null;
  label: ReputationLabel;
}

export const REPUTATION_MIN_SESSIONS = 3;
const PRIOR_RATING = 4;
const PRIOR_WEIGHT = 2;

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Rating is pulled to a prior until there are a few sessions, and nothing is judged before
 * `REPUTATION_MIN_SESSIONS`: one bad evening must not label anyone.
 */
export function reputation(s: PeerStats): Reputation {
  const booked = s.sessions + s.noShows;
  const noShowRate = booked === 0 ? 0 : s.noShows / booked;
  const scores = [...s.helpfulness, ...s.punctuality];
  const rating =
    scores.length === 0
      ? null
      : Math.round(
          ((mean(scores) * scores.length + PRIOR_RATING * PRIOR_WEIGHT) /
            (scores.length + PRIOR_WEIGHT)) *
            100,
        ) / 100;
  let label: ReputationLabel = "new";
  if (booked >= REPUTATION_MIN_SESSIONS) {
    if (noShowRate > 0.25) label = "unreliable";
    else if (rating !== null && rating >= 4) label = "reliable";
    else label = "mixed";
  }
  return { sessions: s.sessions, noShows: s.noShows, noShowRate, rating, label };
}

// ---------------------------------------------------------------- feedback quality

export const RATING_KEYS = ["punctuality", "helpfulness", "preparedness"] as const;
export type RatingKey = (typeof RATING_KEYS)[number];

export interface FeedbackNudge {
  code: "short" | "no-specifics" | "uniform";
  message: string;
}

const CONCRETE =
  /\d|["'“”]|for example|for instance|you said|when you|at the (start|end)|first|second|because|instead|next time|try /i;

/**
 * Gentle nudges before feedback is sent: it is short, it names nothing concrete, or every rating is the same.
 * Never blocks: the person decides.
 */
export function feedbackNudges(input: {
  ratings: Partial<Record<RatingKey, number>>;
  comments: string;
}): FeedbackNudge[] {
  const out: FeedbackNudge[] = [];
  const words = input.comments.trim().split(/\s+/).filter(Boolean).length;
  if (words < 12)
    out.push({
      code: "short",
      message: "A few more sentences would help your partner. What went well, and what to change?",
    });
  else if (!CONCRETE.test(input.comments))
    out.push({
      code: "no-specifics",
      message:
        'Point at a moment: "when you ..." or "you said ..." helps more than a general remark.',
    });
  const given = Object.values(input.ratings);
  if (given.length >= 3 && given.every((r) => r === given[0]))
    out.push({
      code: "uniform",
      message: "Every rating is the same. If some parts were better than others, show it.",
    });
  return out;
}

// ---------------------------------------------------------------- calendar file

const icsStamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

const icsText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** An iCalendar file with one event and a reminder 15 minutes before. Lines are folded at 75 characters. */
export function buildIcs(e: {
  uid: string;
  startsAt: number;
  minutes: number;
  title: string;
  description: string;
  url: string;
  stampedAt: number;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PrepQuest//Peer mock//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}@prepquest`,
    `DTSTAMP:${icsStamp(e.stampedAt)}`,
    `DTSTART:${icsStamp(e.startsAt)}`,
    `DTEND:${icsStamp(e.startsAt + e.minutes * MIN)}`,
    `SUMMARY:${icsText(e.title)}`,
    `DESCRIPTION:${icsText(e.description)}`,
    `URL:${e.url}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(e.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const folded = lines.flatMap((l) => {
    const out: string[] = [];
    let rest = l;
    while (rest.length > 75) {
      out.push(rest.slice(0, 75));
      rest = ` ${rest.slice(75)}`;
    }
    out.push(rest);
    return out;
  });
  return `${folded.join("\r\n")}\r\n`;
}
