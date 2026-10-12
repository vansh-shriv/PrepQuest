import { expect, test } from "@playwright/test";
import { logIn, signUp, uniqueUser } from "./helpers";

// Phase 9: readiness, the diagnostic, the study plan and daily goals through the real stack.

const user = uniqueUser("pl");
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

test("first: sign up", async ({ page }) => {
  await signUp(page, user);
});

test("a new learner sees today's quests and is pointed to the diagnostic", async ({ page }) => {
  await page.goto("/dashboard");
  const board = page.getByTestId("quest-board");
  await expect(board).toBeVisible();
  await expect(board.getByRole("list", { name: "Daily goals" })).toContainText("Solve problems");
  await expect(board.getByTestId("readiness-score")).toHaveText("Not enough data");
  await expect(board.getByTestId("next-action")).toContainText(/diagnostic/i);
  await expect(board).toContainText("You don't have a study plan yet");
});

test("readiness says there is not enough data and offers the diagnostic", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page.getByTestId("readiness-score")).toHaveText("Not enough data");
  await expect(page.getByTestId("diagnostic")).toBeVisible();
  await page.getByRole("button", { name: "Start the diagnostic" }).click();
  await expect(page.getByTestId("diagnostic").getByRole("link")).toHaveCount(5);
  await expect(page.getByTestId("diagnostic")).toContainText("0/5 tried");
  // components without evidence are labelled, not guessed
  await expect(page.getByTestId("readiness-component").first()).toContainText("Not enough data");
});

test("the other analytics tabs load with friendly empty states", async ({ page }) => {
  await page.goto("/analytics");
  await page.getByRole("tab", { name: "Topics" }).click();
  await expect(page.getByTestId("topics")).toBeVisible();
  await expect(page.getByTestId("topic-row").first()).toBeVisible();
  await page.getByRole("tab", { name: "Interviews" }).click();
  await expect(page.getByTestId("trends")).toContainText("No scored interviews yet");
  await page.getByRole("tab", { name: "Time" }).click();
  await expect(page.getByTestId("time-analysis")).toContainText("Solve a few problems");
});

test("building a plan, working through it and updating it", async ({ page }) => {
  await page.goto("/plan");
  await expect(
    page.getByRole("heading", { name: "Build your plan" }).or(page.getByText("Build your plan")),
  ).toBeVisible();
  const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Placement or interview date (optional)").fill(date);
  await page.getByLabel("Hours per day").fill("2");
  await page.getByRole("button", { name: "Build my plan" }).click();

  const plan = page.getByTestId("plan");
  await expect(plan).toBeVisible();
  await expect(plan).toContainText("Version 1");
  await expect(plan.getByRole("list", { name: "Plan phases" })).toContainText("Foundations");
  const first = plan.getByTestId("plan-task").first();
  await expect(first).toBeVisible();
  await expect(first).toContainText(/New topic|Weak spot|Keep/);

  // lock a task
  const title = await first.locator("a, strong").first().innerText();
  await first.getByRole("button", { name: /^Lock:/ }).click();
  await expect(plan.getByTestId("plan-task").filter({ hasText: title }).first()).toContainText(
    "locked",
  );

  // mark one done by hand and skip another
  await first.getByRole("checkbox").click({ force: true });
  await expect(plan.getByTestId("plan-task").filter({ hasText: title }).first()).toHaveAttribute(
    "data-status",
    "done",
  );

  // add your own task
  await page.getByLabel("Task", { exact: true }).fill("Revise operating systems notes");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(plan).toContainText("Revise operating systems notes");

  // update the plan: done and locked work stays, and the page says what changed
  await page.getByRole("button", { name: "Update plan" }).click();
  await expect(plan).toContainText("Version 2");
  await expect(plan).toContainText("Revise operating systems notes");
  await expect(plan.getByTestId("plan-task").filter({ hasText: title }).first()).toHaveAttribute(
    "data-status",
    "done",
  );
});

test("the dashboard quest board follows the plan, and goals can be changed", async ({ page }) => {
  await page.goto("/dashboard");
  const board = page.getByTestId("quest-board");
  await expect(board).toContainText("On today's plan");
  await expect(board.getByTestId("next-action")).toBeVisible();

  await page.goto("/plan");
  await page.getByLabel("Preset").selectOption("light");
  await expect(page.getByText("1 problem a day")).toBeVisible();
  await page.goto("/dashboard");
  await expect(
    page.getByTestId("quest-board").getByRole("list", { name: "Daily goals" }),
  ).toContainText("0/1");
});
