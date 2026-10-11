import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDF_MIME, SAMPLE_RESUME_LINES, makePdf, multipartFile } from "../../test/documents.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp({ env: { RL_RESUMES_PER_DAY: "2" } });
});
afterAll(() => t.close());

describe("resume upload limits", () => {
  it("limits uploads per user per day", async () => {
    const tok = (await signupAndLogin(t)).accessToken;
    await verifyAllEmails(t);
    const { payload, contentType } = multipartFile("a.pdf", makePdf(SAMPLE_RESUME_LINES), PDF_MIME);
    const send = () =>
      t.app.inject({
        method: "POST",
        url: "/v1/resumes",
        payload,
        headers: { ...bearer(tok), "content-type": contentType },
      });
    expect((await send()).statusCode).toBe(202);
    expect((await send()).statusCode).toBe(202);
    const third = await send();
    expect(third.statusCode).toBe(429);
    expect(third.headers["retry-after"]).toBeDefined();
    await t.idle();
  });
});
