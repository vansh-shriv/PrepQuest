import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, logIn, signUp, uniqueUser } from "./helpers";
import { verifyEmail } from "./interview-helpers";

// Voice interviews through the real stack with a fake Web Speech API: the test says words by calling
// window.__speech.say(...) and decides when the interviewer's speech ends. The model is the mock.

const user = uniqueUser("voice");
test.describe.configure({ mode: "serial" });

const FAKE_SPEECH = `
(() => {
  const state = { spoken: [], cancelled: 0, rec: null, speaking: null, started: 0, stopped: 0 };
  window.__speech = state;
  class Rec {
    constructor() { this.continuous = false; this.interimResults = false; this.lang = ""; state.rec = this; }
    start() { state.started++; this._on = true; }
    stop() { state.stopped++; this._on = false; setTimeout(() => this.onend && this.onend(), 0); }
    abort() { this._on = false; }
  }
  window.webkitSpeechRecognition = Rec;
  window.SpeechRecognition = Rec;
  // say("final text") or say("interim text", false): results accumulate like the real API
  state.results = [];
  state.say = (text, final = true) => {
    const r = state.results;
    if (r.length && !r[r.length - 1].isFinal) r.pop();
    const item = { isFinal: final, 0: { transcript: text }, length: 1 };
    r.push(item);
    state.rec && state.rec.onresult && state.rec.onresult({ results: r });
  };
  state.resetResults = () => { state.results.length = 0; };
  state.finishSpeaking = () => {
    const u = state.speaking; state.speaking = null;
    if (u) { u.charIndex = u.text.length; u.onend && u.onend(); }
  };
  const synth = {
    speak(u) {
      state.spoken.push(u.text);
      state.speaking = u;
      setTimeout(() => u.onboundary && u.onboundary({ charIndex: Math.min(10, u.text.length) }), 20);
    },
    cancel() { if (state.speaking) { state.cancelled++; state.speaking = null; } },
    getVoices() { return []; },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
})();
`;

const NO_RECOGNITION = `
(() => {
  const state = { spoken: [], cancelled: 0 };
  window.__speech = state;
  Object.defineProperty(window, "speechSynthesis", {
    value: { speak(u) { state.spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); }, cancel() {}, getVoices() { return []; } },
    configurable: true,
  });
  delete window.webkitSpeechRecognition; delete window.SpeechRecognition;
})();
`;

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

// only one interview can be live at a time: end whatever a test left running
test.afterEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  const login = await page.request.post("http://localhost:4000/v1/auth/login", {
    data: { email: user.email, password: PASSWORD },
  });
  const h = {
    authorization: `Bearer ${((await login.json()) as { accessToken: string }).accessToken}`,
  };
  const list = (await (
    await page.request.get("http://localhost:4000/v1/interviews", { headers: h })
  ).json()) as {
    items: { id: string; endedAt: string | null; state: string }[];
  };
  for (const i of list.items) {
    if (!i.endedAt)
      await page.request.post(`http://localhost:4000/v1/interviews/${i.id}/end`, {
        headers: h,
        data: {},
      });
  }
});

const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __speech: { spoken: string[] } }).__speech.spoken);

const create = async (page: Page, answerMode: string) => {
  await page.goto("/interview/new");
  await page.getByLabel("Length (minutes)").fill("30");
  await page.getByLabel("How you answer").selectOption(answerMode);
  await page.getByLabel("Problem 1").selectOption({ label: "Two Sum (easy)" });
  await page.getByRole("button", { name: "Start setup" }).click();
};

test("first: sign up and verify the email", async ({ page }) => {
  await signUp(page, user);
  await verifyEmail(page, user.email);
});

test("the setup offers voice, and the briefing runs a microphone check", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await page.addInitScript(FAKE_SPEECH);
  await create(page, "mixed");
  await expect(page.getByTestId("mic-check")).toBeVisible();
  await page.getByRole("button", { name: "Test microphone" }).click();
  await expect(page.getByTestId("mic-check")).toContainText(/Stay quiet/);
  await expect(page.getByTestId("mic-check")).toContainText(/Sounds good|noise|faint|nothing/i, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Test the interviewer's voice" }).click();
  expect((await spoken(page)).join(" ")).toMatch(/your interviewer/);
});

