import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./test/helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.close());

describe("health routes", () => {
  it("liveness returns ok and echoes a request id", async () => {
    const res = await t.app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("propagates an incoming request id", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-request-id": "trace-123" },
    });
    expect(res.headers["x-request-id"]).toBe("trace-123");
  });

  it("allows browser preflights for PATCH and DELETE from the web origin only", async () => {
    const preflight = (origin: string, method: string) =>
      t.app.inject({
        method: "OPTIONS",
        url: "/v1/me/profile",
        headers: {
          origin,
          "access-control-request-method": method,
          "access-control-request-headers": "authorization,content-type",
        },
      });

    for (const method of ["PATCH", "DELETE"]) {
      const ok = await preflight("http://localhost:3000", method);
      expect(ok.statusCode).toBe(204);
      expect(ok.headers["access-control-allow-methods"]).toContain(method);
      expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    }
    const evil = await preflight("https://evil.example", "PATCH");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("exposes the response headers the web app reads cross-origin", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { origin: "http://localhost:3000" },
    });
    const exposed = String(res.headers["access-control-expose-headers"]).toLowerCase();
    for (const header of [
      "content-disposition",
      "retry-after",
      "x-request-id",
      "ratelimit-remaining",
    ]) {
      expect(exposed).toContain(header);
    }
  });

  it("unknown routes use the standard error shape", async () => {
    const res = await t.app.inject({ method: "GET", url: "/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: "NOT_FOUND", requestId: expect.any(String) });
  });
});
