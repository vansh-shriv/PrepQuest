import type { Signature } from "@prepquest/shared";

export type { Signature };

export const LANGUAGES = ["cpp", "java", "python"] as const;
export type Language = (typeof LANGUAGES)[number];

export type Verdict =
  "QUEUED" | "COMPILING" | "RUNNING" | "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | "OLE" | "IE";

/** Verdicts a finished test (or job) can end in. */
export type FinalVerdict = Exclude<Verdict, "QUEUED" | "COMPILING" | "RUNNING">;

export type CheckerType = "exact" | "tokens" | "float" | "unordered" | "special";

export interface CheckerConfig {
  type: CheckerType;
  /** Absolute/relative tolerance for `float` (default 1e-6). */
  epsilon?: number;
}

export type TestKind = "sample" | "hidden" | "edge" | "stress" | "custom";

/** One test to run. Data is fetched lazily by the worker (object storage keys) or carried inline. */
export interface JudgeTest {
  ordinal: number;
  kind: TestKind;
  label?: string;
  inputKey?: string;
  outputKey?: string;
  /** Inline input for custom runs (no expected output, so no checker). */
  customInput?: string;
}

export interface JudgeLimits {
  /** CPU time per test (the language multiplier is already applied). */
  timeMs: number;
  memoryKb: number;
}

/** Everything a worker needs. Workers have no database access, so the job carries it all. */
export interface JudgeJob {
  submissionId: string;
  kind: "run" | "submit";
  language: Language;
  code: string;
  signature: Signature;
  checker: CheckerConfig;
  limits: JudgeLimits;
  tests: JudgeTest[];
}

export interface TestResult {
  ordinal: number;
  kind: TestKind;
  verdict: FinalVerdict;
  timeMs: number | null;
  memoryKb: number | null;
  /** Only for visible tests (samples and custom runs); hidden outputs never leave the judge. */
  stdoutTail?: string;
  stderrTail?: string;
  checkerMsg?: string;
  inputPreview?: string;
  expectedPreview?: string;
}

export interface JobSummary {
  verdict: FinalVerdict;
  passed: number;
  total: number;
  timeMs: number | null;
  memoryKb: number | null;
  failingOrdinal: number | null;
  compileOutput: string | null;
  /** stderr of the first failing test (runtime errors only). */
  stderrTail: string | null;
  /**
   * Every test that ran, in order. Carried by the final event so the database write is complete even if
   * live `test` events arrive late or out of order.
   */
  results: TestResult[];
}

export type JudgeEvent =
  | { type: "stage"; submissionId: string; stage: "COMPILING" | "RUNNING"; total: number }
  | { type: "test"; submissionId: string; result: TestResult }
  | { type: "done"; submissionId: string; summary: JobSummary };

// ------------------------------------------------------------------ sandbox contract

export interface ExecSpec {
  argv: string[];
  stdin: Buffer | null;
  cpuMs: number;
  wallMs: number;
  memoryKb: number;
  processes: number;
  /** Bytes of stdout kept; more than this ends the run as OLE (or is cut off, see `overflow`). */
  outputLimit: number;
  /** `fail` (default): exceeding `outputLimit` is an output-limit error. `truncate`: keep the first bytes (compilers). */
  overflow?: "fail" | "truncate";
}

export type ExecStatus =
  "ok" | "exit_nonzero" | "signal" | "timeout" | "oom" | "output_limit" | "internal";

export interface ExecResult {
  status: ExecStatus;
  exitCode: number | null;
  signal: string | null;
  cpuMs: number;
  wallMs: number;
  /** Peak memory, or 0 when the sandbox cannot measure it. */
  memoryKb: number;
  stdout: Buffer;
  stderr: Buffer;
  /** Why the sandbox itself failed (status `internal`). */
  message?: string;
}

/** One isolated working directory. Created per job and always cleaned up. */
export interface Box {
  /** Absolute path, used only to scrub compiler output. */
  readonly dir: string;
  writeFile(name: string, data: string | Buffer): Promise<void>;
  exec(spec: ExecSpec): Promise<ExecResult>;
  cleanup(): Promise<void>;
}

export interface Sandbox {
  create(): Promise<Box>;
}
