import { createHash } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import {
  customTests,
  newId,
  problemLanguages,
  problems,
  submissionResults,
  submissions,
  testCases,
  userProblemState,
  type Database,
} from "@prepquest/db";
import type { CheckerConfig, JudgeJob, JudgeTest } from "@prepquest/judge-core";
import {
  AppError,
  diffLines,
  isTerminal,
  type DiffLine,
  type LanguageValue,
  type SolveRewards,
  type SubmissionCreate,
  type SubmissionCreated,
  type SubmissionDetail,
  type SubmissionListItem,
  type SubmissionListQuery,
  type SubmissionListResponse,
  type SubmissionTestResult,
  type TestKindValue,
  type VerdictValue,
} from "@prepquest/shared";
import type { RateLimiter } from "../../lib/limiter.js";
import type { JudgeQueue } from "./queue.js";

export interface SubmissionCtx {
  db: Database;
  queue: JudgeQueue;
  limiter: RateLimiter;
}

/** Custom-run tests are numbered above any real test so the two never collide. */
export const CUSTOM_ORDINAL_BASE = 1000;
/** Submissions a user may have in flight at once (queued or running). */
const MAX_PENDING = 5;
const PENDING = ["QUEUED", "COMPILING", "RUNNING"] as const;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function checkerFor(problem: typeof problems.$inferSelect): CheckerConfig {
  if (problem.checker === "special") {
    throw new AppError(
      "UNSUPPORTED",
      422,
      "This problem needs a special checker, which isn't available yet.",
    );
  }
  const epsilon = problem.checkerConfig?.epsilon;
  return {
    type: problem.checker as CheckerConfig["type"],
    ...(typeof epsilon === "number" ? { epsilon } : {}),
  };
}

// ---------------------------------------------------------------- create

export async function createSubmission(
  ctx: SubmissionCtx,
  userId: string,
  input: SubmissionCreate,
  idempotencyKey: string | undefined,
): Promise<{ body: SubmissionCreated; replay: boolean }> {
  const { db } = ctx;

  // A retried request returns the original submission without costing rate-limit budget.
  if (idempotencyKey) {
    const [existing] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.userId, userId), eq(submissions.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing) return { body: { submissionId: existing.id, status: "QUEUED" }, replay: true };
  }

  if (input.kind === "submit") {
    await ctx.limiter.enforce(`sub:min:${userId}`, 10, 60, "submissions");
    await ctx.limiter.enforce(`sub:day:${userId}`, 200, 86_400, "submissions today");
  } else {
    await ctx.limiter.enforce(`run:min:${userId}`, 30, 60, "runs");
  }

  const [problem] = await db
    .select()
    .from(problems)
    .where(and(eq(problems.slug, input.problemSlug), eq(problems.status, "published")))
    .limit(1);
  if (!problem) throw new AppError("NOT_FOUND", 404, "Problem not found");
  if (!problem.signature) throw new AppError("UNSUPPORTED", 422, "This problem can't be run yet.");
  if (
    input.kind === "submit" &&
    (input.customTestIds.length > 0 || input.customInputs.length > 0)
  ) {
    throw new AppError("VALIDATION_ERROR", 422, "Custom tests only apply to runs.");
  }
  const checker = checkerFor(problem);

  const [lang] = await db
    .select({
      timeLimitMs: problemLanguages.timeLimitMs,
      memoryLimitKb: problemLanguages.memoryLimitKb,
    })
    .from(problemLanguages)
    .where(
      and(
        eq(problemLanguages.problemId, problem.id),
        eq(problemLanguages.language, input.language),
      ),
    );
  if (!lang)
    throw new AppError("VALIDATION_ERROR", 422, "That language isn't available for this problem.");

  const [{ pending } = { pending: 0 }] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(submissions)
    .where(
      and(
        eq(submissions.userId, userId),
        inArray(submissions.verdict, [...PENDING]),
        sql`${submissions.createdAt} > now() - interval '10 minutes'`,
      ),
    );
  if (pending >= MAX_PENDING) {
    throw new AppError(
      "TOO_MANY_PENDING",
      429,
      "You have several submissions still running. Wait for them to finish.",
    );
  }

  const rows = await db
    .select()
    .from(testCases)
    .where(and(eq(testCases.problemId, problem.id), eq(testCases.version, problem.currentVersion)))
    .orderBy(asc(testCases.ordinal));
  if (rows.length === 0) throw new AppError("UNSUPPORTED", 422, "This problem has no tests yet.");
  const chosen = input.kind === "submit" ? rows : rows.filter((r) => r.kind === "sample");
  const tests: JudgeTest[] = chosen.map((r) => ({
    ordinal: r.ordinal,
    kind: r.kind as JudgeTest["kind"],
    ...(r.label ? { label: r.label } : {}),
    inputKey: r.inputKey,
    outputKey: r.outputKey,
  }));

  let next = CUSTOM_ORDINAL_BASE;
  if (input.customTestIds.length > 0) {
    const saved = await db
      .select()
      .from(customTests)
      .where(
        and(
          inArray(customTests.id, input.customTestIds),
          eq(customTests.userId, userId),
          eq(customTests.problemId, problem.id),
        ),
      );
    if (saved.length !== new Set(input.customTestIds).size) {
      throw new AppError("VALIDATION_ERROR", 422, "One of the custom tests doesn't exist.");
    }
    for (const id of input.customTestIds) {
      const t = saved.find((s) => s.id === id)!;
      tests.push({
        ordinal: ++next,
        kind: "custom",
        ...(t.label ? { label: t.label } : {}),
        customInput: t.input,
      });
    }
  }
  for (const customInput of input.customInputs) {
    tests.push({ ordinal: ++next, kind: "custom", customInput });
  }

  const [priorState] = await db
    .select({ hintsUsed: userProblemState.hintsUsed })
    .from(userProblemState)
    .where(and(eq(userProblemState.userId, userId), eq(userProblemState.problemId, problem.id)));

  const id = newId();
  const inserted = await db
    .insert(submissions)
    .values({
      id,
      userId,
      problemId: problem.id,
      problemVersion: problem.currentVersion,
      language: input.language,
      code: input.code,
      codeHash: sha256(input.code),
      kind: input.kind,
      mode: input.mode,
      verdict: "QUEUED",
      total: tests.length,
      hintsUsed: priorState?.hintsUsed ?? 0,
      idempotencyKey: idempotencyKey ?? null,
      queuedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: submissions.id });
  if (inserted.length === 0) {
    // lost a race with a concurrent request carrying the same idempotency key
    const [winner] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(eq(submissions.userId, userId), eq(submissions.idempotencyKey, idempotencyKey ?? "")),
      );
    if (!winner) throw new AppError("INTERNAL", 500, "Could not create the submission");
    return { body: { submissionId: winner.id, status: "QUEUED" }, replay: true };
  }

  const job: JudgeJob = {
    submissionId: id,
    kind: input.kind,
    language: input.language,
    code: input.code,
    // stored loosely typed; the import and admin validators guarantee supported types
    signature: problem.signature as JudgeJob["signature"],
    checker,
    limits: { timeMs: lang.timeLimitMs, memoryKb: lang.memoryLimitKb },
    tests,
  };
  try {
    const { position } = await ctx.queue.enqueue(input.kind, job);
    return { body: { submissionId: id, status: "QUEUED", queuePosition: position }, replay: false };
  } catch (err) {
    await db
      .update(submissions)
      .set({ verdict: "IE", stderrTail: "The judge could not be reached.", finishedAt: new Date() })
      .where(eq(submissions.id, id));
    if (err instanceof AppError) throw err;
    throw new AppError(
      "JUDGE_UNAVAILABLE",
      503,
      "The judge is unavailable right now. Try again soon.",
    );
  }
}

