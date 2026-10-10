import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobSummary, JudgeEvent } from "@prepquest/judge-core";
import type { SubmissionCreated, SubmissionDetail } from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import { bearer, makeTestApp, signupAndLogin, type TestApp } from "../../test/helpers.js";
import { ResultIngester } from "./ingest.js";
import { BullJudgeQueue } from "./queue.js";

// Runs against a real Redis when reachable (docker compose up -d redis); skipped otherwise.
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
let redis: Redis;
let up = false;
let t: TestApp;
let token: string;
const stream = `pq-test:results:${process.pid}`;
const group = "pq-test-group";

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
  t = await makeTestApp();
  await seedContent(t, ["two-sum"]);
  token = (await signupAndLogin(t)).accessToken;
});

afterAll(async () => {
  if (up) {
    await redis.del(stream);
    await t.close();
  }
  redis.disconnect();
});

const emit = (event: JudgeEvent | string) =>
  redis.xadd(stream, "*", "d", typeof event === "string" ? event : JSON.stringify(event));

async function until<T>(fn: () => Promise<T | undefined | false>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("result stream", () => {
  it("persists worker events from a Redis stream and survives a bad message", async (ctx) => {
    if (!up) return ctx.skip();
    const created = await t.app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: bearer(token),
      payload: {
        problemSlug: "two-sum",
        language: "python",
        code: "class Solution:\n    pass\n",
        kind: "submit",
      },
    });
    const { submissionId: id } = created.json<SubmissionCreated>();
    const total = t.judge.jobs[0]!.job.tests.length;

    const ingester = new ResultIngester({ redis, db: t.db, stream, group });
    await ingester.start();
    try {
      await emit("{not json");
      await emit({ type: "stage", submissionId: id, stage: "RUNNING", total });
      const read = async () =>
        (
          await t.app.inject({
            method: "GET",
            url: `/v1/submissions/${id}`,
            headers: bearer(token),
          })
        ).json<SubmissionDetail>();
      await until(async () => (await read()).verdict === "RUNNING");

      const summary: JobSummary = {
        verdict: "WA",
        passed: 0,
        total,
        timeMs: 3,
        memoryKb: 1000,
        failingOrdinal: 1,
        compileOutput: null,
        stderrTail: null,
        results: [{ ordinal: 1, kind: "sample", verdict: "WA", timeMs: 3, memoryKb: 1000 }],
      };
      await emit({ type: "done", submissionId: id, summary });
      const done = await until(async () => {
        const d = await read();
        return d.finished ? d : false;
      });
      expect(done).toMatchObject({ verdict: "WA", failing: { ordinal: 1 } });

      // every entry (including the bad one) was acknowledged
      await until(async () => ((await redis.xpending(stream, group)) as unknown[])[0] === 0);
    } finally {
      await ingester.stop();
    }
  });

  it("starts from entries delivered but never acknowledged", async (ctx) => {
    if (!up) return ctx.skip();
    const created = await t.app.inject({
      method: "POST",
      url: "/v1/submissions",
      headers: bearer(token),
      payload: { problemSlug: "two-sum", language: "python", code: "x", kind: "submit" },
    });
    const { submissionId: id } = created.json<SubmissionCreated>();
    const summary: JobSummary = {
      verdict: "AC",
      passed: 1,
      total: 1,
      timeMs: 1,
      memoryKb: 1,
      failingOrdinal: null,
      compileOutput: null,
      stderrTail: null,
      results: [],
    };
    // simulate a previous API process that read the event and crashed before acknowledging it
    const first = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    await emit({ type: "done", submissionId: id, summary });
    await first.xreadgroup("GROUP", group, "crashed-consumer", "COUNT", 10, "STREAMS", stream, ">");
    first.disconnect();

    const ingester = new ResultIngester({
      redis,
      db: t.db,
      stream,
      group,
      consumer: "crashed-consumer",
    });
    await ingester.start();
    try {
      await until(async () => {
        const { rows } = await t.pool.query("SELECT verdict FROM submissions WHERE id = $1", [id]);
        return rows[0]?.verdict === "AC";
      });
    } finally {
      await ingester.stop();
    }
  });
});

describe("BullMQ queue", () => {
  it("enqueues a job once per submission id", async (ctx) => {
    if (!up) return ctx.skip();
    const queue = new BullJudgeQueue(REDIS_URL);
    try {
      const job = {
        ...t.judge.jobs[0]!.job,
        submissionId: `pq-test-${Date.now()}`,
      };
      const first = await queue.enqueue("run", job);
      const again = await queue.enqueue("run", job); // same id: still one job
      expect(first.position).toBeGreaterThanOrEqual(1);
      expect(again.position).toBe(first.position);
    } finally {
      const { Queue } = await import("bullmq");
      const cleanup = new Queue("judge-run", { connection: { host: "localhost", port: 6379 } });
      await cleanup.obliterate({ force: true }).catch(() => undefined);
      await cleanup.close();
      await queue.close();
    }
  });
});
