import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  idealAnswers,
  interviewEvents,
  interviewScorecards,
  interviewSessions,
  interviewTurns,
  newId,
  questionMemory,
  speechMetrics,
  starScores,
  withTransaction,
  type Database,
} from "@prepquest/db";
import {
  analyzeSpeech,
  cleanWords,
  countNumbers,
  getTemplate,
  inventedFacts,
  ownershipRatio,
  starCompleteness,
  starResultSchema,
  type InterviewPlan,
  type PlannedQuestion,
  type SpokenTurn,
  type TranscriptTurn,
} from "@prepquest/interview-core";
import {
  IDEAL_SYSTEM,
  PROMPT_VERSIONS,
  STAR_SYSTEM,
  buildIdealPrompt,
  buildStarPrompt,
  type IdealQuestionInput,
} from "@prepquest/prompts";
import type { AiContext } from "../ai-context.js";
import type { InterviewBus } from "./bus.js";
import { loadProblemContext, loadTurns } from "./context.js";
import { readPlan, readStateData } from "./state.js";

// The deeper review that follows the scorecard (E3 ideal answers, E4 STAR and speech, X5 memory).
// Each step is independent and best effort: a failure in one never takes the scorecard away.

const MAX_ATTEMPTS = 3;
const MIN_ANSWER_WORDS = 3;
const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

interface QuestionSpan {
  index: number;
  question: PlannedQuestion;
  turns: TranscriptTurn[];
  answers: TranscriptTurn[];
}

/** Which transcript turns belong to which question, by the interview time the question started. */
export function spansFor(
  plan: InterviewPlan,
  starts: readonly number[],
  turns: readonly TranscriptTurn[],
): QuestionSpan[] {
  const out: QuestionSpan[] = [];
  starts.forEach((start, index) => {
    const question = plan.questions[index];
    if (!question) return;
    const end = starts[index + 1] ?? Number.POSITIVE_INFINITY;
    const inRange = turns.filter(
      (t) => t.speaker !== "system" && t.offsetMs >= start && t.offsetMs < end,
    );
    const answers = inRange.filter(
      (t) => t.speaker === "candidate" && wordCount(t.text) >= MIN_ANSWER_WORDS,
    );
    out.push({ index, question, turns: inRange, answers });
  });
  return out;
}

const isBehavioral = (q: PlannedQuestion) => q.kind === "verbal" && q.category === "behavioral";

const idealSchema = z.object({
  answers: z
    .array(
      z.object({
        question_index: z.number().int().min(0),
        user_answer_summary: z.string().min(1).max(600),
        ideal_md: z.string().min(20).max(2500),
        gaps: z.array(z.string().max(200)).max(8).default([]),
        extras: z.array(z.string().max(200)).max(6).default([]),
        star_rewrite_md: z.string().max(2500).nullable().default(null),
        added_suggestions: z.array(z.string().max(300)).max(6).default([]),
      }),
    )
    .min(1)
    .max(8),
});

async function questionStarts(ctx: AiContext, sessionId: string) {
  const [s] = await ctx.db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.id, sessionId));
  if (!s) return null;
  const sd = readStateData(s);
  const plan = readPlan(s);
  // a question's span runs from when it was presented to when the next one was
  const starts = sd.questions.filter((q) => q.startMs >= 0).map((q) => q.startMs);
  return { session: s, plan, starts, sd };
}

// --- E3: ideal answers --------------------------------------------------------------------------

