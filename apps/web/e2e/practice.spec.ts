import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, saveDraft, signUp, uniqueUser } from "./helpers";

// Hints, editorial, XP, streaks, badges and the dashboard, through the real stack.

const user = uniqueUser("practice");
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
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

async function openProblem(page: Page) {
  await page.goto("/problems/two-sum");
  await expect(page.getByRole("heading", { name: "Two Sum", level: 1 })).toBeVisible();
  await page.getByLabel("Language").selectOption({ label: "Python 3" });
  await expect(page.getByTestId("draft-status")).toHaveText("All changes saved");
}

test("first: create the account", async ({ page }) => {
  await signUp(page, user);
});

test("a new player sees an empty, friendly dashboard with a first quest to start", async ({
  page,
}) => {
  const dash = page.getByTestId("dashboard");
  await expect(dash).toBeVisible();
  await expect(page.getByTestId("level")).toHaveText("LV 1");
  await expect(page.getByTestId("xp")).toContainText("0 XP");
  await expect(page.getByTestId("streak")).toHaveText("0 DAYS");
  await expect(page.getByText("NOTHING HERE YET. RUN YOUR FIRST QUEST!")).toBeVisible();
  const recommended = page
    .getByRole("list", { name: "Recommended problems" })
    .getByRole("listitem");
  await expect(recommended).toHaveCount(3);
  await expect(recommended.first().getByRole("link", { name: "Start" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Badges" }).getByRole("listitem")).toHaveCount(6);
  await expect(
    page.getByRole("img", { name: /Activity over the last 26 weeks: 0 problems/ }),
  ).toBeVisible();
});

test("hints unlock in order behind a wait, and the countdown is shown", async ({ page }) => {
  await openProblem(page);
  await page.getByRole("tab", { name: "Hints" }).click();
  const hint1 = page.getByTestId("hint-1");
  await expect(hint1.getByTestId("hint-countdown")).toContainText("Available in");
  await expect(hint1.getByRole("button", { name: "Show hint 1" })).toBeDisabled();
  await expect(page.getByTestId("hint-2")).toContainText("View hint 1 first.");
  await expect(page.getByTestId("hint-3").getByRole("button")).toBeDisabled();
  // the text of a locked hint is not in the page at all
  await expect(page.getByText(/complete the pair/i)).toHaveCount(0);
});

test("relaxed mode: the first hint opens at once, the next waits a minute, and viewing is remembered", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Hints").selectOption("relaxed");
  await expect(page.getByLabel("Hints")).toHaveValue("relaxed");
  await page.reload();
  await expect(page.getByLabel("Hints")).toHaveValue("relaxed");

  await openProblem(page);
  await page.getByRole("tab", { name: "Hints" }).click();
  await page.getByRole("button", { name: "Show hint 1" }).click();
  await expect(page.getByTestId("hint-1")).toContainText("complete the pair");
  await expect(page.getByTestId("hint-1")).toContainText("viewed");
  await expect(page.getByTestId("hint-2").getByTestId("hint-countdown")).toContainText(
    "Available in 0:",
  );
  await expect(page.getByTestId("hint-2").getByRole("button")).toBeDisabled();

  await page.reload();
  await page.getByRole("tab", { name: "Hints" }).click();
  await expect(page.getByTestId("hint-1")).toContainText("complete the pair");
});

test("the editorial is locked until earned, can be opened in settings, and shows approaches with code", async ({
  page,
}) => {
  await openProblem(page);
  await page.getByRole("tab", { name: "Editorial" }).click();
  const locked = page.getByTestId("editorial-locked");
  await expect(locked).toContainText("THE EDITORIAL IS LOCKED");
  await expect(locked).toContainText("Solve the problem");
  await expect(locked.getByRole("button", { name: "I give up" })).toBeDisabled();
  await expect(page.getByText("Hash map of seen values")).toHaveCount(0);

  await page.goto("/settings");
  // the box follows the saved setting, so it changes a moment after the click
  await page.getByLabel("Open editorials").click();
  await expect(page.getByLabel("Open editorials")).toBeChecked();
  await page.reload();
  await expect(page.getByLabel("Open editorials")).toBeChecked();

  await openProblem(page);
  await page.getByRole("tab", { name: "Editorial" }).click();
  const open = page.getByTestId("editorial-open");
  await expect(open.getByRole("region", { name: /Approach 1: Check every pair/ })).toBeVisible();
  const best = open.getByRole("region", { name: /Approach 2: Hash map of seen values/ });
  await expect(best).toContainText("O(n)");
  await expect(best.getByRole("tab", { name: "C++" })).toBeVisible();
  await best.getByRole("tab", { name: "Java" }).click();
  await expect(best.getByRole("tabpanel")).toContainText("class Solution");
  await expect(open.getByRole("region", { name: "Interview talk track" })).toBeVisible();
  await expect(open.getByRole("link", { name: "Contains Duplicate" })).toBeVisible();
  // not solved yet, so no rating
  await expect(page.getByRole("group", { name: "How did this problem feel?" })).toHaveCount(0);

  await page.goto("/settings");
  await page.getByLabel("Open editorials").click();
  await expect(page.getByLabel("Open editorials")).not.toBeChecked();
});

test("solving earns XP, a badge and a streak, and the top bar updates", async ({
  page,
  request,
}) => {
  await saveDraft(request, { email: user.email }, "two-sum", "python", GOOD);
  await openProblem(page);
  await page.getByRole("button", { name: "Submit", exact: true }).click();

  const rewards = page.getByTestId("rewards");
  await expect(rewards).toBeVisible();
  // easy problem, first try, one hint viewed in the earlier test: 10 * (1 + 0.2 - 0.1) = 11
  await expect(page.getByTestId("xp-gained")).toHaveText(/\+11 XP/);
  await expect(rewards).toContainText("1-day streak");
  await expect(page.getByTestId("badge-earned")).toContainText("First Blood");
  await expect(page.getByLabel("11 XP")).toBeVisible(); // the coin counter in the top bar

  // a self-rating after the solve
  const rating = rewards.getByRole("group", { name: "How did this problem feel?" });
  await rating.getByRole("button", { name: "Easy" }).click();
  await expect(rating.getByRole("button", { name: "Easy" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // solving unlocks the editorial and the rating shows there too
  await page.getByRole("tab", { name: "Editorial" }).click();
  await expect(page.getByTestId("editorial-open")).toBeVisible();
  await expect(
    page.getByTestId("editorial-open").getByRole("group", { name: "How did this problem feel?" }),
  ).toBeVisible();
});

test("the dashboard shows the progress, and the range filter keeps totals", async ({ page }) => {
  await expect(page.getByTestId("level")).toHaveText("LV 1");
  await expect(page.getByTestId("xp")).toContainText("11 XP");
  await expect(page.getByTestId("streak")).toHaveText("1 DAY");
  await expect(page.getByText("NOTHING HERE YET. RUN YOUR FIRST QUEST!")).toHaveCount(0);

  const solved = page.getByRole("img", { name: "Easy 1, medium 0, hard 0" });
  await expect(solved).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Activity over the last 26 weeks: 1 problems solved on 1 days/ }),
  ).toBeVisible();
  await expect(page.getByText("100%").first()).toBeVisible(); // accepted and first try

  const skills = page.getByRole("list", { name: "Topic skills" }).getByTestId("skill");
  await expect(skills.filter({ hasText: "Arrays" })).toContainText("1/1 solved");
  await expect(page.getByRole("list", { name: "Recommended problems" })).not.toContainText(
    "Two Sum",
  );

  const badges = page.getByRole("list", { name: "Badges" }).getByRole("listitem");
  await expect(badges.filter({ hasText: "First Blood" })).toHaveAttribute("data-earned", "true");
  await expect(badges.filter({ hasText: "Ten Down" })).toHaveAttribute("data-earned", "false");

  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("img", { name: "Easy 1, medium 0, hard 0" })).toBeVisible();
  await page.getByRole("button", { name: "All time" }).click();
  await expect(
    page.getByRole("list", { name: "Recent submissions" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Sheet progress" })).toContainText("Foundations 20");
});
