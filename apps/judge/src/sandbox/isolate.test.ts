import { describe, expect, it } from "vitest";
import { interpretMeta, parseMeta } from "./isolate.js";

const files = { stdout: Buffer.from("out"), stderr: Buffer.alloc(0) };
const spec = { outputLimit: 1024 };
const meta = (text: string) => parseMeta(text);

describe("isolate meta file", () => {
  it("parses key:value lines, keeping colons in values", () => {
    expect(meta("time:0.012\nmessage:Time limit exceeded: wall\nstatus:TO\n")).toMatchObject({
      time: "0.012",
      message: "Time limit exceeded: wall",
      status: "TO",
    });
  });

  it("maps a clean exit to ok with measured usage", () => {
    const r = interpretMeta(
      meta("time:0.012\ntime-wall:0.05\nmax-rss:3400\ncg-mem:4100\nexitcode:0\n"),
      files,
      spec,
      false,
    );
    expect(r).toMatchObject({ status: "ok", cpuMs: 12, wallMs: 50, memoryKb: 4100 });
  });

  it("maps timeouts, signals, runtime errors and sandbox failures", () => {
    expect(interpretMeta(meta("status:TO\ntime:1.2\n"), files, spec, false).status).toBe("timeout");
    expect(interpretMeta(meta("status:SG\nexitsig:11\n"), files, spec, false)).toMatchObject({
      status: "signal",
      signal: "SIGSEGV",
    });
    expect(interpretMeta(meta("status:RE\nexitcode:3\n"), files, spec, false)).toMatchObject({
      status: "exit_nonzero",
      exitCode: 3,
    });
    expect(
      interpretMeta(meta("status:XX\nmessage:cannot run\n"), files, spec, false),
    ).toMatchObject({
      status: "internal",
      message: "cannot run",
    });
  });

  it("flags cgroup OOM kills and oversized output", () => {
    expect(
      interpretMeta(meta("status:SG\nexitsig:9\ncg-oom-killed:1\n"), files, spec, false).status,
    ).toBe("oom");
    expect(interpretMeta(meta("status:SG\nexitsig:25\n"), files, spec, false).status).toBe(
      "output_limit",
    );
    expect(interpretMeta(meta("exitcode:0\n"), files, spec, true).status).toBe("output_limit");
  });
});
