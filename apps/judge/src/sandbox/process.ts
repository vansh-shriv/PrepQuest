import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Box, ExecResult, ExecSpec, Sandbox } from "@prepquest/judge-core";

const WINDOWS = process.platform === "win32";

/** Maps the portable commands in the language table onto what is installed here. */
function resolveCommand(cmd: string, dir: string): string {
  if (cmd.startsWith("./")) return path.join(dir, cmd.slice(2) + (WINDOWS ? ".exe" : ""));
  switch (cmd) {
    case "python3":
      return process.env.PYTHON_BIN ?? (WINDOWS ? "python" : "python3");
    case "g++":
      return process.env.CXX_BIN ?? "g++";
    case "java":
    case "javac": {
      const home = process.env.JAVA_HOME;
      return home ? path.join(home, "bin", cmd) : cmd;
    }
    default:
      return cmd;
  }
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (WINDOWS) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

/**
 * Development sandbox: a throwaway directory and a child process with a wall-clock timeout and an
 * output cap. It does NOT restrict memory, files or the network, so it must never run other people's
 * code. The production sandbox is `IsolateSandbox` (Linux). The worker refuses to start this one when
 * NODE_ENV=production.
 */
export class ProcessSandbox implements Sandbox {
  async create(): Promise<Box> {
    const dir = await mkdtemp(path.join(tmpdir(), "pq-box-"));
    return {
      dir,
      writeFile: (name, data) => writeFile(path.join(dir, name), data),
      exec: (spec) => execInDir(dir, spec),
      cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
    };
  }
}

function execInDir(dir: string, spec: ExecSpec): Promise<ExecResult> {
  return new Promise((resolve) => {
    const [cmd = "", ...args] = spec.argv;
    const started = performance.now();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let state: "running" | "timeout" | "output_limit" = "running";
    let settled = false;

    const done = (
      result: Omit<ExecResult, "stdout" | "stderr" | "cpuMs" | "wallMs" | "memoryKb">,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const wall = Math.round(performance.now() - started);
      resolve({
        cpuMs: wall, // no CPU accounting here: wall time stands in
        wallMs: wall,
        memoryKb: 0,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        ...result,
      });
    };

    let child;
    try {
      child = spawn(resolveCommand(cmd, dir), args, {
        cwd: dir,
        detached: !WINDOWS,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          TEMP: dir,
          TMP: dir,
          HOME: dir,
        },
      });
    } catch (err) {
      resolve({
        status: "internal",
        exitCode: null,
        signal: null,
        cpuMs: 0,
        wallMs: 0,
        memoryKb: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        message: err instanceof Error ? err.message : "spawn failed",
      });
      return;
    }

    // wall-clock limit stands in for the CPU limit (the cap is the larger of the two)
    const timer = setTimeout(() => {
      state = "timeout";
      killTree(child.pid);
    }, spec.wallMs);

    child.stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > spec.outputLimit) {
        if (spec.overflow === "truncate") return; // compilers: keep the beginning, ignore the rest
        if (state === "running") state = "output_limit";
        killTree(child.pid);
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errBytes < 64 * 1024) {
        errBytes += chunk.length;
        stderr.push(chunk);
      }
    });
    child.stdin.on("error", () => undefined); // the program may exit without reading its input
    child.stdin.end(spec.stdin ?? undefined);

    child.on("error", (err) => {
      done({ status: "internal", exitCode: null, signal: null, message: err.message });
    });
    child.on("close", (code, signal) => {
      if (state === "timeout") return done({ status: "timeout", exitCode: code, signal });
      if (state === "output_limit") return done({ status: "output_limit", exitCode: code, signal });
      if (signal) return done({ status: "signal", exitCode: null, signal });
      if (code !== 0) return done({ status: "exit_nonzero", exitCode: code, signal: null });
      done({ status: "ok", exitCode: 0, signal: null });
    });
  });
}
