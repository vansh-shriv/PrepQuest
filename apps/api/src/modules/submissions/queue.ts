import { Queue } from "bullmq";
import { JOB_ATTEMPTS, QUEUE_RUN, QUEUE_SUBMIT, type JudgeJob } from "@prepquest/judge-core";
import { AppError } from "@prepquest/shared";

export type Lane = "submit" | "run";

/** How the API hands work to the judge. Production uses BullMQ; tests use an in-memory queue. */
export interface JudgeQueue {
  /** Resolves with a rough position in the lane (1 = next). Throws if the queue can't be reached. */
  enqueue(lane: Lane, job: JudgeJob): Promise<{ position: number }>;
  close(): Promise<void>;
}

const NAMES: Record<Lane, string> = { submit: QUEUE_SUBMIT, run: QUEUE_RUN };

export class BullJudgeQueue implements JudgeQueue {
  private readonly queues: Record<Lane, Queue<JudgeJob>>;

  constructor(redisUrl: string) {
    const url = new URL(redisUrl);
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      ...(url.protocol === "rediss:" ? { tls: {} } : {}),
      // fail fast instead of buffering commands when Redis is down
      enableOfflineQueue: false,
    };
    const make = (lane: Lane) =>
      new Queue<JudgeJob>(NAMES[lane], {
        connection,
        defaultJobOptions: {
          attempts: JOB_ATTEMPTS,
          backoff: { type: "fixed", delay: 1000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86_400 },
        },
      });
    this.queues = { submit: make("submit"), run: make("run") };
    for (const q of Object.values(this.queues)) q.on("error", () => undefined);
  }

  async enqueue(lane: Lane, job: JudgeJob) {
    const queue = this.queues[lane];
    // the job id is the submission id, so a repeated enqueue can never run twice
    await queue.add("judge", job, { jobId: job.submissionId });
    const waiting = await queue.getWaitingCount().catch(() => 1);
    return { position: Math.max(1, waiting) };
  }

  async close() {
    await Promise.all(Object.values(this.queues).map((q) => q.close()));
  }
}

/** Used when Redis is down at boot: submissions fail fast with a clear error instead of hanging. */
export class UnavailableJudgeQueue implements JudgeQueue {
  async enqueue(): Promise<never> {
    throw new AppError(
      "JUDGE_UNAVAILABLE",
      503,
      "The judge is unavailable right now. Try again soon.",
    );
  }
  async close() {}
}

export interface QueuedJob {
  lane: Lane;
  job: JudgeJob;
}

/** Test double: records jobs; tests feed results through `applyJudgeEvent` themselves. */
export class MemoryJudgeQueue implements JudgeQueue {
  readonly jobs: QueuedJob[] = [];
  /** Set to make the next `enqueue` fail. */
  failNext = false;

  async enqueue(lane: Lane, job: JudgeJob) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("queue offline");
    }
    this.jobs.push({ lane, job });
    return { position: this.jobs.length };
  }
  async close() {}
}
