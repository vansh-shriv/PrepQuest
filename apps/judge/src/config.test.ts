import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = { REDIS_URL: "redis://localhost:6379" };

describe("judge config", () => {
  it("needs only Redis, and has safe development defaults", () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      JUDGE_SANDBOX: "process",
      JUDGE_CONCURRENCY: 2,
      STORAGE_DRIVER: "fs",
    });
    expect(() => loadConfig({})).toThrow(/REDIS_URL/);
  });

  it("does not ask for database or API secrets", () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: "production", JUDGE_SANDBOX: "isolate" }),
    ).not.toThrow();
  });

  it("refuses the unsandboxed runner in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(
      /not allowed in production/,
    );
    expect(() =>
      loadConfig({ ...base, NODE_ENV: "production", JUDGE_SANDBOX: "process" }),
    ).toThrow();
  });

  it("validates limits", () => {
    expect(() => loadConfig({ ...base, JUDGE_CONCURRENCY: "0" })).toThrow();
    expect(loadConfig({ ...base, JUDGE_CGROUPS: "true" }).JUDGE_CGROUPS).toBe(true);
  });
});
