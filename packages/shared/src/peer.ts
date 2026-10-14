import { z } from "zod";

// Contracts for peer mock interviews (X1), shared by API and web.

export const PEER_TOPIC_VALUES = ["dsa", "cs", "hld", "behavioral"] as const;
export type PeerTopicValue = (typeof PEER_TOPIC_VALUES)[number];
export const PEER_TOPIC_LABEL: Record<PeerTopicValue, string> = {
  dsa: "Data structures and algorithms",
  cs: "CS fundamentals",
  hld: "System design",
  behavioral: "Behavioural",
};
export const PEER_MINUTE_VALUES = [40, 60, 90] as const;

export const PEER_LIMITS = {
  openWindows: 20,
  openInvites: 10,
  minWindowMinutes: 40,
  maxWindowHours: 8,
  comments: 1500,
  details: 1000,
} as const;

const topics = z.array(z.enum(PEER_TOPIC_VALUES)).min(1).max(PEER_TOPIC_VALUES.length);
const difficulty = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const minutes = z.union([z.literal(40), z.literal(60), z.literal(90)]);
const isoDate = z.iso.datetime({ offset: true });

export const createAvailabilitySchema = z
  .object({
    startsAt: isoDate,
    endsAt: isoDate,
    topics,
    difficulty,
    language: z.enum(["cpp", "java", "python"]).nullish(),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: "The window must end after it starts",
    path: ["endsAt"],
  });
export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;

export const matchRequestSchema = z.object({ minutes });
export type MatchRequestInput = z.infer<typeof matchRequestSchema>;

export const createPeerInviteSchema = z.object({
  topic: z.enum(PEER_TOPIC_VALUES),
  difficulty,
  minutes,
  scheduledAt: isoDate,
});
export type CreatePeerInviteInput = z.infer<typeof createPeerInviteSchema>;

export const peerConsentSchema = z.object({ ai: z.boolean() });

export const PEER_RATING_KEYS = ["punctuality", "helpfulness", "preparedness"] as const;
const rating = z.number().int().min(1).max(5);
export const peerFeedbackSchema = z.object({
  ratings: z.object({ punctuality: rating, helpfulness: rating, preparedness: rating }),
  comments: z.string().trim().max(PEER_LIMITS.comments),
  /** Send even though the coaching nudges said the feedback could be better. */
  confirmed: z.boolean().default(false),
});
export type PeerFeedbackInput = z.infer<typeof peerFeedbackSchema>;

export const PEER_REPORT_REASONS = ["abuse", "harassment", "cheating", "no_show", "other"] as const;
export const peerReportSchema = z.object({
  userId: z.uuid(),
  sessionId: z.uuid().nullish(),
  reason: z.enum(PEER_REPORT_REASONS),
  details: z.string().trim().max(PEER_LIMITS.details).default(""),
});
export type PeerReportInput = z.infer<typeof peerReportSchema>;

export const peerBlockSchema = z.object({ userId: z.uuid() });

// --- response shapes -------------------------------------------------------------------------------

export interface PeerAvailabilityDto {
  id: string;
  startsAt: string;
  endsAt: string;
  topics: PeerTopicValue[];
  difficulty: 1 | 2 | 3;
  language: string | null;
}

export interface PeerReputationDto {
  sessions: number;
  noShows: number;
  noShowRate: number;
  rating: number | null;
  label: "new" | "reliable" | "mixed" | "unreliable";
}

export interface PeerPartnerDto {
  userId: string;
  handle: string;
  reputation: PeerReputationDto;
}

export type PeerSessionState = "scheduled" | "live" | "completed" | "cancelled" | "no_show";

export interface PeerSessionItem {
  id: string;
  scheduledAt: string;
  minutes: number;
  topic: PeerTopicValue;
  difficulty: 1 | 2 | 3;
  state: PeerSessionState;
  source: "match" | "invite";
  partner: PeerPartnerDto;
  /** Who is the candidate in the first half. */
  youAreFirstCandidate: boolean;
  feedbackGiven: boolean;
}

export interface PeerQuestionView {
  title: string;
  statementMd: string;
}

export interface PeerInterviewerPanel {
  /** Reference approaches or the model answer, never shown to the candidate. */
  reference: string[];
  followups: string[];
  rubric: string[];
}

export interface PeerSessionDetail extends PeerSessionItem {
  startedAt: string | null;
  endedAt: string | null;
  /** Server clock for the running session: `half` is 1, 2 or "over". */
  clock: {
    half: 1 | 2 | "over";
    you: "candidate" | "interviewer";
    halfRemainingMs: number;
    remainingMs: number;
  } | null;
  /** The question of the current half; the first question is hidden until the session is live. */
  question: PeerQuestionView | null;
  /** Only the person who is the interviewer in the current half. */
  panel: PeerInterviewerPanel | null;
  /** After the session: both questions, for the review. */
  questions: PeerQuestionView[] | null;
  consent: { you: boolean; partner: boolean; both: boolean };
  canOpen: boolean;
  /** This person has opened the room (the live room needs it). */
  youJoined: boolean;
  canReportNoShow: boolean;
  canCancel: boolean;
  feedbackFromPartner: { ratings: Record<string, number>; comments: string } | null;
}

export interface PeerInviteDto {
  id: string;
  topic: PeerTopicValue;
  difficulty: 1 | 2 | 3;
  minutes: number;
  scheduledAt: string;
  expiresAt: string;
  status: "open" | "accepted" | "revoked" | "expired";
  sessionId: string | null;
}

export interface CreatedPeerInviteDto extends PeerInviteDto {
  /** Shown once: only a hash is stored. */
  token: string;
}

export interface PeerInvitePreviewDto {
  owner: string;
  topic: PeerTopicValue;
  difficulty: 1 | 2 | 3;
  minutes: number;
  scheduledAt: string;
}

export interface PeerFeedbackResult {
  saved: boolean;
  nudges: { code: string; message: string }[];
}
