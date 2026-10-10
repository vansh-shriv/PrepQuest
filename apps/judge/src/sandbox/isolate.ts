import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Box, ExecResult, ExecSpec, Sandbox } from "@prepquest/judge-core";

const run = promisify(execFile);

export interface IsolateOptions {
  bin: string;
  /** Use cgroup v2 accounting (`--cg`): exact memory limits and peak usage. Needs a delegated cgroup. */
  cgroups: boolean;
  /** Box ids are handed out from this pool so concurrent jobs never share a box. */
  boxIds: number[];
  /** Absolute paths for the portable command names; isolate does not search PATH. */
  commands?: Record<string, string>;
}

/** Read-only system directories the runtimes need beyond isolate's defaults (e.g. the JDK's security config). */
export function extraDirs(): string[] {
  try {
    return readdirSync("/etc")
      .filter((d) => d.startsWith("java-"))
      .map((d) => `/etc/${d}`);
  } catch {
    return [];
  }
}

/**
 * isolate runs the exact path it is given, and only /bin, /usr and /lib are visible inside the box (not /etc,
 * so /usr/bin/java's alternatives symlink would dangle). Resolve to the real binaries.
 */
export function defaultCommands(): Record<string, string> {
  const jvm = (() => {
    if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
    try {
      const dir = readdirSync("/usr/lib/jvm").find((d) => !d.startsWith("."));
      return dir ? `/usr/lib/jvm/${dir}` : null;
    } catch {
      return null;
    }
  })();
  return {
    python3: "/usr/bin/python3",
    "g++": "/usr/bin/g++",
    java: jvm ? `${jvm}/bin/java` : "/usr/bin/java",
    javac: jvm ? `${jvm}/bin/javac` : "/usr/bin/javac",
  };
}

/** Parses isolate's `--meta` file (`key:value` lines). */
export function parseMeta(text: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i)] = line.slice(i + 1);
  }
  return meta;
}

const SIGNALS: Record<number, string> = {
  6: "SIGABRT",
  9: "SIGKILL",
  11: "SIGSEGV",
  24: "SIGXCPU",
  25: "SIGXFSZ",
};

/** Maps isolate's meta output onto the sandbox contract (doc 12 §4-5). Exported for unit tests. */
export function interpretMeta(
  meta: Record<string, string>,
  files: { stdout: Buffer; stderr: Buffer },
  spec: Pick<ExecSpec, "outputLimit">,
  outputTooBig: boolean,
): ExecResult {
  const cpuMs = Math.round(Number(meta.time ?? 0) * 1000);
  const wallMs = Math.round(Number(meta["time-wall"] ?? 0) * 1000);
  const memoryKb = Number(meta["cg-mem"] ?? meta["max-rss"] ?? 0);
  const base = { cpuMs, wallMs, memoryKb, ...files };
  const exitCode = meta.exitcode !== undefined ? Number(meta.exitcode) : null;
  const signalNo = meta.exitsig !== undefined ? Number(meta.exitsig) : null;
  const signal = signalNo === null ? null : (SIGNALS[signalNo] ?? `SIG${signalNo}`);

  if (outputTooBig || signalNo === 25) return { ...base, status: "output_limit", exitCode, signal };
  if (meta["cg-oom-killed"] === "1") return { ...base, status: "oom", exitCode, signal };
  switch (meta.status) {
    case undefined:
      return { ...base, status: "ok", exitCode: 0, signal: null };
    case "TO":
      return { ...base, status: "timeout", exitCode, signal };
    case "SG":
      return { ...base, status: "signal", exitCode, signal };
    case "RE":
      return { ...base, status: "exit_nonzero", exitCode, signal };
    default:
      return {
        ...base,
        status: "internal",
        exitCode,
        signal,
        message: meta.message ?? "isolate failure",
      };
  }
}

/**
 * Production sandbox: `isolate` (IOI) boxes with CPU, wall, memory, process and file-size limits, no
 * network and a read-only view of the system (doc 12 §4). Linux only; run it in the judge container.
 */
export class IsolateSandbox implements Sandbox {
  private free: number[];
  private waiting: Array<(id: number) => void> = [];

  constructor(private readonly opts: IsolateOptions) {
    this.free = [...opts.boxIds];
  }

