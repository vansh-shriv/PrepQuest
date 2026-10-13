import { and, asc, eq } from "drizzle-orm";
import {
  complexityAnalyses,
  newId,
  problems,
  submissionResults,
  submissions,
  type Database,
} from "@prepquest/db";
import {
  GROWTH_LABEL,
  describeGrowth,
  buildScaledInput,
  compareClaim,
  estimateGrowth,
  staticHints,
  type EstimateResult,
  type ScaleSample,
  type ScaleSpec,
} from "@prepquest/analytics-core";
import {
  AppError,
  isTerminal,
  type ComplexityCreate,
  type ComplexityDto,
  type ComplexitySampleDto,
  type VerdictValue,
} from "@prepquest/shared";
import { CUSTOM_ORDINAL_BASE, createReviewRun } from "../submissions/service.js";
import type { ReviewCtx } from "./review.js";

// Complexity analyzer (X4): the learner's code runs on generated inputs of growing size, the judge reports the
// time of each, and pure code fits the growth curve and compares it with the claim. The result is an estimate.

/** Each size is run this many times and the fastest time counts. */
const TIMING_REPEATS = 3;
const PER_MINUTE = 5;
const PER_DAY = 30;

export const CAVEAT =
  "This is an empirical estimate from timed runs on generated inputs, not a proof. The timing includes reading the input, small sizes are noisy, and the speed of some code depends on the input.";

interface StoredResult {
  /** Sizes that were queued, in order; the run's custom tests map to them one by one. */
  sizes: number[];
  samples?: ComplexitySampleDto[];
  estimate?: EstimateResult;
  verdict?: ComplexityDto["verdict"];
  message?: string;
  hint?: ComplexityDto["hint"];
}

type Row = typeof complexityAnalyses.$inferSelect;

function toDto(row: Row): ComplexityDto {
  const r = (row.result ?? { sizes: [] }) as unknown as StoredResult;
  const est = r.estimate?.status === "ok" ? r.estimate.estimate : null;
  return {
    id: row.id,
    submissionId: row.submissionId,
    claimed: row.claimed,
    status: row.status as ComplexityDto["status"],
    samples: r.samples ?? [],
    measured: est
      ? { id: est.best, label: describeGrowth(est), r2: est.r2, confidence: est.confidence }
      : null,
    plausible: est ? est.plausible.map((id) => GROWTH_LABEL[id]) : [],
    verdict: r.verdict ?? null,
    message: r.message ?? null,
    hint: r.hint ?? null,
    caveat: CAVEAT,
    error: row.error,
  };
}

/** Whether a problem has generators; the web shows the form only when it does. */
export async function supportsComplexity(db: Database, userId: string, submissionId: string) {
  const [row] = await db
    .select({ scale: problems.scale })
    .from(submissions)
    .innerJoin(problems, eq(problems.id, submissions.problemId))
    .where(and(eq(submissions.id, submissionId), eq(submissions.userId, userId)));
  if (!row) throw new AppError("NOT_FOUND", 404, "Submission not found");
  return { supported: row.scale !== null };
}

export async function getComplexity(
  db: Database,
  userId: string,
  submissionId: string,
): Promise<ComplexityDto | null> {
  const [row] = await db
    .select()
    .from(complexityAnalyses)
    .where(
      and(eq(complexityAnalyses.userId, userId), eq(complexityAnalyses.submissionId, submissionId)),
    );
  return row ? toDto(await resolve(db, row)) : null;
}

export async function startComplexity(
  ctx: ReviewCtx,
  userId: string,
  submissionId: string,
  input: ComplexityCreate,
): Promise<ComplexityDto> {
  const db = ctx.ai.db;
  const [found] = await db
    .select({ s: submissions, p: problems })
    .from(submissions)
    .innerJoin(problems, eq(problems.id, submissions.problemId))
    .where(and(eq(submissions.id, submissionId), eq(submissions.userId, userId)));
  if (!found || found.s.mode === "review") {
    throw new AppError("NOT_FOUND", 404, "Submission not found");
  }
  const { s, p } = found;
  const spec = p.scale as unknown as ScaleSpec | null;
  if (!spec || !p.signature) {
    throw new AppError(
      "UNSUPPORTED",
      422,
      "The complexity check isn't set up for this problem yet.",
    );
  }
  const verdict = s.verdict as VerdictValue;
  if (!isTerminal(verdict)) {
    throw new AppError("CONFLICT", 409, "Wait for the judge to finish first.");
  }
  if (verdict === "CE" || verdict === "IE") {
    throw new AppError("UNSUPPORTED", 422, "Only code that compiles and runs can be measured.");
  }
  // a measurement already running is returned as it is
  const [current] = await db
    .select()
    .from(complexityAnalyses)
    .where(eq(complexityAnalyses.submissionId, submissionId));
  if (current?.status === "running") return toDto(await resolve(db, current));

  await ctx.ai.limiter.enforce(`cx:min:${userId}`, PER_MINUTE, 60, "complexity checks");
  await ctx.ai.limiter.enforce(`cx:day:${userId}`, PER_DAY, 86_400, "complexity checks today");

  const inputs = spec.sizes.map((n) => buildScaledInput(spec, p.signature!.params, n));
  const runId = await createReviewRun(ctx.sub, {
    userId,
    problemId: p.id,
    language: s.language as "python" | "cpp" | "java",
    code: s.code,
    kind: "run",
    inputs,
    repeat: TIMING_REPEATS,
  });
  const values = {
    runSubmissionId: runId,
    claimed: input.claimed,
    status: "running",
    result: { sizes: spec.sizes } satisfies StoredResult as unknown as Record<string, unknown>,
    error: null,
  };
  if (current) {
    await db.update(complexityAnalyses).set(values).where(eq(complexityAnalyses.id, current.id));
  } else {
    await db.insert(complexityAnalyses).values({ id: newId(), userId, submissionId, ...values });
  }
  const dto = await getComplexity(db, userId, submissionId);
  if (!dto) throw new AppError("INTERNAL", 500, "Could not start the check");
  return dto;
}

