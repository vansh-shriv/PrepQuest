import type { Language } from "./types.js";

export interface LanguageConfig {
  /** Files written into the box (name -> built by the driver generator). */
  compile: string[] | null;
  run: (memoryKb: number) => string[];
  /** Process/thread cap while running (the JVM needs threads). */
  runProcesses: number;
  /** Process cap while compiling. */
  compileProcesses: number;
}

// Doc 12 §3. Time multipliers live in problem_languages (applied at import), not here.
export const LANGUAGE_CONFIG: Record<Language, LanguageConfig> = {
  cpp: {
    compile: ["g++", "-O2", "-std=c++17", "-pipe", "-o", "main", "main.cpp"],
    run: () => ["./main"],
    runProcesses: 1,
    compileProcesses: 64,
  },
  java: {
    compile: ["javac", "-encoding", "UTF-8", "Main.java", "Solution.java"],
    run: (memoryKb) => [
      "java",
      `-Xmx${Math.max(64, Math.floor(memoryKb / 1024))}m`,
      "-Xss64m",
      "-XX:+UseSerialGC",
      "-XX:TieredStopAtLevel=1",
      "Main",
    ],
    runProcesses: 16,
    compileProcesses: 64,
  },
  python: {
    compile: null,
    run: () => ["python3", "-S", "-B", "main.py"],
    runProcesses: 1,
    compileProcesses: 64,
  },
};

export const COMPILE_LIMITS = {
  cpuMs: 10_000,
  wallMs: 15_000,
  memoryKb: 512 * 1024,
  outputLimit: 16 * 1024,
};

/** Output cap before a run becomes OLE (doc 12 §4). */
export const RUN_OUTPUT_LIMIT = 64 * 1024 * 1024;
/** Characters of stdout/stderr kept per test. */
export const TAIL_BYTES = 4 * 1024;
/** Wall-clock slack on top of CPU time (catches sleeps and I/O stalls). */
export const WALL_SLACK_MS = 1000;
