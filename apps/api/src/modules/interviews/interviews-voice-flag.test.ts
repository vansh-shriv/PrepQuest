import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedContent } from "../../test/content.js";
import { Interviews } from "../../test/interviews.js";
import { makeTestApp, signupAndLogin, verifyAllEmails, type TestApp } from "../../test/helpers.js";

let t: TestApp;
let ada: Interviews;

beforeAll(async () => {
  t = await makeTestApp(); // FF_VOICE is off by default
  await seedContent(t, ["two-sum"]);
  ada = new Interviews(t, (await signupAndLogin(t)).accessToken);
  await verifyAllEmails(t);
});
afterAll(() => t.close());

describe("voice feature flag", () => {
  it("keeps voice interviews off until the flag is on, and text interviews work as before", async () => {
    const templates = await ada.call("GET", "/interview/templates");
    expect(templates.json<{ features: { voice: boolean } }>().features.voice).toBe(false);
    const voice = await ada.create({ mode: "voice", problemSlugs: ["two-sum"] });
    expect(voice.res.statusCode).toBe(422);
    expect(voice.res.json<{ error: { code: string } }>().error.code).toBe("VOICE_DISABLED");
    expect((await ada.create({ mode: "mixed" })).res.statusCode).toBe(422);
    expect((await ada.create({ problemSlugs: ["two-sum"] })).res.statusCode).toBe(201);
  });
});
