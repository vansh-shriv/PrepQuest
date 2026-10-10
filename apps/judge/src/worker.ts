import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import {
  JOB_ATTEMPTS,
  QUEUE_RUN,
  QUEUE_SUBMIT,
  RESULT_STREAM,
  runJob,
  type JudgeEvent,
  type JudgeJob,
  type Sandbox,
} from "@prepquest/judge-core";
import type { ObjectStore } from "@prepquest/storage";

export interface WorkerDeps {
  /** Dedicated connection for results (BullMQ's own connections are created from `connection`). */
  redis: Redis;
  connection: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    db?: number;
    tls?: object;
  };
  store: ObjectStore;
  sandbox: Sandbox;
  concurrency: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

/** Appends an event to the results stream; the API's ingester is the only thing that writes the database. */
export function publish(redis: Redis, event: JudgeEvent) {
  return redis.xadd(RESULT_STREAM, "MAXLEN", "~", "100000", "*", "d", JSON.stringify(event));
}

export function makeHandler(deps: Pick<WorkerDeps, "redis" | "store" | "sandbox" | "log">) {
  return async (job: Job<JudgeJob>) => {
    const data = job.data;
    const summary = await runJob(data, {
      sandbox: deps.sandbox,
      loadTest: async (test) => {
        if (test.customInput !== undefined) return { input: Buffer.from(test.customInput, "utf8") };
        if (!test.inputKey || !test.outputKey) throw new Error("test has no data");
        const [input, expected] = await Promise.all([
          deps.store.get(test.inputKey),
          deps.store.get(test.outputKey),
        ]);
        return { input, expected };
      },
      emit: async (event) => void (await publish(deps.redis, event)),
    });

    // Infrastructure failures are retried (on any worker) before a verdict is reported (doc 12 §5).
    const attempts = job.opts.attempts ?? JOB_ATTEMPTS;
    if (summary.verdict === "IE" && job.attemptsMade + 1 < attempts) {
      deps.log("infra error, retrying", {
        submissionId: data.submissionId,
        error: summary.stderrTail,
      });
      throw new Error(summary.stderrTail ?? "judge infrastructure error");
    }
    await publish(deps.redis, { type: "done", submissionId: data.submissionId, summary });
    deps.log("judged", { submissionId: data.submissionId, verdict: summary.verdict });
  };
}

export function startWorkers(deps: WorkerDeps): Worker[] {
  const handler = makeHandler(deps);
  const opts = { connection: deps.connection, lockDuration: 120_000 };
  const submit = new Worker(QUEUE_SUBMIT, handler, { ...opts, concurrency: deps.concurrency });
  // runs share the box pool; keep their share small so submissions are never starved
  const runs = new Worker(QUEUE_RUN, handler, {
    ...opts,
    concurrency: Math.max(1, Math.floor(deps.concurrency / 2)),
  });
  for (const w of [submit, runs]) {
    w.on("failed", (job, err) => {
      deps.log("job failed", {
        submissionId: job?.data.submissionId,
        error: err.message,
        attempt: job?.attemptsMade,
      });
      // after the last attempt BullMQ stops retrying: report the failure instead of leaving it queued
      if (job && job.attemptsMade >= (job.opts.attempts ?? JOB_ATTEMPTS)) {
        void publish(deps.redis, {
          type: "done",
          submissionId: job.data.submissionId,
          summary: {
            verdict: "IE",
            passed: 0,
            total: job.data.tests.length,
            timeMs: null,
            memoryKb: null,
            failingOrdinal: null,
            compileOutput: null,
            stderrTail: "The judge had a problem. Please try again.",
            results: [],
          },
        });
      }
    });
    w.on("error", (err) => deps.log("worker error", { error: err.message }));
  }
  return [submit, runs];
}