/** Turns the finished run into samples: sizes up to the first one that ran out of time. */
export function samplesFrom(
  sizes: readonly number[],
  results: ReadonlyArray<{
    testOrdinal: number;
    verdict: string;
    timeMs: number | null;
    memoryKb: number | null;
  }>,
): { dto: ComplexitySampleDto[]; fit: ScaleSample[] } {
  const byOrdinal = new Map(results.map((r) => [r.testOrdinal, r]));
  const dto: ComplexitySampleDto[] = [];
  const fit: ScaleSample[] = [];
  let stopped = false;
  sizes.forEach((n, i) => {
    const r = byOrdinal.get(CUSTOM_ORDINAL_BASE + i + 1);
    if (stopped || !r) {
      dto.push({ n, timeMs: null, memoryKb: null, limit: false });
      return;
    }
    if (r.verdict === "AC" && r.timeMs !== null) {
      dto.push({ n, timeMs: r.timeMs, memoryKb: r.memoryKb, limit: false });
      fit.push({ n, timeMs: r.timeMs, memoryKb: r.memoryKb });
      return;
    }
    // the first size that ran out of time is a lower bound; later ones say nothing more
    stopped = true;
    dto.push({ n, timeMs: r.timeMs, memoryKb: r.memoryKb, limit: true });
    if (r.verdict === "TLE" && r.timeMs !== null) {
      fit.push({ n, timeMs: r.timeMs, memoryKb: r.memoryKb, censored: true });
    }
  });
  return { dto, fit };
}

/** Finishes the analysis once the judge run is over. */
async function resolve(db: Database, row: Row): Promise<Row> {
  if (row.status !== "running" || !row.runSubmissionId) return row;
  const [run] = await db
    .select({ verdict: submissions.verdict })
    .from(submissions)
    .where(eq(submissions.id, row.runSubmissionId));
  const verdict = run?.verdict as VerdictValue | undefined;
  if (!verdict || !isTerminal(verdict)) return row;

  const stored = (row.result ?? { sizes: [] }) as unknown as StoredResult;
  const fail = async (error: string) => {
    const [u] = await db
      .update(complexityAnalyses)
      .set({ status: "failed", error })
      .where(and(eq(complexityAnalyses.id, row.id), eq(complexityAnalyses.status, "running")))
      .returning();
    return u ?? row;
  };
  if (verdict === "IE" || verdict === "CE") {
    return fail("The judge could not run the measurement. Try again in a moment.");
  }

  const results = await db
    .select()
    .from(submissionResults)
    .where(eq(submissionResults.submissionId, row.runSubmissionId))
    .orderBy(asc(submissionResults.testOrdinal));
  const { dto, fit } = samplesFrom(stored.sizes, results);
  if (fit.length === 0) {
    return fail("The program failed on the generated inputs, so there is nothing to measure.");
  }

  const [source] = await db
    .select({ code: submissions.code, language: submissions.language })
    .from(submissions)
    .where(eq(submissions.id, row.submissionId));
  const hints = source
    ? staticHints(source.language as "python" | "cpp" | "java", source.code)
    : null;
  const estimate = estimateGrowth(fit);
  const comparison = compareClaim(
    row.claimed,
    estimate,
    hints && hints.maxLoopDepth >= 2
      ? { line: hints.deepestLine, depth: hints.maxLoopDepth }
      : null,
  );
  const result: StoredResult = {
    sizes: stored.sizes,
    samples: dto,
    estimate,
    verdict: comparison.verdict,
    message: comparison.message,
    hint: hints
      ? {
          maxLoopDepth: hints.maxLoopDepth,
          deepestLine: hints.deepestLine,
          recursion: hints.recursion,
        }
      : null,
  };
  const [updated] = await db
    .update(complexityAnalyses)
    .set({ status: "ready", result: result as unknown as Record<string, unknown> })
    .where(and(eq(complexityAnalyses.id, row.id), eq(complexityAnalyses.status, "running")))
    .returning();
  return updated ?? row;
}
