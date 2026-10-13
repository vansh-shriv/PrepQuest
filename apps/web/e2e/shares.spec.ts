import { expect, test, type Page } from "@playwright/test";
import { logIn, signUp, uniqueUser } from "./helpers";
import { verifyEmail } from "./interview-helpers";

// Phase 13: a scorecard is shared through a link, read by someone who is not signed in, then revoked.

const user = uniqueUser("sh");
test.describe.configure({ mode: "serial" });

let link = "";

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

const say = async (page: Page, text: string) => {
  const before = await page.getByTestId("msg-interviewer").count();
  await page.getByLabel("Your answer").fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("msg-interviewer").nth(before)).toBeVisible();
};

test("first: sign up, verify the email and finish a short interview", async ({ page }) => {
  await signUp(page, user);
  await verifyEmail(page, user.email);
  await page.goto("/interview/new");
  await page.getByLabel("Length (minutes)").fill("30");
  await page.getByLabel("Problem 1").selectOption({ label: "Two Sum (easy)" });
  await page.getByRole("button", { name: "Start setup" }).click();
  await page.getByRole("button", { name: "Begin interview" }).click();
  await expect(page.getByTestId("chat-log")).toContainText(/introduce|tell me/i);
  await say(page, `Hi, I'm ${user.name}. Mail me at someone@example.com.`);
  await say(page, "I would use a hash map for complements.");
  await page.getByRole("button", { name: "End interview" }).click();
  await page.getByRole("button", { name: "End and get my scorecard" }).click();
  await page
    .getByRole("main")
    .getByRole("link", { name: /scorecard|review/i })
    .first()
    .click();
  await expect(page.getByTestId("scorecard")).toBeVisible({ timeout: 30_000 });
});

test("the owner makes a link with the default privacy settings", async ({ page }) => {
  await page.goto("/interview");
  await page
    .getByRole("main")
    .getByRole("link", { name: /scorecard|review/i })
    .first()
    .click();
  await expect(page.getByTestId("scorecard")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const form = page.getByTestId("share-form");
  await expect(form.getByLabel("Hide quotes from the interview")).toBeChecked();
  await expect(form.getByLabel("Hide the company name")).toBeChecked();
  await form.getByLabel("Hide my name").check();
  await form.getByRole("button", { name: "Create link" }).click();
  const made = page.getByTestId("share-created");
  await expect(made).toBeVisible();
  link = await made.getByLabel("Link").inputValue();
  expect(link).toMatch(/\/r\/[A-Za-z0-9_-]{30,}$/);
});

test("anyone with the link reads the report without signing in; it hides the name", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const res = await page.goto(link);
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId("shared-report")).toBeVisible();
  await expect(page.getByTestId("report-score")).toContainText("/ 100");
  await expect(page.getByTestId("report-dimension").first()).toBeVisible();
  const text = (await page.getByTestId("shared-report").innerText()).toLowerCase();
  expect(text).not.toContain(user.name.toLowerCase());
  expect(text).not.toContain("someone@example.com");
  await expect(page.getByTestId("shared-report")).toContainText("A PrepQuest learner");

  // the link preview: Open Graph tags point at the generated image, and an unlisted link is not indexed
  const image = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(image).toMatch(/\/v1\/r\/[A-Za-z0-9_-]+\/og\.png$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  const png = await page.request.get(image!);
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");
  expect((await png.body()).subarray(1, 4).toString()).toBe("PNG");
  await context.close();
});

test("settings count the views and revoking the link switches it off at once", async ({
  page,
  browser,
}) => {
  await page.goto("/settings");
  const row = page.getByTestId("shared-link").first();
  await expect(row).toContainText("Interview scorecard");
  await expect(row).toContainText(/[1-9]\d* views?/);
  await expect(row).toContainText("Hides transcript quotes, code quotes, company, name");
  await row.getByRole("button", { name: /Revoke the link/ }).click();
  await expect(row).toContainText("Revoked");

  const context = await browser.newContext();
  const guest = await context.newPage();
  const res = await guest.goto(link);
  expect(res?.status()).toBe(404);
  await expect(guest.getByText("THIS REPORT IS GONE")).toBeVisible();
  await context.close();
});
