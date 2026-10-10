import { check } from "./checkers.js";
import { buildSources } from "./drivers.js";
import {
  COMPILE_LIMITS,
  LANGUAGE_CONFIG,
  RUN_OUTPUT_LIMIT,
  TAIL_BYTES,
  WALL_SLACK_MS,
} from "./languages.js";
import type {
  Box,
  FinalVerdict,
  JobSummary,
  JudgeEvent,
  JudgeJob,
  JudgeTest,
  Sandbox,
  TestResult,
} from "./types.js";
import { aggregate, classifyRun, scrubCompileOutput } from "./verdict.js";

export interface LoadedTest {
  input: Buffer;
  /** Absent for custom runs: the program just runs and its output is shown. */
  expected?: Buffer;
}

export interface PipelineDeps {
  sandbox: Sandbox;
  /** Fetches a test's data (object storage in production, inline for custom inputs). */
  loadTest(test: JudgeTest): Promise<LoadedTest>;
  emit(event: JudgeEvent): void | Promise<void>;
}

const PREVIEW_CHARS = 2000;

const tail = (buf: Buffer, bytes = TAIL_BYTES): string => {
  if (buf.length === 0) return "";
  const text = buf.subarray(Math.max(0, buf.length - bytes)).toString("utf8");
  return buf.length > bytes ? `...${text}` : text;
};
const head = (text: string, n = PREVIEW_CHARS) =>
  text.length > n ? `${text.slice(0, n)}...` : text;

/** Samples and custom runs can show their data; hidden tests never do (doc 12 §8). */
const isVisible = (t: JudgeTest) => t.kind === "sample" || t.kind === "custom";

/**
 * Compiles (if needed), runs the job's tests in order and reports progress through `emit`.
 * Always cleans the box up. Infrastructure failures surface as an `IE` summary, never as a user verdict.
 * The caller publishes the final `done` event, so it can retry an `IE` first (doc 12 §5).
 */
export async function runJob(job: JudgeJob, deps: PipelineDeps): Promise<JobSummary> {
  let box: Box | undefined;
  try {
    box = await deps.sandbox.create();
    return await execute(job, box, deps);
  } catch (err) {
    return {
      verdict: "IE",
      passed: 0,
      total: job.tests.length,
      timeMs: null,
      memoryKb: null,
      failingOrdinal: null,
      compileOutput: null,
      stderrTail: err instanceof Error ? err.message.slice(0, 500) : "judge error",
      results: [],
    };
  } finally {
    await box?.cleanup().catch(() => undefined);
  }
}

async function execute(job: JudgeJob, box: Box, deps: PipelineDeps): Promise<JobSummary> {
  const { submissionId } = job;
  const config = LANGUAGE_CONFIG[job.language];
  const total = job.tests.length;

  await deps.emit({ type: "stage", submissionId, stage: "COMPILING", total });
  for (const file of buildSources(job.language, job.code, job.signature)) {
    await box.writeFile(file.name, file.content);
  }

  if (config.compile) {
    const compiled = await box.exec({
      argv: config.compile,
      stdin: null,
      cpuMs: COMPILE_LIMITS.cpuMs,
      wallMs: COMPILE_LIMITS.wallMs,
      memoryKb: COMPILE_LIMITS.memoryKb,
      processes: config.compileProcesses,
      outputLimit: COMPILE_LIMITS.outputLimit,
      overflow: "truncate",
    });
    if (compiled.status === "internal")
      throw new Error(compiled.message ?? "compile sandbox failure");
    if (compiled.status !== "ok") {
      const raw = Buffer.concat([compiled.stderr, compiled.stdout]).toString("utf8");
      const timedOut = compiled.status === "timeout";
      return {
        verdict: "CE",
        passed: 0,
        total,
        timeMs: null,
        memoryKb: null,
        failingOrdinal: null,
        compileOutput: timedOut ? "Compilation took too long." : scrubCompileOutput(raw, box.dir),
        stderrTail: null,
        results: [],
      };
    }
  }

  await deps.emit({ type: "stage", submissionId, stage: "RUNNING", total });

  const results: TestResult[] = [];
  let maxTime: number | null = null;
  let maxMem: number | null = null;
  for (const test of job.tests) {
    const result = await runTest(job, box, deps, test);
    results.push(result);
    if (result.timeMs !== null) maxTime = Math.max(maxTime ?? 0, result.timeMs);
    if (result.memoryKb) maxMem = Math.max(maxMem ?? 0, result.memoryKb);
    await deps.emit({ type: "test", submissionId, result });
    // Submissions stop at the first failure; runs report every test (doc 12 §5 step 6).
    if (job.kind === "submit" && result.verdict !== "AC") break;
  }

  const verdict = aggregate(results.map((r) => r.verdict));
  const failing = results.find((r) => r.verdict !== "AC");
  return {
    verdict,
    passed: results.filter((r) => r.verdict === "AC").length,
    total,
    timeMs: maxTime,
    memoryKb: maxMem,
    failingOrdinal: failing?.ordinal ?? null,
    compileOutput: null,
    stderrTail: failing && failing.verdict === "RE" ? (failing.stderrTail ?? null) : null,
    results,
  };
}

async function runTest(
  job: JudgeJob,
  box: Box,
  deps: PipelineDeps,
  test: JudgeTest,
): Promise<TestResult> {
  const config = LANGUAGE_CONFIG[job.language];
  const visible = isVisible(test);
  const base = { ordinal: test.ordinal, kind: test.kind };
  let loaded;
  try {
    loaded = await deps.loadTest(test);
  } catch (err) {
    throw new Error(
      `could not load test ${test.ordinal}: ${err instanceof Error ? err.message : err}`,
      { cause: err },
    );
  }

  const exec = await box.exec({
    argv: config.run(job.limits.memoryKb),
    stdin: loaded.input,
    cpuMs: job.limits.timeMs,
    wallMs: job.limits.timeMs + WALL_SLACK_MS,
    memoryKb: job.limits.memoryKb,
    processes: config.runProcesses,
    outputLimit: RUN_OUTPUT_LIMIT,
  });
  if (exec.status === "internal") throw new Error(exec.message ?? "run sandbox failure");

  const preview: Partial<TestResult> = visible
    ? {
        inputPreview: head(loaded.input.toString("utf8")),
        ...(loaded.expected ? { expectedPreview: head(loaded.expected.toString("utf8")) } : {}),
      }
    : {};
  const out: Partial<TestResult> = visible ? { stdoutTail: tail(exec.stdout) } : {};
  // stderr helps debug runtime errors, so it is shown even for hidden tests (it never contains test data
  // unless the user's own code prints it).
  const errText = exec.stderr.length > 0 ? { stderrTail: tail(exec.stderr, 2048) } : {};
  const measured = { timeMs: exec.cpuMs, memoryKb: exec.memoryKb || null };

  const failure: FinalVerdict | null = classifyRun(exec, job.limits.memoryKb);
  if (failure) {
    return { ...base, ...measured, ...preview, ...out, ...errText, verdict: failure };
  }

  if (!loaded.expected) {
    // custom run: nothing to compare against
    return { ...base, ...measured, ...preview, ...out, ...errText, verdict: "AC" };
  }

  const verdict = check(
    job.checker,
    loaded.expected.toString("utf8"),
    exec.stdout.toString("utf8"),
  );
  if (verdict.ok) return { ...base, ...measured, ...preview, ...out, verdict: "AC" };
  return {
    ...base,
    ...measured,
    ...preview,
    ...out,
    ...errText,
    verdict: "WA",
    checkerMsg: visible ? verdict.message : "Wrong answer on a hidden test.",
  };
}