  private async acquire(): Promise<number> {
    const id = this.free.pop();
    if (id !== undefined) return id;
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(id: number) {
    const next = this.waiting.shift();
    if (next) next(id);
    else this.free.push(id);
  }

  async create(): Promise<Box> {
    const id = await this.acquire();
    const { bin, cgroups } = this.opts;
    const cg = cgroups ? ["--cg"] : [];
    try {
      // a previous crash may have left the box behind
      await run(bin, [...cg, "-b", String(id), "--cleanup"]).catch(() => undefined);
      const { stdout } = await run(bin, [...cg, "-b", String(id), "--init"]);
      const root = path.join(stdout.trim(), "box");
      return new IsolateBox(this.opts, id, root, () => this.release(id));
    } catch (err) {
      this.release(id);
      throw new Error(`isolate --init failed: ${err instanceof Error ? err.message : err}`, {
        cause: err,
      });
    }
  }
}

class IsolateBox implements Box {
  readonly dir: string;
  private seq = 0;

  constructor(
    private readonly opts: IsolateOptions,
    private readonly id: number,
    root: string,
    private readonly onRelease: () => void,
  ) {
    this.dir = root;
  }

  writeFile(name: string, data: string | Buffer) {
    return writeFile(path.join(this.dir, name), data);
  }

  private resolveArgv(argv: string[]): string[] {
    const [cmd = "", ...rest] = argv;
    const commands = this.opts.commands ?? defaultCommands();
    return [commands[cmd] ?? cmd, ...rest];
  }

  async exec(spec: ExecSpec): Promise<ExecResult> {
    const { bin, cgroups } = this.opts;
    const n = ++this.seq;
    const stdin = `.stdin-${n}`;
    const out = `.stdout-${n}`;
    const err = `.stderr-${n}`;
    const metaFile = path.join(this.dir, "..", `meta-${n}.txt`);
    await writeFile(path.join(this.dir, stdin), spec.stdin ?? Buffer.alloc(0));

    const memory = cgroups ? [`--cg-mem=${spec.memoryKb}`] : [`--mem=${spec.memoryKb * 2}`];
    const args = [
      ...(cgroups ? ["--cg"] : []),
      "-b",
      String(this.id),
      `--time=${spec.cpuMs / 1000}`,
      `--wall-time=${spec.wallMs / 1000}`,
      "--extra-time=0.5",
      ...memory,
      "--stack=262144",
      // a compiler writes a binary far larger than its console output, so the file cap is not the output cap
      `--fsize=${Math.ceil(Math.max(spec.outputLimit, 64 * 1024 * 1024) / 1024)}`,
      `--processes=${spec.processes}`,
      "--open-files=64",
      "--dir=/tmp=",
      ...extraDirs().map((d) => `--dir=${d}`),
      "--env=PATH=/usr/local/bin:/usr/bin:/bin",
      "--env=HOME=/box",
      "--env=LANG=C.UTF-8",
      `--stdin=${stdin}`,
      `--stdout=${out}`,
      `--stderr=${err}`,
      `--meta=${metaFile}`,
      "--run",
      "--",
      ...this.resolveArgv(spec.argv),
    ];

    try {
      // isolate exits non-zero for runtime errors; the meta file is the source of truth
      await run(bin, args, { maxBuffer: 1024 * 1024 }).catch(() => undefined);
    } catch (e) {
      return internal(e);
    }

    let meta: Record<string, string>;
    try {
      meta = parseMeta(await readFile(metaFile, "utf8"));
    } catch {
      return internal(new Error("isolate produced no meta file"));
    }
    const outPath = path.join(this.dir, out);
    const outSize = await stat(outPath).then(
      (s) => s.size,
      () => 0,
    );
    // fsize stops writes exactly at the cap, so reaching it means the program wanted to write more
    const tooBig = spec.overflow !== "truncate" && outSize >= spec.outputLimit;
    const stdout = await readCapped(outPath, spec.outputLimit);
    const stderr = await readCapped(path.join(this.dir, err), 64 * 1024);
    return interpretMeta(meta, { stdout, stderr }, spec, tooBig);
  }

  async cleanup() {
    const { bin, cgroups } = this.opts;
    try {
      await run(bin, [...(cgroups ? ["--cg"] : []), "-b", String(this.id), "--cleanup"]).catch(
        () => undefined,
      );
    } finally {
      this.onRelease();
    }
  }
}

async function readCapped(file: string, cap: number): Promise<Buffer> {
  try {
    const buf = await readFile(file);
    return buf.length > cap ? buf.subarray(0, cap) : buf;
  } catch {
    return Buffer.alloc(0);
  }
}

function internal(e: unknown): ExecResult {
  return {
    status: "internal",
    exitCode: null,
    signal: null,
    cpuMs: 0,
    wallMs: 0,
    memoryKb: 0,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    message: e instanceof Error ? e.message : "isolate failure",
  };
}