// ---------------------------------------------------------------- read

const VISIBLE_KINDS: ReadonlySet<string> = new Set(["sample", "custom"]);

function toResult(r: typeof submissionResults.$inferSelect): SubmissionTestResult {
  const kind = (r.kind ?? null) as TestKindValue | null;
  const out: SubmissionTestResult = {
    ordinal: r.testOrdinal,
    kind,
    verdict: r.verdict as VerdictValue,
    timeMs: r.timeMs,
    memoryKb: r.memoryKb,
  };
  // Samples and custom runs show everything. Hidden tests never reveal data (doc 12 §8), but a
  // runtime error's message is shown because it is the only way to debug a crash.
  if (kind && VISIBLE_KINDS.has(kind)) {
    if (r.stdoutTail !== null) out.stdout = r.stdoutTail;
    if (r.stderrTail) out.stderr = r.stderrTail;
    if (r.checkerMsg) out.checkerMsg = r.checkerMsg;
    if (r.inputPreview !== null) out.input = r.inputPreview;
    if (r.expectedPreview !== null) out.expected = r.expectedPreview;
  } else if (r.verdict === "RE" && r.stderrTail) {
    out.stderr = r.stderrTail;
  } else if (r.verdict === "WA") {
    out.checkerMsg = "Wrong answer on a hidden test.";
  }
  return out;
}

async function ownedRow(db: Database, userId: string, id: string) {
  const [row] = await db
    .select({ s: submissions, slug: problems.slug, title: problems.title })
    .from(submissions)
    .innerJoin(problems, eq(problems.id, submissions.problemId))
    .where(and(eq(submissions.id, id), eq(submissions.userId, userId)))
    .limit(1);
  // not-yours looks the same as not-found, so ids can't be probed
  if (!row) throw new AppError("NOT_FOUND", 404, "Submission not found");
  return row;
}

