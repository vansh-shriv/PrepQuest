import { expect, test } from "@playwright/test";
import { logIn, signUp, uniqueUser } from "./helpers";
import { setEditorText } from "./interview-helpers";

// Phase 11: SQL practice and the online-assessment simulator through the real stack.

const user = uniqueUser("as");
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

test("first: sign up", async ({ page }) => {
  await signUp(page, user);
});

test("the SQL list shows problems by dataset and filters them", async ({ page }) => {
  await page.goto("/sql");
  await expect(page.getByRole("heading", { name: "SQL practice", level: 1 })).toBeVisible();
  await expect(page.getByText("0 of 26 solved")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cheap products" })).toBeVisible();
  await page.getByLabel("Topic").selectOption("windows");
  await expect(page.getByRole("link", { name: "Cheap products" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Running revenue" })).toBeVisible();
});

test("a query runs, a wrong one is explained, a right one is accepted and earns XP", async ({
  page,
}) => {
  await page.goto("/sql/cheap-products");
  await expect(page.getByTestId("sql-schema")).toContainText("products");
  await page.getByRole("button", { name: "Show sample rows" }).first().click();
  await expect(page.getByTestId("sql-schema").getByRole("table").first()).toBeVisible();

  await setEditorText(page, "SELECT name FROM products WHERE price < 20");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("sql-result")).toContainText("1 row");

  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("status", { name: "Verdict: Wrong answer" })).toBeVisible();
  await expect(page.getByText("Expected 2 rows, got 1.")).toBeVisible();
  await expect(page.getByTestId("sql-solution")).toHaveCount(0);

  await setEditorText(page, "DELETE FROM products");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("sql-error")).toContainText("Only SELECT");

  await setEditorText(page, "SELECT name FROM products WHERE price < 100 ORDER BY name");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("status", { name: "Verdict: Accepted" })).toBeVisible();
  await expect(page.getByText("+10 XP")).toBeVisible();
  await expect(page.getByTestId("sql-solution")).toBeVisible();

  await page.goto("/sql");
  await expect(page.getByText("1 of 26 solved")).toBeVisible();
});

test("a speed drill runs against a clock, saves answers and ends with a report", async ({
  page,
}) => {
  await page.goto("/tests");
  await expect(page.getByTestId("oa-home")).toBeVisible();
  await page
    .getByTestId("oa-template")
    .filter({ hasText: "Ten reasoning questions" })
    .getByRole("button", { name: "Start" })
    .click();

  await expect(page.getByTestId("oa-between")).toBeVisible();
  await expect(page.getByTestId("oa-between")).toContainText("cannot go back");
  await page.getByRole("button", { name: "Start section" }).click();

  await expect(page.getByTestId("oa-section")).toBeVisible();
  await expect(page.getByTestId("oa-clock")).toHaveText(/^[0-5]:\d\d$/);
  // answer the first question, leave the rest blank
  // the paper is random: the first question may be a choice or a typed answer
  const question = page.getByTestId("oa-question");
  await expect(question).toBeVisible();
  const radios = question.getByRole("radio");
  if ((await radios.count()) > 0) {
    await radios.first().check();
  } else {
    await question.getByLabel("Your answer").fill("13");
    await question.getByLabel("Your answer").blur();
  }
  await expect(page.getByText("1 of 10 answered")).toBeVisible();

  // the answer survives a reload because the server holds it
  await page.reload();
  await expect(page.getByText("1 of 10 answered")).toBeVisible();

  await page.getByRole("button", { name: "Hand in section" }).click();
  await page.getByRole("button", { name: "Yes, hand in" }).click();

  await expect(page.getByTestId("oa-report")).toBeVisible();
  await expect(page.getByTestId("oa-score")).toContainText("/ 10");
  await expect(page.getByTestId("oa-sections")).toContainText("Logical reasoning");
  await expect(page.getByTestId("oa-review")).toBeVisible();
  await expect(page.getByText("Not enough other attempts yet")).toBeVisible();
});

test("a company-style test shows the calculator and locks finished sections", async ({ page }) => {
  await page.goto("/tests");
  await page
    .getByTestId("oa-template")
    .filter({ hasText: "service-company hiring tests" })
    .getByRole("button", { name: "Start" })
    .click();
  await page.getByRole("button", { name: "Start section" }).click();
  await expect(page.getByTestId("calculator")).toBeVisible();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByRole("button", { name: "+", exact: true }).click();
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "=", exact: true }).click();
  await expect(page.getByTestId("calc-display")).toHaveText("12");

  await page.getByRole("button", { name: "Hand in section" }).click();
  await page.getByRole("button", { name: "Yes, hand in" }).click();
  await expect(page.getByTestId("oa-between")).toBeVisible();
  await expect(page.getByTestId("oa-section-row").first()).toContainText("Handed in");

  // leave, come back: it is still waiting for the next section, and the open test is offered
  await page.goto("/tests");
  await expect(page.getByTestId("oa-open")).toBeVisible();
  await page.getByRole("link", { name: "Resume" }).click();
  await expect(page.getByTestId("oa-between")).toContainText("Next section");

  await page.getByRole("button", { name: "End the test now" }).click();
  await expect(page.getByTestId("oa-report")).toBeVisible();
  await expect(page.getByTestId("oa-sections")).toContainText("Numerical ability");
});