async function idealStep(
  ctx: AiContext,
  sessionId: string,
): Promise<{ weakByIndex: Map<number, boolean> }> {
  const info = await questionStarts(ctx, sessionId);
  const weakByIndex = new Map<number, boolean>();
  if (!info) return { weakByIndex };
  const { session, plan, starts } = info;
  const turns = await loadTurns(ctx.db, sessionId);
  const spans = spansFor(plan, starts, turns).filter((sp) => sp.answers.length > 0);
  if (spans.length === 0) return { weakByIndex };

  const pc = await loadProblemContext(ctx.db, plan);
  const inputs: IdealQuestionInput[] = spans.map((sp) => {
    const q = sp.question;
    return {
      index: sp.index,
      kind: q.kind,
      text:
        q.kind === "problem"
          ? `${q.title}: ${pc.facts[q.problemId]?.statementMd.slice(0, 700) ?? ""}`
          : q.question,
      reference:
        q.kind === "problem"
          ? (pc.facts[q.problemId]?.confidentialApproach ?? "")
          : q.kind === "verbal"
            ? q.reference
            : "",
      rubricPoints: q.kind === "problem" ? [] : q.rubricPoints,
      behavioral: isBehavioral(q),
      turns: sp.turns,
    };
  });
  const wanted = new Set(inputs.map((i) => i.index));
  const candidateText = new Map(spans.map((sp) => [sp.index, sp.answers.map((a) => a.text)]));

  const { value } = await ctx.llm.json(
    {
      task: "ideal",
      modelClass: "evaluator",
      system: IDEAL_SYSTEM,
      messages: [
        {
          role: "user",
          content: buildIdealPrompt({
            level: session.level,
            company: session.companyName,
            questions: inputs,
          }),
        },
      ],
      maxTokens: 6000,
      effort: "medium",
      userId: session.userId,
      sessionId,
      promptVersion: PROMPT_VERSIONS.ideal,
    },
    idealSchema,
    {
      check: (v) => {
        const issues: string[] = [];
        const got = new Set(v.answers.map((a) => a.question_index));
        for (const i of wanted) if (!got.has(i)) issues.push(`missing an answer for question ${i}`);
        for (const a of v.answers) {
          if (!wanted.has(a.question_index))
            issues.push(`question_index ${a.question_index} was not asked`);
          const q = plan.questions[a.question_index];
          if (q && isBehavioral(q)) {
            if (!a.star_rewrite_md)
              issues.push(
                `question ${a.question_index} is behavioural: star_rewrite_md is required`,
              );
            else {
              // the rewrite may only contain facts the candidate stated (doc 03 E3)
              const invented = inventedFacts(
                a.star_rewrite_md,
                candidateText.get(a.question_index) ?? [],
              );
              if (invented.length > 0) {
                issues.push(
                  `question ${a.question_index}: star_rewrite_md contains facts the candidate never stated (${invented.slice(0, 5).join(", ")}). Remove them or move them into an [added suggestion: ...] bracket.`,
                );
              }
            }
          }
        }
        return issues;
      },
    },
  );

  await withTransaction(ctx.db, async (tx) => {
    await tx.delete(idealAnswers).where(eq(idealAnswers.sessionId, sessionId));
    for (const a of value.answers) {
      const q = plan.questions[a.question_index];
      if (!q || !wanted.has(a.question_index)) continue;
      weakByIndex.set(a.question_index, a.gaps.length >= 3);
      await tx.insert(idealAnswers).values({
        id: newId(),
        sessionId,
        questionIndex: a.question_index,
        questionRef: q.kind === "problem" ? q.slug : q.sourceRef,
        questionText: q.kind === "problem" ? q.title : q.question,
        userAnswerSummary: a.user_answer_summary,
        idealMd: a.ideal_md,
        gaps: a.gaps,
        extras: a.extras,
        starRewriteMd: a.star_rewrite_md,
        addedSuggestions: a.added_suggestions,
      });
    }
  });
  return { weakByIndex };
}

// --- E4: STAR -----------------------------------------------------------------------------------

async function starStep(ctx: AiContext, sessionId: string): Promise<Map<number, number>> {
  const completenessBySeq = new Map<number, number>();
  const info = await questionStarts(ctx, sessionId);
  if (!info || getTemplate(info.session.templateKey)?.type !== "behavioral")
    return completenessBySeq;
  const turns = await loadTurns(ctx.db, sessionId);
  const spans = spansFor(info.plan, info.starts, turns).filter((sp) => isBehavioral(sp.question));
  // the main answer to each question is its longest candidate turn; short follow-up replies add little
  const answers = spans.flatMap((sp) => {
    const best = [...sp.answers].sort((a, b) => b.text.length - a.text.length)[0];
    return best && wordCount(best.text) >= 20 && sp.question.kind === "verbal"
      ? [{ seq: best.seq, question: sp.question.question, text: best.text }]
      : [];
  });
  if (answers.length === 0) return completenessBySeq;
  const bySeq = new Map(answers.map((a) => [a.seq, a.text]));

  const { value } = await ctx.llm.json(
    {
      task: "star",
      modelClass: "light",
      system: STAR_SYSTEM,
      messages: [{ role: "user", content: buildStarPrompt(answers) }],
      maxTokens: 4000,
      effort: "low",
      userId: info.session.userId,
      sessionId,
      promptVersion: PROMPT_VERSIONS.star,
    },
    starResultSchema,
    {
      check: (v) => {
        const issues: string[] = [];
        for (const a of v.answers) {
          const src = bySeq.get(a.turn_seq);
          if (src === undefined) {
            issues.push(`turn_seq ${a.turn_seq} is not one of the answers`);
            continue;
          }
          if (a.rewrite_md) {
            const invented = inventedFacts(a.rewrite_md, [src]);
            if (invented.length > 0) {
              issues.push(
                `turn ${a.turn_seq}: rewrite_md adds facts the candidate never stated (${invented.slice(0, 5).join(", ")})`,
              );
            }
          }
        }
        return issues;
      },
    },
  );
  await withTransaction(ctx.db, async (tx) => {
    await tx.delete(starScores).where(eq(starScores.sessionId, sessionId));
    for (const a of value.answers) {
      const text = bySeq.get(a.turn_seq);
      if (text === undefined) continue;
      completenessBySeq.set(a.turn_seq, starCompleteness(a));
      const ratio = ownershipRatio(text);
      await tx.insert(starScores).values({
        id: newId(),
        sessionId,
        turnSeq: a.turn_seq,
        s: a.s,
        t: a.t,
        a: a.a,
        r: a.r,
        // counted facts raise a model's specificity score by at most one step, never lower it
        specificity: Math.min(2, Math.max(a.specificity, countNumbers(text) >= 3 ? 1 : 0)),
        ownershipRatio: ratio === null ? null : ratio.toFixed(3),
        impact: a.impact,
        reflection: a.reflection,
        justification: a.justification,
        rewriteMd: a.rewrite_md,
      });
    }
  });
  return completenessBySeq;
}

