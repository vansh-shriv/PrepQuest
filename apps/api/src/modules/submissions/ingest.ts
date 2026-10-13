import { and, eq, inArray, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import {
  problems,
  submissionResults,
  submissions,
  userProblemState,
  withTransaction,
  type Database,
  type Db,
} from "@prepquest/db";
import {
  RESULT_GROUP,
  RESULT_STREAM,
  type JobSummary,
  type JudgeEvent,
  type TestResult,
} from "@prepquest/judge-core";
import { awardAccepted } from "../progress/award.js";
import { afterAccepted } from "../reviews/service.js";

/** Verdicts a submission can still move on from. Anything else is final and ignores later events. */
const OPEN = ["QUEUED", "COMPILING", "RUNNING"] as const;

const resultRow = (submissionId: string, r: TestResult) => ({
  submissionId,
  testOrdinal: r.ordinal,
  kind: r.kind,
  verdict: r.verdict,
  timeMs: r.timeMs,
  memoryKb: r.memoryKb,
  stdoutTail: r.stdoutTail ?? null,
  stderrTail: r.stderrTail ?? null,
  checkerMsg: r.checkerMsg ?? null,
  inputPreview: r.inputPreview ?? null,
  expectedPreview: r.expectedPreview ?? null,
});

async function saveResults(db: Db, submissionId: string, results: TestResult[]) {
  if (results.length === 0) return;
  await db
    .insert(submissionResults)
    .values(results.map((r) => resultRow(submissionId, r)))
    .onConflictDoUpdate({
      target: [submissionResults.submissionId, submissionResults.testOrdinal],
      set: {
        kind: sql`excluded.kind`,
        verdict: sql`excluded.verdict`,
        timeMs: sql`excluded.time_ms`,
        memoryKb: sql`excluded.memory_kb`,
        stdoutTail: sql`excluded.stdout_tail`,
        stderrTail: sql`excluded.stderr_tail`,
        checkerMsg: sql`excluded.checker_msg`,
        inputPreview: sql`excluded.input_preview`,
        expectedPreview: sql`excluded.expected_preview`,
      },
    });
}

/**
 * Applies one judge event. Safe to call repeatedly (the stream is at-least-once): events for a
 * finished submission are ignored, and the final event writes everything in one transaction.
 */
export async function applyJudgeEvent(db: Database, event: JudgeEvent): Promise<void> {
  const id = event.submissionId;
  switch (event.type) {
    case "stage":
      await db
        .update(submissions)
        .set({
          verdict: event.stage,
          total: event.total,
          startedAt: sql`coalesce(${submissions.startedAt}, now())`,
        })
        .where(and(eq(submissions.id, id), inArray(submissions.verdict, [...OPEN])));
      return;

    case "test": {
      const [row] = await db
        .select({ verdict: submissions.verdict })
        .from(submissions)
        .where(eq(submissions.id, id));
      if (row && (OPEN as readonly string[]).includes(row.verdict)) {
        await saveResults(db, id, [event.result]);
      }
      return;
    }

    case "done":
      await finish(db, id, event.summary);
      return;
  }
}

async function finish(db: Database, id: string, summary: JobSummary) {
  await withTransaction(db, async (tx) => {
    const [done] = await tx
      .update(submissions)
      .set({
        verdict: summary.verdict,
        timeMs: summary.timeMs,
        memoryKb: summary.memoryKb,
        passed: summary.passed,
        total: summary.total,
        failingTestOrdinal: summary.failingOrdinal,
        compileOutput: summary.compileOutput,
        stderrTail: summary.stderrTail,
        startedAt: sql`coalesce(${submissions.startedAt}, now())`,
        finishedAt: new Date(),
      })
      .where(and(eq(submissions.id, id), inArray(submissions.verdict, [...OPEN])))
      .returning({
        userId: submissions.userId,
        problemId: submissions.problemId,
        kind: submissions.kind,
        mode: submissions.mode,
      });
    if (!done) return; // already finished: a redelivered event

    await saveResults(tx, id, summary.results);
    // Labels of authored tests, so a failing hidden test can be named without leaking its data.
    await tx.execute(sql`
      UPDATE submission_results sr SET label = tc.label
      FROM submissions s, test_cases tc
      WHERE sr.submission_id = s.id AND s.id = ${id}
        AND tc.problem_id = s.problem_id AND tc.version = s.problem_version
        AND tc.ordinal = sr.test_ordinal AND tc.label IS NOT NULL`);

    // Only real submissions count; runs, review checks and infrastructure errors never touch progress or statistics.
    if (done.kind !== "submit" || done.mode === "review" || summary.verdict === "IE") return;
    const accepted = summary.verdict === "AC";

    const [state] = await tx
      .select()
      .from(userProblemState)
      .where(
        and(
          eq(userProblemState.userId, done.userId),
          eq(userProblemState.problemId, done.problemId),
        ),
      )
      .for("update");
    const solvedBefore = state?.status === "solved";
    const attemptsBefore = state?.attempts ?? 0;
    const status = accepted || solvedBefore ? "solved" : "attempted";
    await tx
      .insert(userProblemState)
      .values({
        userId: done.userId,
        problemId: done.problemId,
        status,
        attempts: attemptsBefore + 1,
        firstAcAt: accepted ? new Date() : null,
        firstTryAc: accepted ? attemptsBefore === 0 : null,
        bestTimeMs: accepted ? summary.timeMs : null,
        lastSubmissionAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userProblemState.userId, userProblemState.problemId],
        set: {
          status,
          attempts: attemptsBefore + 1,
          lastSubmissionAt: new Date(),
          ...(accepted
            ? {
                firstAcAt: sql`coalesce(${userProblemState.firstAcAt}, now())`,
                firstTryAc: sql`coalesce(${userProblemState.firstTryAc}, ${attemptsBefore === 0})`,
                bestTimeMs:
                  summary.timeMs === null
                    ? userProblemState.bestTimeMs
                    : sql`least(coalesce(${userProblemState.bestTimeMs}, ${summary.timeMs}), ${summary.timeMs})`,
              }
            : {}),
        },
      });

    const a = accepted ? 1 : 0;
    await tx
      .update(problems)
      .set({
        submissionsCount: sql`${problems.submissionsCount} + 1`,
        acceptedCount: sql`${problems.acceptedCount} + ${a}`,
        acceptanceRate: sql`round((${problems.acceptedCount} + ${a})::numeric * 100 / (${problems.submissionsCount} + 1), 2)`,
      })
      .where(eq(problems.id, done.problemId));

    if (!accepted) return;
    // XP, streak, activity and badges (an editorial given up on counts as all three hints)
    const [problem] = await tx
      .select({ difficulty: problems.difficulty })
      .from(problems)
      .where(eq(problems.id, done.problemId));
    const gaveUp = state?.gaveUpAt != null;
    const hintTiers = gaveUp ? 3 : (state?.hintsUsed ?? 0);
    const rewards = await awardAccepted(tx, {
      userId: done.userId,
      problemId: done.problemId,
      submissionId: id,
      difficulty: problem?.difficulty ?? "easy",
      firstSolve: !solvedBefore,
      firstTry: attemptsBefore === 0,
      hintTiers,
      now: new Date(),
    });
    await tx
      .update(submissions)
      .set({ rewards: rewards as unknown as Record<string, unknown> })
      .where(eq(submissions.id, id));
    if (done.mode === "practice") {
      // spaced repetition: the first solve makes a review card, a later solve of a due card is its review
      await afterAccepted(tx, {
        userId: done.userId,
        problemId: done.problemId,
        solvedBefore,
        attemptsBefore,
        hintTiers,
        now: new Date(),
      });
    }
    if (!solvedBefore) {
      await tx
        .update(userProblemState)
        .set({ cleanSolve: hintTiers === 0 })
        .where(
          and(
            eq(userProblemState.userId, done.userId),
            eq(userProblemState.problemId, done.problemId),
          ),
        );
    }
  });
}

