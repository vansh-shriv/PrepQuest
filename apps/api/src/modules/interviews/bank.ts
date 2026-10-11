import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { newId, questionBank, questionMemory, type Database } from "@prepquest/db";
import {
  DUPLICATE_SIMILARITY,
  callbackLines,
  cosine,
  type BankCandidate,
  type PlannedQuestion,
} from "@prepquest/interview-core";
import { embedText } from "../../lib/embeddings.js";

// The question bank and the user's question memory (X5): what was asked recently, what went badly,
// whether a candidate is a paraphrase of something already asked, and the callbacks the interviewer
// may use. Embeddings are the local hashing embedder (see lib/embeddings.ts).

const COOLDOWN_DAYS = 60;

export async function loadBankCandidates(
  db: Database,
  category: BankCandidate["category"],
): Promise<BankCandidate[]> {
  const rows = await db
    .select()
    .from(questionBank)
    .where(and(eq(questionBank.category, category), eq(questionBank.status, "published")));
  return rows.map((r) => ({
    slug: r.slug,
    category: r.category as BankCandidate["category"],
    topic: r.topic,
    competency: r.competency,
    difficulty: r.difficulty,
    text: r.text,
    referenceAnswer: r.referenceAnswer,
    followups: r.followups,
    rubricPoints: r.rubricPoints,
  }));
}

export async function loadBankBySlugs(
  db: Database,
  slugs: readonly string[],
): Promise<BankCandidate[]> {
  if (slugs.length === 0) return [];
  const rows = await db
    .select()
    .from(questionBank)
    .where(and(inArray(questionBank.slug, [...slugs]), eq(questionBank.status, "published")));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return slugs.flatMap((slug) => {
    const r = bySlug.get(slug);
    return r
      ? [
          {
            slug: r.slug,
            category: r.category as BankCandidate["category"],
            topic: r.topic,
            competency: r.competency,
            difficulty: r.difficulty,
            text: r.text,
            referenceAnswer: r.referenceAnswer,
            followups: r.followups,
            rubricPoints: r.rubricPoints,
          },
        ]
      : [];
  });
}

export interface MemorySignals {
  recentSlugs: Set<string>;
  weakSlugs: Set<string>;
  /** Competencies or topics asked in the user's last three sessions. */
  recentTopics: Set<string>;
  isSemanticDuplicate: (c: BankCandidate) => boolean;
}

/** Parses a pgvector text value like "[0.1,0.2,...]". */
function parseVector(text: string | null): number[] | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? (v as number[]) : null;
  } catch {
    return null;
  }
}

export async function memorySignals(db: Database, userId: string): Promise<MemorySignals> {
  const since = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000);
  const rows = await db
    .select({
      refKey: questionMemory.refKey,
      topic: questionMemory.topic,
      weak: questionMemory.weak,
      sessionId: questionMemory.sessionId,
      askedAt: questionMemory.askedAt,
      embedding: sql<string | null>`${questionMemory.embedding}::text`,
    })
    .from(questionMemory)
    .where(and(eq(questionMemory.userId, userId), gte(questionMemory.askedAt, since)))
    .orderBy(desc(questionMemory.askedAt))
    .limit(200);
  const recentSlugs = new Set(rows.map((r) => r.refKey.replace(/^bank:/, "")));
  const weakSlugs = new Set(rows.filter((r) => r.weak).map((r) => r.refKey.replace(/^bank:/, "")));
  const sessions: string[] = [];
  for (const r of rows)
    if (r.sessionId && !sessions.includes(r.sessionId)) sessions.push(r.sessionId);
  const lastThree = new Set(sessions.slice(0, 3));
  const recentTopics = new Set(
    rows
      .filter((r) => r.sessionId && lastThree.has(r.sessionId) && r.topic)
      .map((r) => r.topic as string),
  );
  const vectors = rows
    .map((r) => parseVector(r.embedding))
    .filter((v): v is number[] => v !== null);
  return {
    recentSlugs,
    weakSlugs,
    recentTopics,
    isSemanticDuplicate: (c) => {
      if (vectors.length === 0) return false;
      const e = embedText(c.text);
      return vectors.some((v) => cosine(e, v) >= DUPLICATE_SIMILARITY);
    },
  };
}

/** Lines the interviewer may use to refer back to earlier sessions (X5), when the user allows it. */
export async function callbacksFor(
  db: Database,
  userId: string,
  allowed: boolean,
): Promise<string[]> {
  if (!allowed) return [];
  const rows = await db
    .select({
      questionText: questionMemory.questionText,
      weak: questionMemory.weak,
      topic: questionMemory.topic,
      askedAt: questionMemory.askedAt,
    })
    .from(questionMemory)
    .where(and(eq(questionMemory.userId, userId), eq(questionMemory.weak, true)))
    .orderBy(desc(questionMemory.askedAt))
    .limit(5);
  return callbackLines(
    rows.map((r) => ({
      questionText: r.questionText,
      weak: r.weak,
      topic: r.topic,
      daysAgo: Math.floor((Date.now() - r.askedAt.getTime()) / 86_400_000),
    })),
  );
}

/** The memory row for one asked question. */
export function memoryValues(
  userId: string,
  sessionId: string,
  q: PlannedQuestion,
  outcome: number,
  weak: boolean,
) {
  const text = q.kind === "problem" ? q.title : q.question;
  return {
    id: newId(),
    userId,
    sessionId,
    kind: q.kind,
    refKey: q.kind === "problem" ? q.slug : q.sourceRef,
    questionText: text,
    topic:
      q.kind === "verbal"
        ? (q.competency ?? q.topic)
        : q.kind === "problem"
          ? (q.tags[0] ?? null)
          : null,
    outcome,
    weak,
    embedding: embedText(text),
  };
}