// --- E4: speech analytics (code only) ------------------------------------------------------------

async function speechStep(ctx: AiContext, sessionId: string): Promise<void> {
  const info = await questionStarts(ctx, sessionId);
  if (!info) return;
  const rows = await ctx.db
    .select()
    .from(interviewTurns)
    .where(and(eq(interviewTurns.sessionId, sessionId), eq(interviewTurns.speaker, "candidate")))
    .orderBy(asc(interviewTurns.seq));
  const turns: SpokenTurn[] = rows.map((r) => ({
    seq: r.seq,
    offsetMs: r.offsetMs,
    text: r.text,
    modality: r.modality === "voice" ? "voice" : "text",
    words: Array.isArray(r.words) ? cleanWords(r.words as never) : null,
  }));
  if (turns.reduce((n, t) => n + wordCount(t.text), 0) < 20) return; // too little to say anything
  const events = await ctx.db
    .select({ offsetMs: interviewEvents.offsetMs, kind: interviewEvents.kind })
    .from(interviewEvents)
    .where(
      and(
        eq(interviewEvents.sessionId, sessionId),
        inArray(interviewEvents.kind, ["code_snapshot", "run", "submit"]),
      ),
    );
  const a = analyzeSpeech(turns, { codeActivityMs: events.map((e) => e.offsetMs) });
  const values = {
    words: a.words,
    wpm: a.wpm === null ? null : a.wpm.toFixed(1),
    fillerCounts: a.fillerCounts,
    fillerPerMin: a.fillerPerMin === null ? null : a.fillerPerMin.toFixed(2),
    longPauses: a.longPauses,
    hedgingRate: a.hedgingRate.toFixed(3),
    series: a.series,
    basis: a.basis,
  };
  await ctx.db
    .insert(speechMetrics)
    .values({ sessionId, ...values })
    .onConflictDoUpdate({ target: speechMetrics.sessionId, set: values });
}

// --- X5: memory ---------------------------------------------------------------------------------

async function memoryStep(
  ctx: AiContext,
  sessionId: string,
  weakByIndex: Map<number, boolean>,
  starBySeq: Map<number, number>,
) {
  const info = await questionStarts(ctx, sessionId);
  if (!info) return;
  const turns = await loadTurns(ctx.db, sessionId);
  const spans = spansFor(info.plan, info.starts, turns);
  for (const sp of spans) {
    const q = sp.question;
    if (q.kind === "problem") continue; // problems were judged when the session ended
    const star = sp.answers
      .map((a) => starBySeq.get(a.seq))
      .filter((x): x is number => x !== undefined);
    const weak =
      (weakByIndex.get(sp.index) ?? false) || (star.length > 0 && Math.min(...star) < 50);
    await ctx.db
      .update(questionMemory)
      .set({ weak, outcome: weak ? 0 : 1 })
      .where(and(eq(questionMemory.sessionId, sessionId), eq(questionMemory.refKey, q.sourceRef)));
  }
}

// --- the job ------------------------------------------------------------------------------------

export async function generateExtras(
  ctx: AiContext,
  _bus: InterviewBus,
  sessionId: string,
): Promise<void> {
  const [card] = await ctx.db
    .select()
    .from(interviewScorecards)
    .where(eq(interviewScorecards.sessionId, sessionId));
  if (!card || card.extrasStatus === "ready") return;
  await ctx.db
    .update(interviewScorecards)
    .set({ extrasStatus: "running", extrasAttempts: card.extrasAttempts + 1 })
    .where(eq(interviewScorecards.id, card.id));
  let failed = false;
  let weak = new Map<number, boolean>();
  let star = new Map<number, number>();
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      failed = true;
      ctx.log.warn({ err, sessionId, step: name }, "review step failed");
    }
  };
  await step("speech", () => speechStep(ctx, sessionId));
  await step("ideal", async () => void (weak = (await idealStep(ctx, sessionId)).weakByIndex));
  await step("star", async () => void (star = await starStep(ctx, sessionId)));
  await step("memory", () => memoryStep(ctx, sessionId, weak, star));
  const attempts = card.extrasAttempts + 1;
  await ctx.db
    .update(interviewScorecards)
    .set({ extrasStatus: failed ? (attempts >= MAX_ATTEMPTS ? "failed" : "pending") : "ready" })
    .where(eq(interviewScorecards.id, card.id));
}

export async function retryExtras(db: Database, sessionId: string) {
  await db
    .update(interviewScorecards)
    .set({ extrasStatus: "pending", extrasAttempts: 0 })
    .where(
      and(
        eq(interviewScorecards.sessionId, sessionId),
        eq(interviewScorecards.extrasStatus, "failed"),
      ),
    );
}