/**
 * Marks submissions the judge never answered as infrastructure errors, so a stopped worker can't leave
 * the UI spinning forever. Returns how many were closed.
 */
export async function failStuckSubmissions(db: Database, olderThanSec: number): Promise<number> {
  const rows = await db
    .update(submissions)
    .set({
      verdict: "IE",
      stderrTail: "The judge didn't respond in time. Please try again.",
      finishedAt: new Date(),
    })
    .where(
      and(
        inArray(submissions.verdict, [...OPEN]),
        sql`${submissions.createdAt} < now() - make_interval(secs => ${olderThanSec})`,
      ),
    )
    .returning({ id: submissions.id });
  return rows.length;
}

export interface IngesterOptions {
  redis: Redis;
  db: Database;
  consumer?: string;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  /** Submissions with no answer after this long are failed (default 5 minutes). */
  stuckAfterSec?: number;
  /** Stream and group names; tests use private ones so they never touch a running dev stack. */
  stream?: string;
  group?: string;
}

/**
 * The trusted half of the judge protocol (doc 12 §2): reads the worker's results stream through a
 * consumer group and writes the database. Workers never hold database credentials.
 */
export class ResultIngester {
  private running = false;
  private loop: Promise<void> | null = null;
  private sweep: NodeJS.Timeout | null = null;
  private readonly consumer: string;
  private readonly stream: string;
  private readonly group: string;
  /** Own connection: XREADGROUP BLOCK would stall commands on a shared one. */
  private reader: Redis | null = null;