export async function getSubmission(
  db: Database,
  userId: string,
  id: string,
): Promise<SubmissionDetail> {
  const { s, slug, title } = await ownedRow(db, userId, id);
  const resultRows = await db
    .select()
    .from(submissionResults)
    .where(eq(submissionResults.submissionId, id))
    .orderBy(asc(submissionResults.testOrdinal));
  const verdict = s.verdict as VerdictValue;
  const finished = isTerminal(verdict);
  const failingRow =
    finished && s.failingTestOrdinal !== null
      ? resultRows.find((r) => r.testOrdinal === s.failingTestOrdinal)
      : undefined;
  return {
    id: s.id,
    problem: { slug, title },
    language: s.language as LanguageValue,
    kind: s.kind as "run" | "submit",
    mode: s.mode,
    verdict,
    finished,
    passed: s.passed,
    total: s.total,
    timeMs: s.timeMs,
    memoryKb: s.memoryKb,
    failing: failingRow
      ? {
          ordinal: failingRow.testOrdinal,
          label: failingRow.label,
          kind: (failingRow.kind ?? null) as TestKindValue | null,
        }
      : null,
    compileOutput: s.compileOutput,
    stderrTail: s.stderrTail,
    results: resultRows.map(toResult),
    note: s.note,
    hintsUsed: s.hintsUsed,
    rewards: (s.rewards as SolveRewards | null) ?? null,
    createdAt: s.createdAt.toISOString(),
    finishedAt: s.finishedAt?.toISOString() ?? null,
    ...(finished ? { code: s.code } : {}),
  };
}

// ---------------------------------------------------------------- history

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const date = new Date(at ?? "");
    if (!id || Number.isNaN(date.getTime())) throw new Error("bad");
    return { at: date, id };
  } catch {
    throw new AppError("VALIDATION_ERROR", 422, "Invalid cursor");
  }
}

export async function listSubmissions(
  db: Database,
  userId: string,
  query: SubmissionListQuery,
): Promise<SubmissionListResponse> {
  const where: SQL[] = [eq(submissions.userId, userId)];
  if (query.kind !== "all") where.push(eq(submissions.kind, query.kind));
  if (query.problem) where.push(eq(problems.slug, query.problem));
  if (query.verdict) where.push(eq(submissions.verdict, query.verdict));
  if (query.language) where.push(eq(submissions.language, query.language));
  if (query.mode) where.push(eq(submissions.mode, query.mode));
  if (query.from) where.push(sql`${submissions.createdAt} >= ${query.from}`);
  if (query.to) where.push(sql`${submissions.createdAt} <= ${query.to}`);
  if (query.q) where.push(ilike(problems.title, `%${query.q.replace(/[%_\\]/g, "\\$&")}%`));
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    where.push(
      or(
        lt(submissions.createdAt, cursor.at),
        and(eq(submissions.createdAt, cursor.at), lt(submissions.id, cursor.id)),
      ) as SQL,
    );
  }

  const rows = await db
    .select({
      id: submissions.id,
      slug: problems.slug,
      title: problems.title,
      language: submissions.language,
      kind: submissions.kind,
      mode: submissions.mode,
      verdict: submissions.verdict,
      timeMs: submissions.timeMs,
      memoryKb: submissions.memoryKb,
      passed: submissions.passed,
      total: submissions.total,
      hintsUsed: submissions.hintsUsed,
      note: submissions.note,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .innerJoin(problems, eq(problems.id, submissions.problemId))
    .where(and(...where))
    .orderBy(desc(submissions.createdAt), desc(submissions.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const items: SubmissionListItem[] = page.map((r) => ({
    id: r.id,
    problem: { slug: r.slug, title: r.title },
    language: r.language as LanguageValue,
    kind: r.kind as "run" | "submit",
    mode: r.mode,
    verdict: r.verdict as VerdictValue,
    timeMs: r.timeMs,
    memoryKb: r.memoryKb,
    passed: r.passed,
    total: r.total,
    hintsUsed: r.hintsUsed,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function setSubmissionNote(
  db: Database,
  userId: string,
  id: string,
  note: string | null,
): Promise<{ note: string | null }> {
  await ownedRow(db, userId, id);
  await db
    .update(submissions)
    .set({ note: note && note.length > 0 ? note : null })
    .where(and(eq(submissions.id, id), eq(submissions.userId, userId)));
  return { note: note && note.length > 0 ? note : null };
}

export interface SubmissionDiff {
  before: { id: string; createdAt: string; verdict: VerdictValue };
  after: { id: string; createdAt: string; verdict: VerdictValue };
  lines: DiffLine[];
}

export async function diffSubmissions(
  db: Database,
  userId: string,
  id: string,
  againstId: string,
): Promise<SubmissionDiff> {
  const a = await ownedRow(db, userId, againstId);
  const b = await ownedRow(db, userId, id);
  if (a.s.problemId !== b.s.problemId) {
    throw new AppError(
      "VALIDATION_ERROR",
      422,
      "Only attempts at the same problem can be compared.",
    );
  }
  const brief = (r: typeof a) => ({
    id: r.s.id,
    createdAt: r.s.createdAt.toISOString(),
    verdict: r.s.verdict as VerdictValue,
  });
  return { before: brief(a), after: brief(b), lines: diffLines(a.s.code, b.s.code) };
}
