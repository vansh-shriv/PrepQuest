import { and, asc, eq } from "drizzle-orm";
import {
  interviewEvents,
  interviewScorecards,
  interviewSessions,
  newId,
  scorecardScores,
  submissions,
  transcriptAnnotations,
  withTransaction,
} from "@prepquest/db";
import {
  annotationsDraftSchema,
  correctnessFromAttempts,
  finalizeScorecard,
  getRubric,
  getTemplate,
  scorecardDraftSchema,
  trimQuote,
  verifyDraft,
  withWeights,
  type Evidence,
  type Rubric,
  type TranscriptTurn,
} from "@prepquest/interview-core";
import {
  ANNOTATIONS_SYSTEM,
  PROMPT_VERSIONS,
  SCORECARD_SYSTEM,
  buildAnnotationsPrompt,
  buildScorecardPrompt,
  mmss,
} from "@prepquest/prompts";
import type { AiContext } from "../ai-context.js";
import type { InterviewBus } from "./bus.js";
import { loadTurns } from "./context.js";
import { generateExtras } from "./extras.js";
import { elapsedMs, plannedMs, readPlan, readStateData } from "./state.js";

const MAX_ATTEMPTS = 3;

/** Correctness inputs from the judge's own records for the questions asked in this interview. */
async function judgeCorrectness(ctx: AiContext, sessionId: string, problemIds: string[]) {
  const rows = await ctx.db
    .select({
      id: submissions.id,
      problemId: submissions.problemId,
      verdict: submissions.verdict,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .where(and(eq(submissions.interviewSessionId, sessionId), eq(submissions.kind, "submit")))
    .orderBy(asc(submissions.createdAt));
  const evidence: Evidence[] = [];
  const perProblem = problemIds.map((pid) => {
    const subs = rows.filter((r) => r.problemId === pid);
    const ac = subs.findIndex((r) => r.verdict === "AC");
    const last = subs.at(-1);
    if (last) {
      evidence.push({
        type: "code",
        ref: last.id,
        quote: `final verdict ${ac >= 0 ? "AC" : last.verdict} after ${subs.length} submission(s)`,
      });
    }
    return {
      accepted: ac >= 0,
      attemptsBeforeAc: ac >= 0 ? ac : subs.length,
      submissions: subs.length,
    };
  });
  const result = correctnessFromAttempts(perProblem);
  return { ...result, evidence };
}

function segmentTiming(
  sd: ReturnType<typeof readStateData>,
  plan: ReturnType<typeof readPlan>,
  endMs: number,
) {
  return (
    sd.questions
      .map((q) => {
        const seg = plan.segments.find((s) => s.key === plan.questions[q.index]?.segmentKey);
        const planned = seg ? Math.round((seg.endMs - seg.startMs) / 60_000) : 0;
        const used = Math.round(((q.endMs ?? endMs) - q.startMs) / 60_000);
        return `Question ${q.index + 1}: planned ${planned} min, used ${used} min, hints ${q.hints}, ${q.solved ? "accepted by the judge" : "not accepted"}`;
      })
      .join("\n") || "(no questions were started)"
  );
}

export async function generateScorecard(
  ctx: AiContext,
  bus: InterviewBus,
  sessionId: string,
): Promise<void> {
  const [card] = await ctx.db
    .select()
    .from(interviewScorecards)
    .where(eq(interviewScorecards.sessionId, sessionId));
  if (!card || card.status === "ready") return;
  await ctx.db
    .update(interviewScorecards)
    .set({ attempts: card.attempts + 1, status: "generating", lastError: null })
    .where(eq(interviewScorecards.id, card.id));

  try {
    const [s] = await ctx.db
      .select()
      .from(interviewSessions)
      .where(eq(interviewSessions.id, sessionId));
    if (!s) return;
    const template = getTemplate(s.templateKey);
    const baseRubric: Rubric | undefined = getRubric(template?.rubricId ?? card.rubricId);
    if (!template || !baseRubric) throw new Error("rubric not found");
    // a company pack changes the weights, never the anchors (doc 03 I2)
    const rubric = withWeights(baseRubric, readPlan(s).rubricWeights);
    const turns = await loadTurns(ctx.db, sessionId);
    const events = await ctx.db
      .select()
      .from(interviewEvents)
      .where(eq(interviewEvents.sessionId, sessionId))
      .orderBy(asc(interviewEvents.offsetMs), asc(interviewEvents.id));
    const plan = readPlan(s);
    const sd = readStateData(s);
    const endMs = s.endedAt && s.startedAt ? elapsedMs(s, s.endedAt) : plannedMs(s);

    // code the evidence may quote: the final code and every run's code
    const code: Record<string, string> = {};
    const runLines: string[] = [];
    for (const ev of events) {
      const p = ev.payload as {
        code?: string;
        verdict?: string;
        passed?: number;
        total?: number;
        language?: string;
      };
      if (ev.kind === "code_snapshot" && p.code) code.final = p.code;
      if ((ev.kind === "run" || ev.kind === "submit") && p.code) {
        code.final = p.code;
        runLines.push(
          `- ${mmss(ev.offsetMs)} ${ev.kind} ${p.verdict ?? "?"}${p.total ? ` ${p.passed ?? 0}/${p.total}` : ""} (${p.language ?? "?"})`,
        );
      }
      if (ev.kind === "paste") runLines.push(`- ${mmss(ev.offsetMs)} paste event`);
    }
    const finalCode = code.final ? code.final.split("\n").slice(0, 150).join("\n") : "";
    const codeSummary = template.usesEditor
      ? `${runLines.join("\n") || "- (no runs)"}\n\nFINAL CODE (ref "final"):\n${finalCode || "(none)"}`
      : "";

    const problemIds = plan.questions.flatMap((q) => (q.kind === "problem" ? [q.problemId] : []));
    const judge = template.usesEditor
      ? await judgeCorrectness(ctx, sessionId, problemIds)
      : undefined;

    const prompt = buildScorecardPrompt({
      rubric,
      level: s.level,
      companyStyle: s.companyName
        ? `${s.companyName} (style inspired by public patterns)`
        : "a typical product company",
      persona: s.persona,
      difficulty: s.difficulty,
      turns,
      codeSummary,
      hintsGiven: s.hintsGiven,
      hintBudget: s.hintBudget,
      segmentTiming: segmentTiming(sd, plan, endMs),
    });
    const { value: draft, result } = await ctx.llm.json(
      {
        task: "scorecard",
        modelClass: "evaluator",
        system: SCORECARD_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 6000,
        effort: "high",
        userId: s.userId,
        sessionId,
        promptVersion: PROMPT_VERSIONS.scorecard,
      },
      scorecardDraftSchema,
      { check: (d) => verifyDraft(d, rubric, { turns, code }) },
    );

    const final = finalizeScorecard(draft, rubric, judge);
    const trim = (e: Evidence[]) => e.map((x) => ({ ...x, quote: trimQuote(x.quote) }));
    const sessionCoverage = Math.min(1, endMs / Math.max(1, plannedMs(s)));
    await withTransaction(ctx.db, async (tx) => {
      await tx
        .update(interviewScorecards)
        .set({
          status: "ready",
          // with no scored dimension there is nothing to average: say so instead of showing 0
          overall: final.coverage === 0 ? null : final.overall,
          band: final.coverage === 0 ? null : final.band,
          summary: draft.summary,
          strengths: draft.strengths.map((x) => ({ ...x, evidence: trim(x.evidence) })),
          redFlags: draft.red_flags.map((x) => ({ ...x, evidence: trim(x.evidence) })),
          nextActions: draft.next_actions,
          coverage: {
            rubric: final.coverage,
            session: Math.round(sessionCoverage * 100) / 100,
            endReason: s.endReason,
            lowConfidence: final.coverage < 0.6 || sessionCoverage < 0.5,
          },
          model: result.model,
          promptVersion: PROMPT_VERSIONS.scorecard,
          lastError: null,
        })
        .where(eq(interviewScorecards.id, card.id));
      await tx.delete(scorecardScores).where(eq(scorecardScores.scorecardId, card.id));
      await tx.insert(scorecardScores).values(
        final.scores.map((x) => ({
          scorecardId: card.id,
          dimension: x.dimension,
          score: x.score,
          weight: (x.weight / 100).toFixed(3),
          justification: x.justification,
          evidence: x.evidence,
        })),
      );
    });
    await generateAnnotations(ctx, s.userId, sessionId, rubric, turns).catch((err: unknown) =>
      ctx.log.warn({ err, sessionId }, "annotations failed; the scorecard is still ready"),
    );
    bus.publish(sessionId, { type: "scorecard.ready" });
    await generateExtras(ctx, bus, sessionId).catch((err: unknown) =>
      ctx.log.warn({ err, sessionId }, "review extras failed"),
    );
  } catch (err) {
    const attempts = card.attempts + 1;
    const message = err instanceof Error ? err.message.slice(0, 500) : "scorecard failed";
    ctx.log.error({ err, sessionId, attempts }, "scorecard generation failed");
    await ctx.db
      .update(interviewScorecards)
      .set({ status: attempts >= MAX_ATTEMPTS ? "failed" : "generating", lastError: message })
      .where(eq(interviewScorecards.id, card.id));
  }
}

async function generateAnnotations(
  ctx: AiContext,
  userId: string,
  sessionId: string,
  rubric: Rubric,
  turns: TranscriptTurn[],
) {
  const candidateSeqs = new Set(turns.filter((t) => t.speaker === "candidate").map((t) => t.seq));
  if (candidateSeqs.size === 0) return;
  const { value } = await ctx.llm.json(
    {
      task: "annotations",
      modelClass: "evaluator",
      system: ANNOTATIONS_SYSTEM,
      messages: [
        {
          role: "user",
          content: buildAnnotationsPrompt(
            turns,
            rubric.dimensions.map((d) => d.key),
          ),
        },
      ],
      maxTokens: 4000,
      effort: "medium",
      userId,
      sessionId,
      promptVersion: PROMPT_VERSIONS.annotations,
    },
    annotationsDraftSchema,
    {
      check: (v) =>
        v.annotations
          .filter((a) => !candidateSeqs.has(a.turn_seq))
          .map((a) => `turn_seq ${a.turn_seq} is not a candidate turn`),
    },
  );
  const offset = new Map(turns.map((t) => [t.seq, t.offsetMs]));
  const seen = new Set<string>();
  const rows = value.annotations
    .filter((a) => {
      const k = `${a.turn_seq}:${a.kind}:${a.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((a) => ({
      id: newId(),
      sessionId,
      offsetMs: offset.get(a.turn_seq) ?? 0,
      turnSeq: a.turn_seq,
      kind: a.kind,
      dimension: a.dimension,
      text: a.text,
      severity: a.severity,
    }));
  await ctx.db.delete(transcriptAnnotations).where(eq(transcriptAnnotations.sessionId, sessionId));
  if (rows.length > 0) await ctx.db.insert(transcriptAnnotations).values(rows);
}
