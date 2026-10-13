import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  codeReviews,
  newId,
  problems,
  submissions,
  userSettings,
  type Database,
} from "@prepquest/db";
import {
  CODE_REVIEW_PROMPT_VERSION,
  CODE_REVIEW_SYSTEM,
  buildCodeReviewPrompt,
} from "@prepquest/prompts";
import {
  AppError,
  REVIEW_CATEGORIES,
  REVIEW_SEVERITIES,
  STRICTNESS_RULES,
  isTerminal,
  type CodeReviewDto,
  type ReviewCategory,
  type ReviewCreate,
  type ReviewStrictness,
  type VerdictValue,
} from "@prepquest/shared";
import type { AiContext } from "../ai-context.js";
import { createReviewRun, type SubmissionCtx } from "../submissions/service.js";

// Code review mode (X3): the model critiques a submission line by line; code checks what it said. A suggested
// refactor is shown only after the judge accepts it on every test.

const MAX_REFACTOR_BYTES = 64 * 1024;
/** Reviews a learner may ask for: per minute and per day (each costs a model call). */
const PER_MINUTE = 3;
const PER_DAY = 20;

const reviewSchema = z.object({
  summary: z.string().trim().min(1).max(900),
  ratings: z.object(
    Object.fromEntries(REVIEW_CATEGORIES.map((c) => [c, z.number().int().min(1).max(5)])) as Record<
      ReviewCategory,
      z.ZodNumber
    >,
  ),
  comments: z
    .array(
      z.object({
        line: z.number().int().min(1),
        severity: z.enum(REVIEW_SEVERITIES),
        category: z.enum(REVIEW_CATEGORIES),
        message: z.string().trim().min(3).max(600),
      }),
    )
    .max(40),
  refactor: z
    .object({ code: z.string().max(MAX_REFACTOR_BYTES), notes: z.string().max(800) })
    .nullish(),
});
type ReviewReply = z.infer<typeof reviewSchema>;

export interface ReviewCtx {
  ai: AiContext;
  sub: SubmissionCtx;
}

// ---------------------------------------------------------------- read

type Row = typeof codeReviews.$inferSelect;

