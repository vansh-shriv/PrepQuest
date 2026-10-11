import { and, asc, desc, eq } from "drizzle-orm";
import {
  idealAnswers,
  interviewScorecards,
  interviewSessions,
  questionMemory,
  speechMetrics,
  starScores,
  type Database,
} from "@prepquest/db";
import { starCompleteness, type InterviewPlan } from "@prepquest/interview-core";
import {
  AppError,
  type CreateInterviewInput,
  type IdealAnswerDto,
  type QuestionHistoryItemDto,
  type SpeechMetricsDto,
  type StarScoreDto,
} from "@prepquest/shared";
import type { AiContext } from "../ai-context.js";
import { createSession } from "./service.js";
import { readPlan, type SessionRow } from "./state.js";

// Reads for the deeper review (E3, E4) and the user's question history (X5), plus "practice again".

export async function extrasStatus(db: Database, sessionId: string): Promise<string> {
  const [card] = await db
    .select({ s: interviewScorecards.extrasStatus, status: interviewScorecards.status })
    .from(interviewScorecards)
    .where(eq(interviewScorecards.sessionId, sessionId));
  if (!card) return "none";
  if (card.status !== "ready") return "pending";
  return card.s;
}

export async function getIdealAnswers(db: Database, sessionId: string): Promise<IdealAnswerDto[]> {
  const rows = await db
    .select()
    .from(idealAnswers)
    .where(eq(idealAnswers.sessionId, sessionId))
    .orderBy(asc(idealAnswers.questionIndex));
  return rows.map((r) => ({
    questionIndex: r.questionIndex,
    questionRef: r.questionRef,
    questionText: r.questionText,
    userAnswerSummary: r.userAnswerSummary,
    idealMd: r.idealMd,
    gaps: r.gaps,
    extras: r.extras,
    starRewriteMd: r.starRewriteMd,
    addedSuggestions: r.addedSuggestions,
  }));
}

export async function getStarScores(db: Database, sessionId: string): Promise<StarScoreDto[]> {
  const rows = await db
    .select()
    .from(starScores)
    .where(eq(starScores.sessionId, sessionId))
    .orderBy(asc(starScores.turnSeq));
  return rows.map((r) => ({
    turnSeq: r.turnSeq,
    s: r.s,
    t: r.t,
    a: r.a,
    r: r.r,
    specificity: r.specificity,
    impact: r.impact,
    reflection: r.reflection,
    completeness: starCompleteness({ s: r.s, t: r.t, a: r.a, r: r.r }),
    ownershipRatio: r.ownershipRatio === null ? null : Number(r.ownershipRatio),
    justification: r.justification,
    rewriteMd: r.rewriteMd,
  }));
}

export const SPEECH_NOTE =
  "These numbers are indicators from your transcript, not a diagnosis. Speech recognition errors and your own style both affect them.";

export async function getSpeech(db: Database, sessionId: string): Promise<SpeechMetricsDto | null> {
  const [r] = await db.select().from(speechMetrics).where(eq(speechMetrics.sessionId, sessionId));
  if (!r) return null;
  const pauses = (r.longPauses ?? []) as SpeechMetricsDto["longPauses"];
  const series = (r.series ?? []) as SpeechMetricsDto["series"];
  const flags: string[] = [];
  const wpm = r.wpm === null ? null : Number(r.wpm);
  if (wpm !== null && wpm > 170)
    flags.push("You spoke quickly on average. A slower pace helps the interviewer follow.");
  if (wpm !== null && wpm < 110)
    flags.push("You spoke slowly on average. Fine for thinking aloud, but watch long gaps.");
  if (r.words >= 150 && Object.values(r.fillerCounts).reduce((a, b) => a + b, 0) / r.words > 0.04) {
    flags.push("Filler words were frequent. A short pause usually reads better than a filler.");
  }
  if (r.words >= 150 && Number(r.hedgingRate) > 0.03) {
    flags.push(
      "Many hedges (maybe, I guess). State what you know, then name the uncertainty once.",
    );
  }
  if (pauses.filter((p) => p.kind === "dead_air").length >= 2) {
    flags.push(
      "Several long silences with no coding. Say what you are thinking while you work it out.",
    );
  }
  return {
    basis: r.basis as "voice" | "text",
    words: r.words,
    wpm,
    fillerCounts: r.fillerCounts,
    fillerPerMin: r.fillerPerMin === null ? null : Number(r.fillerPerMin),
    hedgingRate: Number(r.hedgingRate ?? 0),
    longPauses: pauses,
    series,
    flags,
    note: SPEECH_NOTE,
  };
}

