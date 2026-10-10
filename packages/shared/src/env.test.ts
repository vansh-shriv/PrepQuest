import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

describe("parseServerEnv", () => {
  it("applies defaults", () => {
    const env = parseServerEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.LLM_MODE).toBe("mock");
    expect(env.FF_VOICE).toBe(false);
  });

  it("parses boolean flags", () => {
    expect(parseServerEnv({ ...base, FF_VOICE: "true" }).FF_VOICE).toBe(true);
  });

  it("throws a readable error when required vars are missing", () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
  });
});
