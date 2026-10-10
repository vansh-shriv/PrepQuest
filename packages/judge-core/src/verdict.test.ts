import { describe, expect, it } from "vitest";
import type { ExecResult } from "./types.js";
import { aggregate, classifyRun, scrubCompileOutput } from "./verdict.js";

const result = (over: Partial<ExecResult>): ExecResult => ({
  status: "ok",
  exitCode: 0,
  signal: null,
  cpuMs: 1,
  wallMs: 1,
  memoryKb: 1000,
  stdout: Buffer.alloc(0),
  stderr: Buffer.alloc(0),
  ...over,
});

describe("classifyRun", () => {
  const limit = 256 * 1024;
  it("maps sandbox statuses", () => {
    expect(classifyRun(result({}), limit)).toBeNull();
    expect(classifyRun(result({ status: "timeout" }), limit)).toBe("TLE");
    expect(classifyRun(result({ status: "oom" }), limit)).toBe("MLE");
    expect(classifyRun(result({ status: "output_limit" }), limit)).toBe("OLE");
    expect(classifyRun(result({ status: "internal" }), limit)).toBe("IE");
    expect(classifyRun(result({ status: "exit_nonzero", exitCode: 1 }), limit)).toBe("RE");
  });
  it("treats a segfault near the memory limit as MLE, otherwise RE", () => {
    const segv = { status: "signal" as const, signal: "SIGSEGV", exitCode: null };
    expect(classifyRun(result({ ...segv, memoryKb: limit * 0.95 }), limit)).toBe("MLE");
    expect(classifyRun(result({ ...segv, memoryKb: limit * 0.2 }), limit)).toBe("RE");
    expect(
      classifyRun(result({ status: "signal", signal: "SIGFPE", memoryKb: limit }), limit),
    ).toBe("RE");
  });
  it("recognises out-of-memory errors reported on stderr", () => {
    const err = (s: string) =>
      result({ status: "exit_nonzero", exitCode: 1, stderr: Buffer.from(s) });
    expect(
      classifyRun(
        err("Exception in thread main java.lang.OutOfMemoryError: Java heap space"),
        limit,
      ),
    ).toBe("MLE");
    expect(classifyRun(err("MemoryError"), limit)).toBe("MLE");
    expect(classifyRun(err("terminate called after throwing std::bad_alloc"), limit)).toBe("MLE");
    expect(classifyRun(err("IndexError: list index out of range"), limit)).toBe("RE");
  });
});

describe("aggregate", () => {
  it("reports the first failing test's verdict, else AC", () => {
    expect(aggregate(["AC", "AC"])).toBe("AC");
    expect(aggregate(["AC", "WA", "TLE"])).toBe("WA");
    expect(aggregate([])).toBe("AC");
  });
});

describe("scrubCompileOutput", () => {
  it("strips the sandbox path and truncates long output", () => {
    const out = scrubCompileOutput("/tmp/pq-box-x/main.cpp:3:1: error: oops", "/tmp/pq-box-x");
    expect(out).toBe("main.cpp:3:1: error: oops");
    expect(out).not.toContain("pq-box");
    expect(scrubCompileOutput("x".repeat(100), "/box", 10)).toContain("(output truncated)");
  });
});
