import { Redis } from "ioredis";
import { createObjectStore } from "@prepquest/storage";
import { loadConfig } from "./config.js";
import { IsolateSandbox } from "./sandbox/isolate.js";
import { ProcessSandbox } from "./sandbox/process.js";
import { startWorkers } from "./worker.js";

const config = loadConfig();
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), svc: "judge", msg, ...extra }));

const url = new URL(config.REDIS_URL);
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
  ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  ...(url.protocol === "rediss:" ? { tls: {} } : {}),
};
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const slots = config.JUDGE_CONCURRENCY + Math.max(1, Math.floor(config.JUDGE_CONCURRENCY / 2));
const sandbox =
  config.JUDGE_SANDBOX === "isolate"
    ? new IsolateSandbox({
        bin: config.ISOLATE_BIN,
        cgroups: config.JUDGE_CGROUPS,
        boxIds: Array.from({ length: slots }, (_, i) => i),
      })
    : new ProcessSandbox();
if (config.JUDGE_SANDBOX === "process") {
  log("WARNING: process sandbox is for local development only; it does not isolate code");
}

const workers = startWorkers({
  redis,
  connection,
  store: createObjectStore(config),
  sandbox,
  concurrency: config.JUDGE_CONCURRENCY,
  log,
});
log("judge ready", { sandbox: config.JUDGE_SANDBOX, concurrency: config.JUDGE_CONCURRENCY });

// Drain: finish the current jobs, stop pulling new ones (doc 12 §7).
const shutdown = async () => {
  log("draining");
  await Promise.all(workers.map((w) => w.close()));
  redis.disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
