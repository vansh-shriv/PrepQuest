import { expect, test, type Page } from "@playwright/test";
import { logIn, signUp, uniqueUser } from "./helpers";
import { verifyEmail } from "./interview-helpers";

// Phase 17: a system design interview with a drawing board the interviewer can see. The model is the
// scripted mock (LLM_MODE=mock); what is tested is the board, its delivery to the server and the review.

const user = uniqueUser("hd");
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

const nodes = (page: Page) => page.getByTestId("design-node");
let roomUrl = "";

test("first: sign up and verify the email", async ({ page }) => {
  await signUp(page, user);
  await verifyEmail(page, user.email);
});

test("a design interview opens with a drawing board next to the chat", async ({ page }) => {
  await page.goto("/interview/new?type=hld");
  await expect(page.getByTestId("plan-preview")).toContainText("Questions");
  await page.getByRole("button", { name: "Start setup" }).click();
  await expect(page.getByText(/The interviewer sees what you draw/)).toBeVisible();
  await page.getByRole("button", { name: "Begin interview" }).click();
  await expect(page.getByTestId("interview-room")).toBeVisible();
  await expect(page.getByTestId("interview-board")).toBeVisible();
  await expect(page.getByTestId("chat-log")).toContainText(/tell me a bit about yourself/i);
  await expect(nodes(page)).toHaveCount(0);
  roomUrl = page.url();
});

test("what is drawn reaches the server and survives a reload", async ({ page }) => {
  await page.goto(roomUrl);
  const toolbar = page.getByRole("toolbar", { name: "Add a component" });
  const finished = page.waitForResponse(
    (r) =>
      r.url().endsWith("/events") &&
      r.request().method() === "POST" &&
      r.ok() &&
      (r.request().postData() ?? "").includes("Shortener API") &&
      (r.request().postData() ?? "").split('"from"').length === 3,
  );
  await toolbar.getByRole("button", { name: "+ Client" }).click();
  await toolbar.getByRole("button", { name: "+ Service" }).click();
  await toolbar.getByRole("button", { name: "+ Database" }).click();
  await expect(nodes(page)).toHaveCount(3);
  await nodes(page).nth(1).click();
  await page.getByTestId("design-inspector").getByLabel("Service name").fill("Shortener API");
  await nodes(page).nth(0).click();
  await page.getByRole("button", { name: "Connect to…" }).click();
  await nodes(page).nth(1).click();
  await nodes(page).nth(1).click();
  await page.getByRole("button", { name: "Connect to…" }).click();
  await nodes(page).nth(2).click();
  await expect(page.getByTestId("design-edge")).toHaveCount(2);

  // the snapshot that carries the finished drawing (two connections) has been accepted
  await finished;
  await page.reload();
  await expect(nodes(page)).toHaveCount(3);
  await expect(page.getByTestId("design-edge")).toHaveCount(2);
  await expect(nodes(page).nth(1)).toHaveAccessibleName(/Shortener API/);
});

test("the review shows the final drawing and the checks on it", async ({ page }) => {
  await page.goto(roomUrl);
  await expect(nodes(page)).toHaveCount(3);
  await page
    .getByLabel("Your answer")
    .fill("Hello, I am Jane. Let me start with the requirements.");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("msg-interviewer").nth(1)).toBeVisible();

  await page.getByRole("button", { name: "End interview" }).click();
  await page.getByRole("button", { name: "End and get my scorecard" }).click();
  await page
    .getByRole("main")
    .getByRole("link", { name: /scorecard|review/i })
    .first()
    .click();
  await expect(page.getByTestId("scorecard")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Your drawing" }).click();
  const review = page.getByTestId("drawing-review");
  await expect(review.getByTestId("design-node")).toHaveCount(3);
  const finding = review.getByTestId("drawing-finding").filter({ hasText: "replica" });
  await expect(finding).toContainText("Important");
});
