import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, logIn, signUp, uniqueUser } from "./helpers";
import { verifyEmail } from "./interview-helpers";

// Phase 14: code review (X3) and the complexity analyzer (X4) through the real stack: the API, the mock
// reviewer and the judge worker that checks the cleaner version and times the code on growing inputs.

const user = uniqueUser("rv");
test.describe.configure({ mode: "serial" });

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// correct on small inputs, and deliberately quadratic: two nested loops over the input (too slow for the big tests)
const NESTED = `class Solution:
    def twoSum(self, nums, target):
        for i in range(len(nums)):
            for j in range(i + 1, len(nums)):
                if nums[i] + nums[j] == target:
                    return [i, j]
        return []
`;

// correct and linear: the cleaner version of this one passes the judge
const HASHED = `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for j, x in enumerate(nums):
            if target - x in seen:
                return [seen[target - x], j]
            seen[x] = j
        return []
`;

let submissionId = "";
let goodId = "";

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

/** Submits through the API (typing multi-line code into Monaco fights its auto-indent) and waits for the verdict. */
async function submitCode(page: Page, code: string, verdict: "AC" | "TLE") {
  const login = await page.request.post(`${API}/v1/auth/login`, {
    data: { email: user.email, password: PASSWORD },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };
  const created = await page.request.post(`${API}/v1/submissions`, {
    headers,
    data: { problemSlug: "two-sum", language: "python", code, kind: "submit" },
  });
  expect(created.status()).toBe(202);
  const { submissionId: id } = (await created.json()) as { submissionId: string };
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`${API}/v1/submissions/${id}`, { headers })).json()) as {
            verdict: string;
          }
        ).verdict,
      { timeout: 60_000 },
    )
    .toBe(verdict);
  return id;
}

test("first: sign up and verify the email", async ({ page }) => {
  await signUp(page, user);
  await verifyEmail(page, user.email);
});

test("a review points at lines of the real code", async ({ page }) => {
  submissionId = await submitCode(page, NESTED, "TLE");
  await page.goto(`/submissions/${submissionId}`);
  const panel = page.getByTestId("review-panel");
  await panel.getByLabel("How strict?").selectOption("strict");
  await panel.getByRole("button", { name: "Review my code" }).click();
  await expect(panel.getByTestId("review-result")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("review-summary")).not.toBeEmpty();
  await expect(panel.getByRole("list", { name: "Ratings" }).getByRole("listitem")).toHaveCount(6);

  // the nested loop is on line 4 and is flagged as important
  const comment = panel
    .getByTestId("review-comment")
    .filter({ hasText: "nested inside another loop" });
  await expect(comment).toBeVisible();
  await expect(comment).toContainText("Important");
  const region = panel.getByRole("region", { name: "Your code with review comments" });
  await expect(region).toContainText("for j in range(i + 1, len(nums)):");
});

test("a rewrite that fails the judge is never shown", async ({ page }) => {
  await page.goto(`/submissions/${submissionId}`);
  const panel = page.getByTestId("review-panel");
  // the review made in the previous test is shown again, without a new model call
  await expect(panel.getByTestId("review-result")).toBeVisible();
  // the reviewer's rewrite of slow code is just as slow: the judge rejects it and it stays hidden
  await expect(panel.getByTestId("refactor-rejected")).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByTestId("refactor")).toHaveCount(0);
});

test("the cleaner version appears once the judge accepted it", async ({ page }) => {
  goodId = await submitCode(page, HASHED, "AC");
  await page.goto(`/submissions/${goodId}`);
  const panel = page.getByTestId("review-panel");
  await panel.getByLabel("How strict?").selectOption("strict");
  await panel.getByRole("button", { name: "Review my code" }).click();
  await expect(panel.getByTestId("review-result")).toBeVisible({ timeout: 30_000 });
  const refactor = panel.getByTestId("refactor");
  await expect(refactor).toBeVisible({ timeout: 60_000 });
  await expect(refactor).toContainText("Passes every test");
  await expect(refactor.getByRole("button", { name: "Open in editor" })).toBeVisible();
});

test("a gentler review leaves the nits out", async ({ page }) => {
  await page.goto(`/submissions/${submissionId}`);
  const panel = page.getByTestId("review-panel");
  await panel.getByLabel("How strict?").selectOption("gentle");
  await expect(panel.getByRole("button", { name: "Review my code" })).toBeVisible();
  await panel.getByRole("button", { name: "Review my code" }).click();
  await expect(panel.getByTestId("review-result")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("review-comment").filter({ hasText: "Nit" })).toHaveCount(0);
  // the choice is remembered for next time
  await page.reload();
  await expect(page.getByTestId("review-panel").getByLabel("How strict?")).toHaveValue("gentle");
});

test("the complexity check compares a claim with what the judge measured", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto(`/submissions/${submissionId}`);
  const panel = page.getByTestId("complexity-panel");
  await panel.getByLabel("My claim").selectOption("O(n log n)");
  await panel.getByTestId("cx-start").click();
  await expect(panel.getByTestId("cx-result")).toBeVisible({ timeout: 200_000 });

  await expect(panel.getByTestId("cx-message")).toContainText("You claimed O(n log n)");
  await expect(panel.getByTestId("cx-message")).toContainText("Measured growth looks like O(n²)");
  await expect(panel).toContainText("Slower than claimed");
  await expect(panel.getByTestId("growth-chart")).toBeVisible();
  // the same numbers are in a table, and the run is called an estimate
  expect(await panel.getByTestId("cx-table").getByRole("row").count()).toBeGreaterThan(4);
  await expect(panel.getByTestId("cx-caveat")).toContainText("not a proof");
  // two loops inside each other: the analyzer says where
  await expect(panel).toContainText("loops nest 2 deep");
});

test("a problem without scaling inputs says so", async ({ page, request }) => {
  const login = await request.post(`${API}/v1/auth/login`, {
    data: { email: user.email, password: PASSWORD },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };
  const created = await request.post(`${API}/v1/submissions`, {
    headers,
    data: {
      problemSlug: "climbing-stairs",
      language: "python",
      code: "class Solution:\n    def climbStairs(self, n):\n        return 0\n",
      kind: "run",
    },
  });
  const { submissionId: id } = (await created.json()) as { submissionId: string };
  await expect
    .poll(
      async () =>
        (
          (await (await request.get(`${API}/v1/submissions/${id}`, { headers })).json()) as {
            verdict: string;
          }
        ).verdict,
      { timeout: 60_000 },
    )
    .not.toMatch(/QUEUED|COMPILING|RUNNING/);
  await page.goto(`/submissions/${id}`);
  await expect(page.getByTestId("complexity-panel")).toContainText("not set up for this problem");
});
