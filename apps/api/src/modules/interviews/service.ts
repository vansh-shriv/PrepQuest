import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import {
  interviewEvents,
  interviewScorecards,
  interviewSessions,
  interviewTurns,
  newId,
  scorecardScores,
  transcriptAnnotations,
  type Database,
} from "@prepquest/db";
import { getRubric, getTemplate, TEMPLATES, type InterviewPlan } from "@prepquest/interview-core";
import { PROMPT_VERSIONS, mmss } from "@prepquest/prompts";
import { AppError, type CreateInterviewInput, type InterviewSessionDto } from "@prepquest/shared";
import type { AiContext } from "../ai-context.js";
import { buildSessionPlan } from "./plan.js";
import { elapsedMs, readPlan, readStateData, remainingMsOf, type SessionRow } from "./state.js";

// ---------------------------------------------------------------- DTOs

/** What the browser may know about the plan: nothing about questions that were not asked yet. */
export function toSessionDto(s: SessionRow, now: Date): InterviewSessionDto {
  const plan = readPlan(s);
  const sd = readStateData(s);
  const template = getTemplate(s.templateKey);
  const asked = s.startedAt !== null && s.state !== "SETUP" && s.state !== "WARMUP";
  const questions = plan.questions.map((q, i) => {
    const visible = asked ? i <= sd.questionIndex : false;
    if (!visible && !s.endedAt)
      return { kind: q.kind, segment: q.segmentKey, hidden: true as const };
    return q.kind === "problem"
      ? {
          kind: "problem" as const,
          segment: q.segmentKey,
          hidden: false as const,
          slug: q.slug,
          title: q.title,
          difficulty: q.difficulty,
        }
      : {
          kind: "project" as const,
          segment: q.segmentKey,
          hidden: false as const,
          sourceRef: q.sourceRef,
          title: q.question,
        };
  });
  return {
    id: s.id,
    type: s.type as InterviewSessionDto["type"],
    title: template?.title ?? s.type,
    usesEditor: template?.usesEditor ?? false,
    state: s.state,
    persona: s.persona,
    level: s.level,
    role: s.role,
    company: s.companyName,
    difficulty: s.difficulty,
    adaptive: s.adaptive,
    realistic: s.realistic,
    hintBudget: s.hintBudget,
    hintsGiven: s.hintsGiven,
    hintsLeft: Math.max(0, s.hintBudget - s.hintsGiven),
    mode: s.mode,
    minutes: plan.minutes,
    segments: plan.segments.map((x) => ({
      key: x.key,
      name: x.name,
      kind: x.kind,
      startMs: x.startMs,
      endMs: x.endMs,
    })),
    questions,
    questionIndex: sd.questionIndex,
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    endReason: s.endReason,
    paused: s.pausedAt !== null,
    pausesUsed: s.pausesUsed,
    remainingMs: s.endedAt ? 0 : s.startedAt ? remainingMsOf(s, now) : plan.minutes * 60_000,
    elapsedMs: elapsedMs(s, now),
    resumeId: s.resumeId,
    jdId: s.jdId,
    createdAt: s.createdAt.toISOString(),
  };
}

export function templatesDto() {
  return Object.values(TEMPLATES).map((t) => ({
    type: t.type,
    title: t.title,
    description: t.description,
    defaultMinutes: t.defaultMinutes,
    minMinutes: t.minMinutes,
    maxMinutes: t.maxMinutes,
    segments: t.segments.map((x) => ({ name: x.name, minutes: x.minutes, kind: x.kind })),
    usesEditor: t.usesEditor,
    needsResume: t.needsResume,
  }));
}

// ---------------------------------------------------------------- plan and create

