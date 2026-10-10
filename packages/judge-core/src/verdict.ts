import type { ExecResult, FinalVerdict } from "./types.js";

/**
 * Doc 12 §5 "Verdict heuristics" for a run that did not pass the checker yet.
 * Returns `null` when the program ran to completion (the checker decides next).
 */
export function classifyRun(result: ExecResult, memoryLimitKb: number): FinalVerdict | null {
  switch (result.status) {
    case "ok":
      return null;
    case "timeout":
      return "TLE";
    case "oom":
      return "MLE";
    case "output_limit":
      return "OLE";
    case "internal":
      return "IE";
    case "signal": {
      const nearLimit = memoryLimitKb > 0 && result.memoryKb >= memoryLimitKb * 0.9;
      if ((result.signal === "SIGSEGV" || result.signal === "SIGABRT") && nearLimit) return "MLE";
      return runtimeVsMemory(result);
    }
    case "exit_nonzero":
      return runtimeVsMemory(result);
  }
}

/** The JVM and CPython report running out of memory on stderr rather than through a signal. */
function runtimeVsMemory(result: ExecResult): FinalVerdict {
  const err = result.stderr.subarray(0, 8192).toString("utf8");
  if (/OutOfMemoryError|MemoryError|std::bad_alloc/.test(err)) return "MLE";
  return "RE";
}

/** Doc 12 §5 step 8: CE > first failing test's verdict > AC. */
export function aggregate(verdicts: FinalVerdict[]): FinalVerdict {
  for (const v of verdicts) if (v !== "AC") return v;
  return "AC";
}

/** Strips sandbox paths and caps the length of compiler output. */
export function scrubCompileOutput(text: string, boxDir: string, limit = 16 * 1024): string {
  let out = text.split(`${boxDir}/`).join("").split(boxDir).join("").replace(/\\/g, "/");
  out = out.replace(/(^|\s)\/(?:[\w.-]+\/)+([\w.-]+\.(?:cpp|java|py|h))/g, "$1$2");
  return out.length > limit ? `${out.slice(0, limit)}\n... (output truncated)` : out;
}