function toDto(row: Row): CodeReviewDto {
  const verified = row.refactorStatus === "verified";
  return {
    id: row.id,
    submissionId: row.submissionId,
    strictness: row.strictness as ReviewStrictness,
    status: row.status as CodeReviewDto["status"],
    summary: row.summary,
    comments: row.comments,
    ratings: row.ratings as CodeReviewDto["ratings"],
    // an unchecked refactor never leaves the server
    refactor: {
      status: row.refactorStatus as CodeReviewDto["refactor"]["status"],
      code: verified ? row.refactorCode : null,
      notes: verified ? row.refactorNotes : null,
    },
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Moves a refactor from "checking" to "verified" or "rejected" once the judge has answered. */
async function syncRefactor(db: Database, row: Row): Promise<Row> {
  if (row.refactorStatus !== "checking" || !row.refactorSubmissionId) return row;
  const [run] = await db
    .select({ verdict: submissions.verdict })
    .from(submissions)
    .where(eq(submissions.id, row.refactorSubmissionId));
  const verdict = run?.verdict as VerdictValue | undefined;
  if (!verdict || !isTerminal(verdict)) return row;
  const next = verdict === "AC" ? "verified" : "rejected";
  const [updated] = await db
    .update(codeReviews)
    .set({ refactorStatus: next })
    .where(and(eq(codeReviews.id, row.id), eq(codeReviews.refactorStatus, "checking")))
    .returning();
  return updated ?? { ...row, refactorStatus: next };
}

export async function getReview(
  db: Database,
  userId: string,
  submissionId: string,
  strictness?: ReviewStrictness,
): Promise<CodeReviewDto | null> {
  const [row] = await db
    .select()
    .from(codeReviews)
    .where(
      and(
        eq(codeReviews.userId, userId),
        eq(codeReviews.submissionId, submissionId),
        strictness ? eq(codeReviews.strictness, strictness) : sql`true`,
      ),
    )
    .orderBy(desc(codeReviews.createdAt))
    .limit(1);
  if (!row) return null;
  return toDto(await syncRefactor(db, await expireStale(db, row)));
}

/** A review still pending long after it began lost its job (a restart): report it so the learner can retry. */
const STALE_MS = 5 * 60_000;
async function expireStale(db: Database, row: Row): Promise<Row> {
  if (row.status !== "pending" || Date.now() - row.updatedAt.getTime() < STALE_MS) return row;
  const [updated] = await db
    .update(codeReviews)
    .set({ status: "failed", error: "The review took too long. Try again." })
    .where(and(eq(codeReviews.id, row.id), eq(codeReviews.status, "pending")))
    .returning();
  return updated ?? row;
}

// ---------------------------------------------------------------- settings

export async function getStrictness(db: Database, userId: string): Promise<ReviewStrictness> {
  const [row] = await db
    .select({ s: userSettings.reviewStrictness })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return (row?.s as ReviewStrictness | undefined) ?? "strict";
}

export async function saveStrictness(
  db: Database,
  userId: string,
  strictness: ReviewStrictness,
): Promise<{ strictness: ReviewStrictness }> {
  const updated = await db
    .update(userSettings)
    .set({ reviewStrictness: strictness })
    .where(eq(userSettings.userId, userId))
    .returning({ userId: userSettings.userId });
  if (updated.length === 0) throw new AppError("NOT_FOUND", 404, "Settings not found");
  return { strictness };
}

// ---------------------------------------------------------------- create

const signatureText = (sig: {
  function: string;
  params: Array<{ name: string; type: string }>;
  returns: string;
}) =>
  `${sig.function}(${sig.params.map((p) => `${p.type} ${p.name}`).join(", ")}) -> ${sig.returns}`;

/** What the reply must satisfy beyond its shape; each message is sent back to the model to fix. */
export function reviewIssues(
  v: ReviewReply,
  strictness: ReviewStrictness,
  lineCount: number,
): string[] {
  const rules = STRICTNESS_RULES[strictness];
  const issues: string[] = [];
  if (v.comments.length > rules.maxComments) {
    issues.push(`at most ${rules.maxComments} comments are allowed for ${strictness} reviews`);
  }
  for (const [i, c] of v.comments.entries()) {
    if (c.line > lineCount) {
      issues.push(`comment ${i + 1} points at line ${c.line} but the code has ${lineCount} lines`);
    }
    if (!rules.severities.includes(c.severity)) {
      issues.push(
        `comment ${i + 1}: severity "${c.severity}" is not shown in ${strictness} reviews`,
      );
    }
  }
  return issues;
}

/** Starts a review (or returns the one already made for this submission and strictness). */
export async function createReview(
  ctx: ReviewCtx,
  userId: string,
  submissionId: string,
  input: ReviewCreate,
): Promise<CodeReviewDto> {
  const { db } = ctx.ai;
  const [row] = await db
    .select({ s: submissions, p: problems })
    .from(submissions)
    .innerJoin(problems, eq(problems.id, submissions.problemId))
    .where(and(eq(submissions.id, submissionId), eq(submissions.userId, userId)));
  // not yours looks the same as not found
  if (!row || row.s.mode === "review") throw new AppError("NOT_FOUND", 404, "Submission not found");
  const { s, p } = row;
  if (!isTerminal(s.verdict as VerdictValue)) {
    throw new AppError("CONFLICT", 409, "Wait for the judge to finish before asking for a review.");
  }
  const strictness = input.strictness ?? (await getStrictness(db, userId));

  const existing = await getReview(db, userId, submissionId, strictness);
  // a finished or running review is returned as it is: asking again costs nothing
  if (existing && existing.status !== "failed") return existing;

  await ctx.ai.limiter.enforce(`cr:min:${userId}`, PER_MINUTE, 60, "code reviews");
  await ctx.ai.limiter.enforce(`cr:day:${userId}`, PER_DAY, 86_400, "code reviews today");

  const id = existing?.id ?? newId();
  if (existing) {
    await db
      .update(codeReviews)
      .set({
        status: "pending",
        error: null,
        summary: null,
        comments: [],
        ratings: {},
        refactorCode: null,
        refactorNotes: null,
        refactorSubmissionId: null,
        refactorStatus: "none",
      })
      .where(eq(codeReviews.id, id));
  } else {
    await db.insert(codeReviews).values({ id, userId, submissionId, strictness });
  }

  ctx.ai.jobs.run(`code-review:${id}`, () =>
    generateReview(ctx, { id, userId, strictness, wantRefactor: input.refactor }, s, p),
  );
  const created = await getReview(db, userId, submissionId, strictness);
  if (!created) throw new AppError("INTERNAL", 500, "Could not start the review");
  return created;
}

async function generateReview(
  ctx: ReviewCtx,
  job: { id: string; userId: string; strictness: ReviewStrictness; wantRefactor: boolean },
  s: typeof submissions.$inferSelect,
  p: typeof problems.$inferSelect,
) {
  const { db, llm } = ctx.ai;
  const lineCount = s.code.replace(/\r\n/g, "\n").split("\n").length;
  try {
    const { value, result } = await llm.json(
      {
        task: "code_review",
        modelClass: "evaluator",
        system: CODE_REVIEW_SYSTEM,
        messages: [
          {
            role: "user",
            content: buildCodeReviewPrompt({
              language: s.language as "python" | "cpp" | "java",
              problemTitle: p.title,
              signature: p.signature ? signatureText(p.signature) : "(function)",
              statement: p.statementMd,
              code: s.code,
              verdict: s.verdict,
              strictness: job.strictness,
              wantRefactor: job.wantRefactor,
            }),
          },
        ],
        maxTokens: 6000,
        effort: "medium",
        userId: job.userId,
        promptVersion: CODE_REVIEW_PROMPT_VERSION,
      },
      reviewSchema,
      { check: (v) => reviewIssues(v, job.strictness, lineCount) },
    );

    const seen = new Set<string>();
    const comments = value.comments
      .filter((c) => {
        const key = `${c.line}|${c.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.line - b.line);

    const refactor = job.wantRefactor ? value.refactor : null;
    const useful =
      refactor &&
      refactor.code.trim().length > 0 &&
      refactor.code.trim() !== s.code.trim() &&
      new TextEncoder().encode(refactor.code).length <= MAX_REFACTOR_BYTES
        ? refactor
        : null;

    await db
      .update(codeReviews)
      .set({
        status: "ready",
        summary: value.summary,
        comments,
        ratings: value.ratings,
        model: result.model,
        refactorCode: useful?.code ?? null,
        refactorNotes: useful?.notes ?? null,
      })
      .where(eq(codeReviews.id, job.id));

    if (useful) {
      // the refactor is shown only if the judge accepts it on every test
      try {
        const runId = await createReviewRun(ctx.sub, {
          userId: job.userId,
          problemId: p.id,
          language: s.language as "python" | "cpp" | "java",
          code: useful.code,
          kind: "submit",
        });
        await db
          .update(codeReviews)
          .set({ refactorSubmissionId: runId, refactorStatus: "checking" })
          .where(eq(codeReviews.id, job.id));
      } catch {
        // the judge is down: the review stands, the refactor is simply not offered
        await db
          .update(codeReviews)
          .set({ refactorStatus: "rejected" })
          .where(eq(codeReviews.id, job.id));
      }
    }
  } catch (err) {
    ctx.ai.log.warn({ err: String(err), reviewId: job.id }, "code review failed");
    await db
      .update(codeReviews)
      .set({ status: "failed", error: "The review could not be written. Try again in a moment." })
      .where(eq(codeReviews.id, job.id));
  }
}