// --- practice a question again (E3) ----------------------------------------------------------------

/**
 * A new interview with just this question. For spoken questions the points the candidate missed last
 * time become hidden things to probe for (the "ideal answer as a benchmark"). Same rules as any new
 * interview: one live interview at a time, rate limits.
 */
export async function retryQuestion(
  ctx: AiContext,
  userId: string,
  source: SessionRow,
  questionIndex: number,
): Promise<SessionRow> {
  const plan = readPlan(source) as InterviewPlan;
  const q = plan.questions[questionIndex];
  if (!q)
    throw new AppError("VALIDATION_FAILED", 422, "That question was not part of the interview");
  const base: CreateInterviewInput = {
    type: source.type as CreateInterviewInput["type"],
    level: source.level as CreateInterviewInput["level"],
    persona: source.persona as CreateInterviewInput["persona"],
    mode: source.mode as CreateInterviewInput["mode"],
    difficulty: source.difficulty,
    adaptive: false,
    hintBudget: source.hintBudget,
    interruptionLevel: source.interruptionLevel as CreateInterviewInput["interruptionLevel"],
    realistic: source.realistic,
    role: source.role,
    company: source.companyName,
    resumeId: source.resumeId,
    jdId: source.jdId,
    packSlug: plan.packSlug ?? null,
    minutes: Math.max(15, Math.min(30, plan.minutes)),
  };
  const [ideal] = await ctx.db
    .select()
    .from(idealAnswers)
    .where(
      and(eq(idealAnswers.sessionId, source.id), eq(idealAnswers.questionIndex, questionIndex)),
    );
  const gaps = ideal?.gaps ?? [];

  if (q.kind === "problem") {
    return createSession(
      ctx,
      userId,
      { ...base, minutes: Math.max(25, base.minutes ?? 30), problemSlugs: [q.slug] },
      undefined,
    );
  }
  if (q.kind === "verbal") {
    const row = await createSession(
      ctx,
      userId,
      { ...base, questionSlugs: [q.sourceRef] },
      undefined,
    );
    return withBenchmark(ctx.db, row, gaps);
  }
  const row = await createSession(ctx, userId, { ...base, projectRefs: [q.sourceRef] }, undefined);
  return withBenchmark(ctx.db, row, gaps);
}

async function withBenchmark(
  db: Database,
  row: SessionRow,
  gaps: readonly string[],
): Promise<SessionRow> {
  if (gaps.length === 0) return row;
  const plan = readPlan(row);
  const first = plan.questions[0];
  if (!first || first.kind === "problem") return row;
  const patched: InterviewPlan = {
    ...plan,
    questions: [
      {
        ...first,
        rubricPoints: [
          ...first.rubricPoints,
          ...gaps.map((g) => `Last time this was missed: ${g}`),
        ],
      },
      ...plan.questions.slice(1),
    ],
  };
  await db.update(interviewSessions).set({ plan: patched }).where(eq(interviewSessions.id, row.id));
  return { ...row, plan: patched };
}

// --- question history (X5) -------------------------------------------------------------------------

export async function listQuestionHistory(
  db: Database,
  userId: string,
  limit = 100,
): Promise<QuestionHistoryItemDto[]> {
  const rows = await db
    .select()
    .from(questionMemory)
    .where(eq(questionMemory.userId, userId))
    .orderBy(desc(questionMemory.askedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    questionText: r.questionText,
    topic: r.topic,
    outcome: r.outcome,
    weak: r.weak,
    askedAt: r.askedAt.toISOString(),
  }));
}

export async function deleteQuestionHistory(
  db: Database,
  userId: string,
  id: string,
): Promise<void> {
  const res = await db
    .delete(questionMemory)
    .where(and(eq(questionMemory.id, id), eq(questionMemory.userId, userId)))
    .returning({ id: questionMemory.id });
  if (res.length === 0) throw new AppError("NOT_FOUND", 404, "That entry doesn't exist");
}

export async function clearQuestionHistory(db: Database, userId: string): Promise<number> {
  const res = await db
    .delete(questionMemory)
    .where(eq(questionMemory.userId, userId))
    .returning({ id: questionMemory.id });
  return res.length;
}
