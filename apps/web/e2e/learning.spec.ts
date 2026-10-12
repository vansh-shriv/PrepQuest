import { expect, test } from "@playwright/test";
import { logIn, saveDraft, signUp, uniqueUser } from "./helpers";

// Phase 10: spaced repetition, quizzes, roadmaps and company tracks through the real stack.

const user = uniqueUser("lr");
const creds = { email: user.email };
test.describe.configure({ mode: "serial" });

const GOOD = `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for j, x in enumerate(nums):
            if target - x in seen:
                return [seen[target - x], j]
            seen[x] = j
        return []
`;

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

test("first: sign up", async ({ page }) => {
  await signUp(page, user);
});

test("reviews start empty and explain how problems join the rotation", async ({ page }) => {
  await page.goto("/reviews");
  await expect(page.getByTestId("review-summary")).toHaveText("Nothing is due today.");
  await expect(page.getByTestId("review-empty")).toContainText("Solve a problem");
  await expect(page.getByTestId("review-stats")).toContainText("0 problems in rotation");
});

test("solving a problem puts it in the review rotation, due tomorrow", async ({
  page,
  request,
}) => {
  await saveDraft(request, creds, "two-sum", "python", GOOD);
  await page.goto("/problems/two-sum");
  await expect(page.getByRole("heading", { name: "Two Sum", level: 1 })).toBeVisible();
  await page.getByLabel("Language").selectOption({ label: "Python 3" });
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await expect(page.getByTestId("draft-status")).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByTestId("result-done").getByRole("status", { name: "Verdict: Accepted" }),
  ).toBeVisible();

  await page.goto("/reviews");
  await expect(page.getByTestId("review-stats")).toContainText("1 problem in rotation");
  await expect(page.getByTestId("review-summary")).toHaveText("Nothing is due today.");
  await expect(
    page.getByRole("list", { name: "Reviews due in the next seven days" }),
  ).toBeVisible();

  // the dashboard says so too
  await page.goto("/dashboard");
  await expect(page.getByTestId("reviews-line")).toContainText("No reviews due");
});

test("a quiz in practice mode explains each answer and shows a result", async ({ page }) => {
  await page.goto("/quizzes");
  await page.getByLabel("Subject").selectOption("os");
  await page.getByLabel("Questions").fill("3");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("quiz-question")).toBeVisible();

  for (let i = 0; i < 3; i++) {
    const q = page.getByTestId("quiz-question");
    const radio = q.getByRole("radio").first();
    const check = q.getByRole("checkbox").first();
    const text = q.getByRole("textbox").first();
    if (await radio.count()) await radio.check();
    else if (await check.count()) await check.check({ force: true });
    else await text.fill("not sure");
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByTestId("quiz-feedback")).toBeVisible();
    await page.getByRole("button", { name: i === 2 ? "See my results" : "Next question" }).click();
  }
  const result = page.getByTestId("quiz-result");
  await expect(result).toBeVisible();
  await expect(result.getByTestId("quiz-score")).toContainText("%");
  await expect(page.getByTestId("quiz-review-item")).toHaveCount(3);

  // the mistakes feed a weak-area quiz
  await page.goto("/quizzes");
  await expect(page.getByTestId("quiz-recent")).toContainText("Practice");
});

test("a timed test shows the clock and scores unanswered questions as missed", async ({ page }) => {
  await page.goto("/quizzes");
  await page.getByLabel("Subject").selectOption("cn");
  await page.getByLabel("Mode").selectOption("timed");
  await page.getByLabel("Questions").fill("3");
  await page.getByLabel("Minutes for the whole test").fill("5");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("quiz-clock")).toContainText(/[1-5]:\d\d/);
  // no answer is shown while the test runs
  await expect(page.getByTestId("quiz-feedback")).toHaveCount(0);
  await page.getByRole("button", { name: "Finish test" }).click();
  const result = page.getByTestId("quiz-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText("0 of 3 correct");
  await expect(page.getByTestId("quiz-review-item").first()).toContainText("Not answered");
});

test("the roadmap map locks later topics until earlier ones are cleared", async ({ page }) => {
  await page.goto("/roadmaps");
  await expect(page.getByTestId("roadmap-card")).toHaveCount(2);
  await page.getByRole("link", { name: "Open the map" }).first().click();
  await expect(page.getByTestId("roadmap-map")).toBeVisible();

  // pick the DSA map by name so the test does not depend on card order
  await page.goto("/roadmaps/sde-dsa-core");
  const nodes = page.getByTestId("roadmap-node");
  await expect(nodes.first()).toBeVisible();
  await expect(page.locator('[data-node="arrays"]')).toHaveAttribute(
    "data-state",
    /open|cleared|mastered/,
  );
  await expect(page.locator('[data-node="graphs"]')).toHaveAttribute("data-state", "locked");

  await page.locator('[data-node="graphs"]').click();
  await expect(page.getByTestId("node-blocked")).toContainText("Stacks");
});

test("company tracks show the process and compare two of them", async ({ page }) => {
  await page.goto("/tracks");
  await expect(page.getByTestId("track-card").first()).toBeVisible();
  await page.goto("/tracks/product-high-bar");
  await expect(page.getByTestId("track")).toBeVisible();
  await expect(page.getByTestId("track-process")).toContainText("Online assessment");
  await expect(page.getByTestId("track-readiness")).toHaveText("Not enough data");
  await expect(page.getByTestId("track-problems").getByRole("listitem").first()).toBeVisible();

  await page.goto("/tracks");
  await page.getByLabel("Preparing for").selectOption("product-high-bar");
  await page.getByLabel("Also applying to").selectOption("it-services");
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByTestId("compare-result")).toContainText("is already covered by");
});

test("starting a track builds a plan around the company", async ({ page }) => {
  await page.goto("/tracks/it-services");
  await page.getByRole("button", { name: "Start this track" }).click();
  await expect(page.getByTestId("track-started")).toContainText(
    "study plan now aims at this company",
  );
  await page.goto("/plan");
  await expect(page.getByTestId("plan")).toBeVisible();
});