test("push-to-talk, captions, replies read aloud and barge-in", async ({ page }) => {
  await page.addInitScript(FAKE_SPEECH);
  await create(page, "voice");
  await page.getByRole("button", { name: "Begin interview" }).click();
  await expect(page.getByTestId("voice-bar")).toBeVisible();

  // the greeting is read aloud once it is complete, and the control block never reaches the speaker
  await expect
    .poll(async () => (await spoken(page)).join(" "))
    .toMatch(/tell me a bit about yourself/);
  expect((await spoken(page)).join(" ")).not.toMatch(/control|intent/);
  await page.evaluate(() =>
    (window as unknown as { __speech: { finishSpeaking(): void } }).__speech.finishSpeaking(),
  );

  // hold to talk: captions follow the interim words, releasing sends the utterance
  const ptt = page.getByTestId("ptt");
  await ptt.dispatchEvent("pointerdown", { pointerId: 1 });
  await expect(page.getByTestId("voice-status")).toContainText("Listening");
  await page.evaluate(() =>
    (window as unknown as { __speech: { say(t: string, f?: boolean): void } }).__speech.say(
      "hi I am Jane",
      false,
    ),
  );
  await expect(page.getByTestId("captions")).toContainText("hi I am Jane");
  await page.evaluate(() =>
    (window as unknown as { __speech: { say(t: string): void } }).__speech.say(
      "hi I am Jane a final year student",
    ),
  );
  await ptt.dispatchEvent("pointerup", { pointerId: 1 });
  await expect(page.getByTestId("msg-candidate").last()).toContainText(
    "hi I am Jane a final year student",
  );
  await expect(page.getByTestId("captions")).toContainText("Captions appear here");

  // the problem is presented and read aloud; talking over it cuts it off
  await expect(page.getByTestId("chat-log")).toContainText("Here's the problem: Two Sum");
  // replies are spoken in order: let "Nice to meet you" finish so the problem starts
  await page.evaluate(() =>
    (window as unknown as { __speech: { finishSpeaking(): void } }).__speech.finishSpeaking(),
  );
  await expect.poll(async () => (await spoken(page)).join(" ")).toMatch(/Here's the problem/);
  await page.evaluate(() =>
    (window as unknown as { __speech: { resetResults(): void } }).__speech.resetResults(),
  );
  await ptt.dispatchEvent("pointerdown", { pointerId: 1 });
  await page.evaluate(() =>
    (window as unknown as { __speech: { say(t: string, f?: boolean): void } }).__speech.say(
      "wait can the array be empty",
      false,
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __speech: { cancelled: number } }).__speech.cancelled,
      ),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() =>
    (window as unknown as { __speech: { say(t: string): void } }).__speech.say(
      "wait can the array be empty",
    ),
  );
  await ptt.dispatchEvent("pointerup", { pointerId: 1 });
  await expect(page.getByTestId("msg-candidate").last()).toContainText("can the array be empty");

  // the server kept what was heard of the interrupted reply
  await expect
    .poll(async () => {
      const token = (await (
        await page.request.post("http://localhost:4000/v1/auth/login", {
          data: { email: user.email, password: PASSWORD },
        })
      ).json()) as { accessToken: string };
      const h = { authorization: `Bearer ${token.accessToken}` };
      const list = (await (
        await page.request.get("http://localhost:4000/v1/interviews", { headers: h })
      ).json()) as { items: { id: string }[] };
      const id = list.items[0]!.id;
      const t = (await (
        await page.request.get(`http://localhost:4000/v1/interviews/${id}/transcript`, {
          headers: h,
        })
      ).json()) as { transcript: { interrupted: boolean; modality: string }[] };
      return (
        t.transcript.some((x) => x.interrupted) && t.transcript.some((x) => x.modality === "voice")
      );
    })
    .toBe(true);
});

test("hands-free ends your turn after a pause", async ({ page }) => {
  await page.addInitScript(FAKE_SPEECH);
  await create(page, "voice");
  await page.getByRole("button", { name: "Begin interview" }).click();
  await expect(page.getByTestId("voice-bar")).toBeVisible();
  await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0);
  await page.evaluate(() =>
    (window as unknown as { __speech: { finishSpeaking(): void } }).__speech.finishSpeaking(),
  );

  await page.getByRole("button", { name: "Hands-free" }).click();
  await page.getByText("Voice settings").click();
  await page.getByLabel("Pause that ends your turn").selectOption("500");
  await expect(page.getByTestId("voice-status")).toContainText(/Listening|Waiting/);
  await page.evaluate(() =>
    (window as unknown as { __speech: { say(t: string): void } }).__speech.say(
      "I would use a hash map for complements",
    ),
  );
  await expect(page.getByTestId("msg-candidate").last()).toContainText("hash map for complements", {
    timeout: 5000,
  });
});

test("without speech recognition the interview still works: you hear and type", async ({
  page,
}) => {
  await page.addInitScript(NO_RECOGNITION);
  await create(page, "mixed");
  await page.getByRole("button", { name: "Begin interview" }).click();
  await expect(page.getByTestId("chat-log")).toContainText(/tell me a bit about yourself/);
  await expect(page.getByTestId("voice-bar")).toHaveCount(0);
  await expect
    .poll(async () => (await spoken(page)).join(" "))
    .toMatch(/tell me a bit about yourself/);
  await page.getByLabel("Your answer").fill("Typing is fine, I'm Jane.");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("msg-candidate").last()).toContainText("Typing is fine");
});