  constructor(private readonly opts: IngesterOptions) {
    this.consumer = opts.consumer ?? `api-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this.stream = opts.stream ?? RESULT_STREAM;
    this.group = opts.group ?? RESULT_GROUP;
  }

  private log(msg: string, extra?: Record<string, unknown>) {
    this.opts.log?.(msg, extra);
  }

  async start() {
    this.reader = this.opts.redis.duplicate({ maxRetriesPerRequest: null });
    try {
      await this.reader.xgroup("CREATE", this.stream, this.group, "$", "MKSTREAM");
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("BUSYGROUP"))) throw err;
    }
    this.running = true;
    this.loop = this.run();
    this.sweep = setInterval(() => {
      failStuckSubmissions(this.opts.db, this.opts.stuckAfterSec ?? 300).then(
        (n) => n > 0 && this.log("closed stuck submissions", { count: n }),
        (err) => this.log("sweep failed", { error: String(err) }),
      );
    }, 30_000);
    this.sweep.unref();
  }

  async stop() {
    this.running = false;
    if (this.sweep) clearInterval(this.sweep);
    this.reader?.disconnect();
    await this.loop?.catch(() => undefined);
  }

  private async run() {
    const reader = this.reader!;
    let cursor = "0"; // first drain anything delivered to this group but never acknowledged
    while (this.running) {
      try {
        const res = (await reader.xreadgroup(
          "GROUP",
          this.group,
          this.consumer,
          "COUNT",
          50,
          "BLOCK",
          cursor === "0" ? 1 : 2000,
          "STREAMS",
          this.stream,
          cursor,
        )) as Array<[string, Array<[string, string[]]>]> | null;
        const entries = res?.[0]?.[1] ?? [];
        if (cursor === "0" && entries.length === 0) cursor = ">";
        for (const [entryId, fields] of entries) {
          await this.handle(entryId, fields);
        }
      } catch (err) {
        if (!this.running) return;
        this.log("ingester error", { error: String(err) });
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async handle(entryId: string, fields: string[]) {
    let event: JudgeEvent | null = null;
    try {
      event = JSON.parse(fields[fields.indexOf("d") + 1] ?? "null") as JudgeEvent | null;
    } catch {
      /* handled below */
    }
    if (!event || typeof event.submissionId !== "string") {
      // a poison message must not block the stream
      this.log("bad judge event", { entryId });
      await this.opts.redis.xack(this.stream, this.group, entryId);
      return;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await applyJudgeEvent(this.opts.db, event);
        await this.opts.redis.xack(this.stream, this.group, entryId);
        return;
      } catch (err) {
        this.log("could not apply judge event", { entryId, attempt, error: String(err) });
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500));
      }
    }
    // Left unacknowledged: redelivered on the next start. Meanwhile the stuck-submission sweep applies.
  }
}
