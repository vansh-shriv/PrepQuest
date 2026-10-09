import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HARNESS = fileURLToPath(new URL("../python/harness.py", import.meta.url));

let pythonCommand: Promise<string> | undefined;

/** Finds a working Python 3 interpreter (`PYTHON` env, then python3, then python). */
export function findPython(): Promise<string> {
  pythonCommand ??= (async () => {
    for (const cmd of [process.env.PYTHON, "python3", "python"].filter(Boolean) as string[]) {
      const ok = await new Promise<boolean>((resolve) => {
        const p = spawn(
          cmd,
          ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)"],
          { stdio: "ignore" },
        );
        p.on("error", () => resolve(false));
        p.on("close", (code) => resolve(code === 0));
      });
      if (ok) return cmd;
    }
    throw new Error("Python 3.9+ is required to build and verify tests (set PYTHON to its path)");
  })();
  return pythonCommand;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Runs `python <script> [args]` with optional stdin, with a timeout. -I isolates from site/user paths. */
export async function runPython(
  script: string,
  args: string[],
  stdin = "",
  timeoutMs = 60_000,
): Promise<RunResult> {
  const python = await findPython();
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${timeoutMs} ms: ${script}`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin);
  });
}

/** Runs the reference solution of a problem folder on one canonical input. */
export function runReference(problemDir: string, input: string): Promise<RunResult> {
  return runPython(HARNESS, [problemDir], input);
}
