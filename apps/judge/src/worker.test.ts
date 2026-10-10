import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Queue, type Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  JOB_ATTEMPTS,
  QUEUE_RUN,
  QUEUE_SUBMIT,
  RESULT_STREAM,
  type JudgeEvent,
  type JudgeJob,
} from "@prepquest/judge-core";
import { FsObjectStore } from "@prepquest/storage";
import { ProcessSandbox } from "./sandbox/process.js";
import { startWorkers } from "./worker.js";

// Real Redis + BullMQ + the process sandbox. Skipped when Redis isn't reachable.
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = { host: "localhost", port: 6379 };
let redis: Redis;
let up = false;
let workers: Worker[] = [];
let queues: Queue[] = [];
let store: FsObjectStore;
let startId = "$";

const GOOD = "class Solution:\n    def double(self, n):\n        return n * 2\n";
const signature = {
  function: "double",
  params: [{ name: "n", type: "int" as const }],
  returns: "int" as const,
};

beforeAll(async () => {
  redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    up = (await redis.ping()) === "PONG";
  } catch {
    up = false;
  }
  if (!up) return;
  store = new FsObjectStore(await mkdtemp(path.join(tmpdir(), "pq-judge-objects-")));
  await store.put("t/1.in", "4\n");
  await store.put("t/1.out", "8\n");
  // an isolated results reader: only events published from now on
  const last = (await redis.xrevrange(RESULT_STREAM, "+", "-", "COUNT", 1))[0];
  startId = last ? last[0] : "0";
  const worker = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  workers = startWorkers({
    redis: worker,
    connection,
    store,
    sandbox: new ProcessSandbox(),
    concurrency: 2,
    log: () => undefined,
  });
  queues = [new Queue(QUEUE_SUBMIT, { connection }), new Queue(QUEUE_RUN, { connection })];
});

afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()));
  for (const q of queues) {
    await q.obliterate({ force: true }).catch(() => undefined);
    await q.close();
  }
  redis.disconnect();
});

function job(over: Partial<JudgeJob> = {}): JudgeJob {
  return {
    submissionId: `pq-test-${Math.random().toString(36).slice(2)}`,
    kind: "submit",
    language: "python",
    code: GOOD,
    signature,
    checker: { type: "exact" },
    limits: { timeMs: 2000, memoryKb: 256 * 1024 },
    tests: [{ ordinal: 1, kind: "sample", inputKey: "t/1.in", outputKey: "t/1.out" }],
    ...over,
  };
}

const enqueue = (lane: 0 | 1, j: JudgeJob) =>
  (queues[lane] as Queue).add("judge", j, {
    jobId: j.submissionId,
    attempts: JOB_ATTEMPTS,
    backoff: { type: "fixed", delay: 200 },
  });

async function eventsFor(id: string, until: (events: JudgeEvent[]) => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    const entries = await redis.xrange(RESULT_STREAM, `(${startId}`, "+");
    const events = entries
      .map(([, f]) => JSON.parse(f[f.indexOf("d") + 1] as string) as JudgeEvent)
      .filter((e) => e.submissionId === id);
    if (until(events)) return events;
    if (Date.now() > end)
      throw new Error(`timed out; saw ${JSON.stringify(events.map((e) => e.type))}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("judge worker", () => {
  it("judges a queued submission and streams progress then the final result", async (ctx) => {
    if (!up) return ctx.skip();
    const j = job();
    await enqueue(0, j);
    const events = await eventsFor(j.submissionId, (e) => e.some((x) => x.type === "done"));
    expect(events.map((e) => (e.type === "stage" ? e.stage : e.type))).toEqual([
      "COMPILING",
      "RUNNING",
      "test",
      "done",
    ]);
    const done = events.at(-1);
    expect(done?.type === "done" && done.summary).toMatchObject({
      verdict: "AC",
      passed: 1,
      total: 1,
    });
    expect(done?.type === "done" && done.summary.results[0]).toMatchObject({
      ordinal: 1,
      kind: "sample",
      verdict: "AC",
      stdoutTail: "8\n",
    });
  });

  it("judges runs on their own lane, including custom inputs", async (ctx) => {
    if (!up) return ctx.skip();
    const j = job({
      kind: "run",
      tests: [{ ordinal: 1001, kind: "custom", customInput: "10\n" }],
    });
    await enqueue(1, j);
    const events = await eventsFor(j.submissionId, (e) => e.some((x) => x.type === "done"));
    const done = events.at(-1);
    expect(done?.type === "done" && done.summary.results[0]).toMatchObject({ stdoutTail: "20\n" });
  });

  it("reports a wrong answer as a verdict, not an error, and does not retry it", async (ctx) => {
    if (!up) return ctx.skip();
    const j = job({ code: "class Solution:\n    def double(self, n):\n        return 1\n" });
    await enqueue(0, j);
    const events = await eventsFor(j.submissionId, (e) => e.some((x) => x.type === "done"));
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(
      events.at(-1)?.type === "done" &&
        (events.at(-1) as { summary: { verdict: string } }).summary.verdict,
    ).toBe("WA");
  });

  it("retries infrastructure errors and then reports exactly one IE", async (ctx) => {
    if (!up) return ctx.skip();
    // the test data does not exist, so every attempt fails inside the judge
    const j = job({
      tests: [{ ordinal: 1, kind: "hidden", inputKey: "t/missing.in", outputKey: "t/missing.out" }],
    });
    await enqueue(0, j);
    const events = await eventsFor(j.submissionId, (e) => e.some((x) => x.type === "done"));
    // let any stray extra "done" show up before counting
    await new Promise((r) => setTimeout(r, 1500));
    const all = await eventsFor(j.submissionId, () => true);
    expect(all.filter((e) => e.type === "done")).toHaveLength(1);
    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.summary.verdict).toBe("IE");
    // each of the three attempts compiled (staged) before failing
    expect(all.filter((e) => e.type === "stage" && e.stage === "COMPILING").length).toBe(
      JOB_ATTEMPTS,
    );
  });
});
