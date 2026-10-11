import { expect, test, type Page } from "@playwright/test";
import { logIn, signUp, uniqueUser } from "./helpers";
import { verifyEmail } from "./interview-helpers";

// Phase 8: more round types, company packs, ideal answers, STAR, speech and question memory.
// The model is the scripted mock (LLM_MODE=mock).

const user = uniqueUser("rd");
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

const say = async (page: Page, text: string) => {
  const before = await page.getByTestId("msg-interviewer").count();
  await page.getByLabel("Your answer").fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("msg-candidate").last()).toContainText(text.slice(0, 20));
  await expect(page.getByTestId("msg-interviewer").nth(before)).toBeVisible();
};

test("first: sign up and verify the email", async ({ page }) => {
  await signUp(page, user);
  await verifyEmail(page, user.email);
});

test("a company pack changes the plan preview visibly", async ({ page }) => {
  await page.goto("/interview/new");
  const preview = page.getByTestId("plan-preview");
  await expect(preview).toContainText("Questions");
  await expect(page.getByTestId("pack-effects")).toHaveCount(0);
  await page.getByLabel("Company pack").selectOption({ label: "Product company, high bar" });
  await expect(page.getByTestId("pack-effects")).toContainText(/Hints/);
  await preview.getByText("How you are scored").click();
  await expect(preview).toContainText(/Problem solving: 30%/);
});

test("a behavioural round: stories, then STAR, ideal answers and speech in the review", async ({
  page,
}) => {
  await page.goto("/interview/new?type=behavioral");
  await expect(page.getByTestId("plan-preview")).toContainText("Questions");
  await page.getByRole("button", { name: "Start setup" }).click();
  await page.getByRole("button", { name: "Begin interview" }).click();
  await expect(page.getByTestId("interview-room")).toBeVisible();
  await expect(page.getByTestId("chat-log")).toContainText(/tell me a bit about yourself/i);

  await say(page, "Hi, I'm Jane, a final year student who likes building things.");
  await expect(page.getByTestId("chat-log")).toContainText(/hear a story/);
  await say(
    page,
    "Last summer at my internship I needed to cut build time. I built a cache layer myself and we reduced it by 40%. I learned to measure first.",
  );

  await page.getByRole("button", { name: "End interview" }).click();
  await page.getByRole("button", { name: "End and get my scorecard" }).click();
  await page
    .getByRole("link", { name: /scorecard|review/i })
    .first()
    .click();
  await expect(page.getByTestId("scorecard")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Ideal answers" }).click();
  await expect(page.getByTestId("ideal-answers")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("ideal-answers")).toContainText("Your story, restructured");

  await page.getByRole("tab", { name: "STAR" }).click();
  await expect(page.getByTestId("star-scores")).toContainText(/STAR \d+%/);

  await page.getByRole("tab", { name: "Speech" }).click();
  await expect(page.getByTestId("speech-panel")).toContainText(/not a diagnosis/);

  // practise the question again: a fresh interview opens
  await page.getByRole("tab", { name: "Ideal answers" }).click();
  await page.getByRole("button", { name: "Practise this question again" }).first().click();
  await expect(page).toHaveURL(/\/interview\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: /Ready for/ })).toBeVisible();
});

test("the question history lists what was asked and lets you forget it", async ({ page }) => {
  await page.goto("/interview/history");
  const list = page.getByTestId("question-history");
  await expect(list).toBeVisible();
  const count = await list.getByRole("listitem").count();
  expect(count).toBeGreaterThan(0);
  await list
    .getByRole("button", { name: /^Forget/ })
    .first()
    .click();
  if (count > 1) {
    await expect(list.getByRole("listitem")).toHaveCount(count - 1);
    await page.getByRole("button", { name: "Clear all" }).click();
  }
  await expect(page.getByText("Nothing here yet.")).toBeVisible();
});

test("the callbacks setting can be turned off", async ({ page }) => {
  await page.goto("/settings");
  const box = page.getByLabel("Interviewers may refer to past practice");
  await expect(box).toBeChecked();
  await box.click();
  await expect(box).not.toBeChecked();
  await page.reload();
  await expect(page.getByLabel("Interviewers may refer to past practice")).not.toBeChecked();
});
