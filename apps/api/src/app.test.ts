import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@prepquest/shared";
import { buildApp } from "./app.js";

const env = parseServerEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
});

describe("health routes", () => {
  it("liveness returns ok", async () => {
    const app = await buildApp({ env, checks: {} });
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("readiness returns 503 when a dependency is down", async () => {
    const app = await buildApp({
      env,
      checks: { ok: async () => {}, bad: async () => Promise.reject(new Error("x")) },
    });
    const res = await app.inject({ method: "GET", url: "/v1/health/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual({ ok: "up", bad: "down" });
  });
});
