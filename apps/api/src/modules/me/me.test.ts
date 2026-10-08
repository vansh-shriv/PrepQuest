import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, makeTestApp, SAMPLE, signupAndLogin, type TestApp } from "../../test/helpers.js";

let t: TestApp;
beforeEach(async () => {
  await t?.close();
  t = await makeTestApp();
});
afterAll(() => t.close());

const call = (method: "GET" | "PATCH" | "DELETE", url: string, token: string, payload?: object) =>
  t.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

describe("GET /me", () => {
  it("returns profile, settings defaults and no secrets", async () => {
    const { accessToken } = await signupAndLogin(t);
    const res = await call("GET", "/v1/me", accessToken);
    expect(res.statusCode).toBe(200);
    const me = res.json();
    expect(me.profile).toMatchObject({
      handle: SAMPLE.handle,
      displayName: "Ada",
      xp: 0,
      level: 1,
    });
    expect(me.settings).toMatchObject({
      theme: "system",
      hintMode: "strict",
      defaultLanguage: "cpp",
    });
    expect(JSON.stringify(me)).not.toMatch(/password|hash/i);
  });
});

describe("PATCH /me/profile", () => {
  it("updates only the provided fields", async () => {
    const { accessToken } = await signupAndLogin(t);
    const res = await call("PATCH", "/v1/me/profile", accessToken, {
      displayName: "Ada Lovelace",
      college: "NIT",
      gradYear: 2027,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile).toMatchObject({
      displayName: "Ada Lovelace",
      college: "NIT",
      gradYear: 2027,
      handle: SAMPLE.handle,
    });
  });

  it("rejects unknown and invalid fields (no mass assignment)", async () => {
    const { accessToken } = await signupAndLogin(t);
    const role = await call("PATCH", "/v1/me/profile", accessToken, { role: "admin" });
    expect(role.statusCode).toBe(422);
    const xp = await call("PATCH", "/v1/me/profile", accessToken, { xp: 99999 });
    expect(xp.statusCode).toBe(422);
    const bad = await call("PATCH", "/v1/me/profile", accessToken, { gradYear: 1900 });
    expect(bad.statusCode).toBe(422);
    const me = await call("GET", "/v1/me", accessToken);
    expect(me.json().role).toBe("user");
    expect(me.json().profile.xp).toBe(0);
  });
});

describe("PATCH /me/settings", () => {
  it("persists theme and toggles", async () => {
    const { accessToken } = await signupAndLogin(t);
    const res = await call("PATCH", "/v1/me/settings", accessToken, {
      theme: "night",
      readableMode: true,
      hintMode: "relaxed",
    });
    expect(res.json().settings).toMatchObject({
      theme: "night",
      readableMode: true,
      hintMode: "relaxed",
    });
    expect(
      (await call("PATCH", "/v1/me/settings", accessToken, { theme: "neon" })).statusCode,
    ).toBe(422);
  });
});

describe("sessions", () => {
  it("lists devices, marks the current one and revokes another", async () => {
    const first = await signupAndLogin(t);
    const second = await t.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: SAMPLE.email, password: SAMPLE.password },
      headers: { "user-agent": "Second Device" },
    });
    const secondToken = second.json().accessToken as string;

    const list = (await call("GET", "/v1/me/sessions", secondToken)).json().items as Array<{
      id: string;
      current: boolean;
      userAgent: string | null;
    }>;
    expect(list).toHaveLength(2);
    const current = list.find((s) => s.current)!;
    expect(current.userAgent).toBe("Second Device");

    const other = list.find((s) => !s.current)!;
    expect((await call("DELETE", `/v1/me/sessions/${other.id}`, secondToken)).statusCode).toBe(204);
    expect((await call("GET", "/v1/me/sessions", first.accessToken)).json().items).toHaveLength(1);
  });

  it("cannot revoke another user's session", async () => {
    const a = await signupAndLogin(t);
    const b = await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" });
    const bobSessions = (await call("GET", "/v1/me/sessions", b.accessToken)).json()
      .items as Array<{ id: string }>;
    const res = await call("DELETE", `/v1/me/sessions/${bobSessions[0]!.id}`, a.accessToken);
    expect(res.statusCode).toBe(404);
    expect((await call("GET", "/v1/me/sessions", b.accessToken)).json().items).toHaveLength(1);
  });
});