export async function previewPlan(ctx: AiContext, userId: string, input: CreateInterviewInput) {
  const res = await buildSessionPlan(ctx, userId, input, { generate: false });
  return {
    type: res.template.type,
    title: res.template.title,
    minutes: res.minutes,
    segments: res.plan.segments,
    questions: res.plan.questions.map((q) =>
      q.kind === "problem"
        ? {
            kind: "problem" as const,
            slug: q.slug,
            title: q.title,
            difficulty: q.difficulty,
            tags: q.tags,
          }
        : { kind: "project" as const, sourceRef: q.sourceRef, title: q.question },
    ),
    resumeId: res.resumeId,
    jdId: res.jdId,
    warnings: res.warnings,
    /** Company packs are Phase 8; custom text is kept as a label only. */
    note: input.company
      ? "Practice style inspired by public patterns; not an official process."
      : null,
  };
}

export async function createSession(
  ctx: AiContext,
  userId: string,
  input: CreateInterviewInput,
  idempotencyKey: string | undefined,
): Promise<SessionRow> {
  if (idempotencyKey) {
    const [existing] = await ctx.db
      .select()
      .from(interviewSessions)
      .where(
        and(
          eq(interviewSessions.userId, userId),
          eq(interviewSessions.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing) return existing;
  }
  const [live] = await ctx.db
    .select({ id: interviewSessions.id })
    .from(interviewSessions)
    .where(
      and(
        eq(interviewSessions.userId, userId),
        sql`${interviewSessions.startedAt} IS NOT NULL`,
        isNull(interviewSessions.endedAt),
      ),
    );
  if (live) {
    throw new AppError("INTERVIEW_IN_PROGRESS", 409, "You already have an interview in progress.", {
      sessionId: live.id,
    });
  }
  if (input.mode !== "text" && !ctx.env.FF_VOICE) {
    throw new AppError("VOICE_DISABLED", 422, "Voice interviews are not enabled on this server.");
  }
  await ctx.limiter.enforce(
    `interview:h:${userId}`,
    ctx.env.RL_INTERVIEWS_PER_HOUR,
    3_600,
    "interviews",
  );
  await ctx.limiter.enforce(
    `interview:d:${userId}`,
    ctx.env.RL_INTERVIEWS_PER_DAY,
    86_400,
    "interviews today",
  );

  const res = await buildSessionPlan(ctx, userId, input, { generate: true });
  // a plan that was never started is replaced by the new one
  await ctx.db
    .update(interviewSessions)
    .set({ state: "ABANDONED", endedAt: ctx.now(), endReason: "abandoned" })
    .where(
      and(
        eq(interviewSessions.userId, userId),
        eq(interviewSessions.state, "SETUP"),
        isNull(interviewSessions.startedAt),
      ),
    );
  const id = newId();
  const [row] = await ctx.db
    .insert(interviewSessions)
    .values({
      id,
      userId,
      templateKey: res.template.key,
      type: res.template.type,
      role: input.role ?? null,
      companyName: input.company ?? null,
      level: input.level,
      resumeId: res.resumeId,
      jdId: res.jdId,
      persona: input.persona,
      mode: input.mode,
      difficulty: input.difficulty,
      adaptive: input.adaptive,
      hintBudget: res.template.type === "dsa" ? input.hintBudget : 0,
      interruptionLevel: input.interruptionLevel,
      realistic: input.realistic,
      plan: res.plan satisfies InterviewPlan,
      stateData: {},
      plannedSeconds: res.minutes * 60,
      promptVersion: `interviewer@${PROMPT_VERSIONS.interviewer},scorecard@${PROMPT_VERSIONS.scorecard}`,
      modelConfig: {
        interviewer: ctx.llm.modelFor("interviewer"),
        evaluator: ctx.llm.modelFor("evaluator"),
        light: ctx.llm.modelFor("light"),
      },
      idempotencyKey: idempotencyKey ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const [winner] = await ctx.db
      .select()
      .from(interviewSessions)
      .where(
        and(
          eq(interviewSessions.userId, userId),
          eq(interviewSessions.idempotencyKey, idempotencyKey ?? ""),
        ),
      );
    if (!winner) throw new AppError("INTERNAL", 500, "Could not create the interview");
    return winner;
  }
  return row;
}

// ---------------------------------------------------------------- reads

export async function listSessions(
  db: Database,
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  const rows = await db
    .select({
      s: interviewSessions,
      overall: interviewScorecards.overall,
      band: interviewScorecards.band,
      scoreStatus: interviewScorecards.status,
    })
    .from(interviewSessions)
    .leftJoin(interviewScorecards, eq(interviewScorecards.sessionId, interviewSessions.id))
    .where(
      and(
        eq(interviewSessions.userId, userId),
        sql`${interviewSessions.state} <> 'SETUP'`,
        cursor ? lt(interviewSessions.createdAt, new Date(cursor)) : sql`true`,
      ),
    )
    .orderBy(desc(interviewSessions.createdAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({
      id: r.s.id,
      type: r.s.type,
      title: getTemplate(r.s.templateKey)?.title ?? r.s.type,
      persona: r.s.persona,
      difficulty: r.s.difficulty,
      state: r.s.state,
      endReason: r.s.endReason,
      startedAt: r.s.startedAt?.toISOString() ?? null,
      endedAt: r.s.endedAt?.toISOString() ?? null,
      overall: r.overall,
      band: r.band,
      scorecardStatus: r.scoreStatus ?? "none",
      createdAt: r.s.createdAt.toISOString(),
    })),
    nextCursor:
      rows.length > limit ? (page[page.length - 1]?.s.createdAt.toISOString() ?? null) : null,
  };
}

export async function getTurns(db: Database, sessionId: string, afterSeq = 0) {
  const rows = await db
    .select()
    .from(interviewTurns)
    .where(and(eq(interviewTurns.sessionId, sessionId), sql`${interviewTurns.seq} > ${afterSeq}`))
    .orderBy(asc(interviewTurns.seq));
  return rows.map((r) => ({
    seq: r.seq,
    speaker: r.speaker,
    text: r.text,
    offsetMs: r.offsetMs,
    turnId: r.id,
    hintUsed: Boolean((r.meta as { hint_level?: number } | null)?.hint_level),
    modality: r.modality as "text" | "voice",
    interrupted: Boolean((r.meta as { interrupted?: boolean } | null)?.interrupted),
  }));
}

export async function getReview(db: Database, s: SessionRow, now: Date) {
  const [card] = await db
    .select()
    .from(interviewScorecards)
    .where(eq(interviewScorecards.sessionId, s.id));
  const transcript = await getTurns(db, s.id);
  const base = { session: toSessionDto(s, now), transcript };
  if (!card) return { status: "none" as const, ...base, scorecard: null, annotations: [] };
  if (card.status !== "ready") {
    return {
      status: card.status as "generating" | "failed",
      ...base,
      scorecard: null,
      annotations: [],
    };
  }
  const rubric = getRubric(card.rubricId);
  const scores = await db
    .select()
    .from(scorecardScores)
    .where(eq(scorecardScores.scorecardId, card.id));
  const annotations = await db
    .select()
    .from(transcriptAnnotations)
    .where(eq(transcriptAnnotations.sessionId, s.id))
    .orderBy(asc(transcriptAnnotations.offsetMs));
  const names = new Map(rubric?.dimensions.map((d) => [d.key, d.name]) ?? []);
  const order = new Map(rubric?.dimensions.map((d, i) => [d.key, i]) ?? []);
  return {
    status: "ready" as const,
    ...base,
    scorecard: {
      overall: card.overall,
      band: card.band,
      summary: card.summary,
      strengths: card.strengths ?? [],
      redFlags: card.redFlags ?? [],
      nextActions: card.nextActions ?? [],
      coverage: card.coverage ?? null,
      helpful: card.helpful,
      rubric: { id: card.rubricId, version: card.rubricVersion },
      model: card.model,
      scores: scores
        .map((x) => ({
          dimension: x.dimension,
          name: names.get(x.dimension) ?? x.dimension,
          score: x.score,
          weight: Number(x.weight),
          justification: x.justification,
          evidence: x.evidence,
        }))
        .sort((a, b) => (order.get(a.dimension) ?? 99) - (order.get(b.dimension) ?? 99)),
    },
    annotations: annotations.map((a) => ({
      id: a.id,
      turnSeq: a.turnSeq,
      offsetMs: a.offsetMs,
      kind: a.kind,
      dimension: a.dimension,
      text: a.text,
      severity: a.severity,
      note: a.note,
    })),
  };
}

export async function transcriptMarkdown(db: Database, s: SessionRow, now: Date): Promise<string> {
  const review = await getReview(db, s, now);
  const notes = new Map(review.annotations.map((a) => [a.turnSeq, a]));
  const lines = [
    `# ${review.session.title}`,
    "",
    `Persona: ${s.persona} - Difficulty: ${s.difficulty}/5 - ${review.session.minutes} min`,
    "",
  ];
  for (const t of review.transcript) {
    if (t.speaker === "system") continue;
    lines.push(
      `**${t.speaker === "interviewer" ? "Interviewer" : "You"}** (${mmss(t.offsetMs)}): ${t.text}`,
      "",
    );
    const a = notes.get(t.seq);
    if (a) lines.push(`> ${a.kind.replace("_", " ")}: ${a.text}`, "");
  }
  if (review.scorecard) {
    lines.push(
      "---",
      "",
      `## Scorecard: ${review.scorecard.overall}/100 (${review.scorecard.band})`,
      "",
      review.scorecard.summary ?? "",
    );
  }
  return lines.join("\n");
}

export async function setAnnotationNote(
  db: Database,
  sessionId: string,
  annId: string,
  note: string | null,
) {
  const res = await db
    .update(transcriptAnnotations)
    .set({ note })
    .where(and(eq(transcriptAnnotations.id, annId), eq(transcriptAnnotations.sessionId, sessionId)))
    .returning({ id: transcriptAnnotations.id });
  if (res.length === 0) throw new AppError("NOT_FOUND", 404, "Annotation not found");
}

export async function saveFeedback(
  db: Database,
  sessionId: string,
  helpful: boolean,
  text: string | null,
) {
  const res = await db
    .update(interviewScorecards)
    .set({ helpful: helpful ? 1 : 0, feedbackText: text })
    .where(eq(interviewScorecards.sessionId, sessionId))
    .returning({ id: interviewScorecards.id });
  if (res.length === 0) throw new AppError("NOT_FOUND", 404, "There is no scorecard to rate yet");
}

export async function getEvents(
  db: Database,
  sessionId: string,
  from = 0,
  to = Number.MAX_SAFE_INTEGER,
) {
  const rows = await db
    .select()
    .from(interviewEvents)
    .where(
      and(
        eq(interviewEvents.sessionId, sessionId),
        sql`${interviewEvents.offsetMs} >= ${from}`,
        sql`${interviewEvents.offsetMs} <= ${Math.min(to, 2_000_000_000)}`,
      ),
    )
    .orderBy(asc(interviewEvents.offsetMs), asc(interviewEvents.id));
  return rows.map((r) => ({ id: r.id, offsetMs: r.offsetMs, kind: r.kind, payload: r.payload }));
}

export async function retryScorecard(db: Database, sessionId: string) {
  const res = await db
    .update(interviewScorecards)
    .set({ status: "generating", attempts: 0, lastError: null })
    .where(
      and(eq(interviewScorecards.sessionId, sessionId), eq(interviewScorecards.status, "failed")),
    )
    .returning({ id: interviewScorecards.id });
  if (res.length === 0)
    throw new AppError("CONFLICT", 409, "Only a failed scorecard can be regenerated");
}
