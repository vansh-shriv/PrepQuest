import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, logIn } from "./helpers";

// The hint and editorial editors, on a throwaway draft so shared dev content is never touched.

const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`;
const slug = `learn-${unique}`;
const title = `Learning Problem ${unique}`;

test("an editor writes hints and an editorial, and the checklist notices", async ({ page }) => {
  await logIn(page, "editor@prepquest.dev", DEMO_PASSWORD);
  await page.goto("/admin/problems/new");
  await expect(page.getByLabel("Arrays")).toBeVisible();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Arrays").check();
  await page.getByLabel("Function name").fill("total");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/admin\/problems\/[0-9a-f-]{36}$/);

  // nothing yet: both are warnings, not failures
  await page.getByRole("button", { name: "Run checks" }).click();
  const checks = page.getByRole("list", { name: "Validation checks" });
  await expect(checks).toContainText("Three hint tiers");
  await expect(checks).toContainText("0 of 3 written");
  await expect(checks).toContainText("Editorial with at least one approach");
  await expect(checks).toContainText("content:judge"); // reference/mutant checks run in CI

  // hints must be written in order
  await page.getByRole("tab", { name: "Hints" }).click();
  await page.getByLabel("Hint 2: Approach").fill("A running total is all you need here.");
  await page.getByRole("button", { name: "Save hints" }).click();
  await expect(page.getByText("Fill the hints in order")).toBeVisible();

  await page.getByLabel("Hint 1: Nudge").fill("What would you do with a pen and paper?");
  await page
    .getByLabel("Hint 3: Pseudocode")
    .fill("Start at zero, add each element, return the total.");
  await page.getByRole("button", { name: "Save hints" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();

  // editorial
  await page.getByRole("tab", { name: "Editorial" }).click();
  await page.getByLabel("Name").fill("Running total");
  await page.getByLabel("Intuition").fill("Add the elements one by one and keep the sum so far.");
  await page
    .getByLabel("Steps (one per line)")
    .fill("Start the sum at 0\nAdd each element\nReturn the sum");
  await page.getByLabel("Time complexity").fill("O(n)");
  await page.getByLabel("Space complexity").fill("O(1)");
  await page
    .getByLabel("Code: python")
    .fill("class Solution:\n    def total(self, nums):\n        return sum(nums)\n");
  await page.getByRole("button", { name: "Save editorial" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();

  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(checks).toContainText("3 of 3 written");
  const editorialCheck = checks
    .getByRole("listitem")
    .filter({ hasText: "Editorial with at least one approach" });
  await expect(editorialCheck).toContainText("pass");

  // it survives a reload
  await page.reload();
  await page.getByRole("tab", { name: "Hints" }).click();
  await expect(page.getByLabel("Hint 1: Nudge")).toHaveValue(
    "What would you do with a pen and paper?",
  );
  await page.getByRole("tab", { name: "Editorial" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Running total");
  await expect(page.getByLabel("Code: python")).toHaveValue(/return sum\(nums\)/);

  // removing the editorial works and the checklist notices again
  await page.getByRole("button", { name: "Delete editorial" }).click();
  await expect(page.getByRole("button", { name: "Delete editorial" })).toHaveCount(0);
  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(
    checks.getByRole("listitem").filter({ hasText: "Editorial with at least one approach" }),
  ).toContainText("warn");
});
