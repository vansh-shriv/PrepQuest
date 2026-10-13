import { z } from "zod";

// Flashcards (X6). Contracts shared by the API and the web app.

export const CARD_TYPES = ["basic", "cloze", "code"] as const;
export const DECK_KINDS = [
  "patterns",
  "formulas",
  "cs",
  "behavioral",
  "mistakes",
  "custom",
] as const;
export type CardTypeValue = (typeof CARD_TYPES)[number];
export type DeckKindValue = (typeof DECK_KINDS)[number];

const face = z.string().max(2000);

export const createDeckSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  kind: z.enum(DECK_KINDS).default("custom"),
});

export const updateDeckSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).nullable(),
    kind: z.enum(DECK_KINDS),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export const createCardSchema = z.object({
  type: z.enum(CARD_TYPES).default("basic"),
  front: face,
  back: face.default(""),
  /** What the card was made from (a note, a quiz question, an interview moment). */
  originType: z.enum(["note", "quiz_question", "interview_session", "editorial"]).optional(),
  originId: z.string().uuid().optional(),
});

export const updateCardSchema = z
  .object({
    type: z.enum(CARD_TYPES),
    front: face,
    back: face,
    suspended: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export const studyQuerySchema = z.object({
  deckId: z.string().uuid().optional(),
  cram: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const flashcardSettingsSchema = z.object({
  newPerDay: z.number().int().min(0).max(100),
  reviewsPerDay: z.number().int().min(0).max(500),
});

/** Answers given on the device, possibly while offline. `clientId` makes a retried upload harmless. */
export const syncReviewsSchema = z.object({
  reviews: z
    .array(
      z.object({
        clientId: z.string().min(8).max(64),
        cardId: z.string().uuid(),
        quality: z.number().int().min(0).max(5),
        reviewedAt: z.string().datetime(),
      }),
    )
    .min(1)
    .max(500),
});

export const importDeckSchema = z.object({
  format: z.literal("prepquest-deck"),
  version: z.literal(1),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  kind: z.enum(DECK_KINDS).default("custom"),
  cards: z
    .array(
      z.object({ type: z.enum(CARD_TYPES).default("basic"), front: face, back: face.default("") }),
    )
    .min(1)
    .max(500),
});
export type DeckExport = z.infer<typeof importDeckSchema>;

export const mistakesSchema = z
  .object({
    attemptId: z.string().uuid().optional(),
    questionId: z.string().uuid().optional(),
  })
  .refine((v) => Boolean(v.attemptId) !== Boolean(v.questionId), "Give an attempt or a question.");

export interface DeckDto {
  id: string;
  title: string;
  description: string | null;
  kind: DeckKindValue;
  source: string | null;
  cards: number;
  due: number;
  fresh: number;
  createdAt: string;
}

export interface StarterDeckDto {
  slug: string;
  title: string;
  description: string | null;
  kind: DeckKindValue;
  cards: number;
  /** The id of the learner's copy, when they already added it. */
  adoptedAs: string | null;
}

export interface CardDto {
  id: string;
  deckId: string;
  type: CardTypeValue;
  front: string;
  back: string;
  /** What is shown before and after flipping (a cloze card hides its deletions in the prompt). */
  prompt: string;
  answer: string;
  originType: string | null;
  dueOn: string;
  intervalDays: number;
  lapses: number;
  suspended: boolean;
  isNew: boolean;
}

export interface DeckDetailDto extends DeckDto {
  items: CardDto[];
}

export interface FlashcardsResponse {
  decks: DeckDto[];
  starters: StarterDeckDto[];
  today: string;
  settings: { newPerDay: number; reviewsPerDay: number };
  doneToday: { fresh: number; reviews: number };
}

export interface StudyResponse {
  cards: CardDto[];
  today: string;
  cram: boolean;
  reviews: number;
  fresh: number;
  waitingReviews: number;
  waitingNew: number;
  /** The server's time when the queue was built; the device keeps it with its offline copy. */
  serverTime: string;
}

export type SyncStatus = "applied" | "stale" | "duplicate" | "unknown_card";

export interface SyncResponse {
  results: Array<{
    clientId: string;
    cardId: string;
    status: SyncStatus;
    dueOn: string | null;
    intervalDays: number | null;
  }>;
  serverTime: string;
}

export interface MistakesResponse {
  deckId: string;
  added: number;
  skipped: number;
}
