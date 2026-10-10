import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, saveDraft, signUp, uniqueUser } from "./helpers";

// The whole judging loop through the real stack: editor -> API -> BullMQ -> judge worker -> result
// stream -> database -> results panel. Uses the development process sandbox and the installed g++.

const user = uniqueUser("judge");
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
const WRONG = `class Solution:
    def twoSum(self, nums, target):
        return []
`;
const CRASH = `class Solution:
    def twoSum(self, nums, target):
        return [][3]
`;
const CPP_BROKEN = `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        return oops;
    }
};
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

async function openProblem(page: Page, language = "Python 3") {
  await page.goto("/problems/two-sum");
  await expect(page.getByRole("heading", { name: "Two Sum", level: 1 })).toBeVisible();
  await page.getByLabel("Language").selectOption({ label: language });
  await expect(page.getByTestId("draft-status")).toHaveText("All changes saved");
  await expect(page.getByTestId("code-editor")).toBeVisible();
}

const result = (page: Page) => page.getByTestId("result-done");

test("first: create the account", async ({ page }) => {
  await signUp(page, user);
});

test("Run checks the samples and shows every result", async ({ page, request }) => {
  await saveDraft(request, creds, "two-sum", "python", GOOD);
  await openProblem(page);

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(result(page)).toBeVisible();
  await expect(result(page).getByRole("status", { name: "Verdict: Accepted" })).toBeVisible();
  const rows = result(page).getByRole("list", { name: "Test results" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("Sample 1");
  await expect(rows.first()).toContainText("AC");
});

test("Submit judges every test and records the attempt", async ({ page, request }) => {
  await saveDraft(request, creds, "two-sum", "python", GOOD);
  await openProblem(page);

  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(result(page).getByRole("status", { name: "Verdict: Accepted" })).toBeVisible();
  await expect(result(page)).toContainText(/All \d+ tests passed/);
  await expect(result(page)).toContainText(/\d+ \/ \d+ passed/);

  // it shows up in this problem's history
  await page.getByRole("tab", { name: "Submissions" }).click();
  const history = page.getByRole("list", { name: "Your submissions" });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await expect(history).toContainText("AC");

  // and the problem is now marked solved in the list
  await page.goto("/problems?q=two+sum");
  await expect(
    page.getByTestId("problem-row").first().getByRole("img", { name: "Solved" }),
  ).toBeVisible();
});

test("a wrong answer names the failing test and shows sample details only", async ({
  page,
  request,
}) => {
  await saveDraft(request, creds, "two-sum", "python", WRONG);
  await openProblem(page);

  await page.getByRole("button", { name: "Submit", exact: true }).click();
  const banner = result(page).getByRole("status", { name: "Verdict: Wrong answer" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Failed on sample 1");
  // the failing sample is expanded with its input, expected output and what the program printed
  await expect(result(page).getByText("Expected", { exact: true })).toBeVisible();
  await expect(result(page).getByText("Your output", { exact: true })).toBeVisible();
});

test("a crash shows the error message, and a compile error shows the compiler output", async ({
  page,
  request,
}) => {
  await saveDraft(request, creds, "two-sum", "python", CRASH);
  await openProblem(page);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(result(page).getByRole("status", { name: "Verdict: Runtime error" })).toBeVisible();
  await expect(result(page)).toContainText("IndexError");

  await saveDraft(request, creds, "two-sum", "cpp", CPP_BROKEN);
  await openProblem(page, "C++17");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(result(page).getByRole("status", { name: "Verdict: Compile error" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(result(page).getByText("Compiler output")).toBeVisible();
  await expect(result(page)).toContainText("oops");
});

test("custom tests run alongside the samples and show the program's output", async ({
  page,
  request,
}) => {
  await saveDraft(request, creds, "two-sum", "python", GOOD);
  await openProblem(page);

  await page.getByRole("tab", { name: "Custom tests" }).click();
  await page.getByLabel("Label (optional)").fill("pair at the end");
  await page.getByLabel("Input", { exact: true }).fill("4\n1 2 3 4\n7\n");
  await page.getByRole("button", { name: "Save test" }).click();
  await expect(page.getByRole("list", { name: "Custom tests" })).toContainText("pair at the end");

  await page.getByRole("button", { name: "Run", exact: true }).click();
  const rows = result(page).getByRole("list", { name: "Test results" }).getByRole("listitem");
  await expect(rows).toHaveCount(4); // 3 samples + 1 custom
  await expect(rows.last()).toContainText("Custom 1");
  await rows.last().getByRole("button").click();
  await expect(rows.last()).toContainText("2 3"); // the indices of 3 and 4
});

test("notes autosave and survive a reload; bookmarks appear in the library", async ({ page }) => {
  await page.goto("/problems/two-sum");
  await expect(page.getByRole("heading", { name: "Two Sum", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bookmarked" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByLabel("Your notes").fill("Complement lookup in a hash map");
  await expect(page.getByTestId("note-status")).toHaveText("Saved");

  await page.reload();
  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(page.getByLabel("Your notes")).toHaveValue("Complement lookup in a hash map");
  await page.getByRole("tab", { name: "Description" }).click();
  await expect(page.getByRole("button", { name: "Bookmarked" })).toBeVisible();

  await page.goto("/notes");
  await expect(page.getByRole("list", { name: "Notes" })).toContainText("Two Sum");
  await page.getByRole("searchbox", { name: "Search your notes" }).fill("complement");
  await expect(page.getByRole("list", { name: "Notes" })).toContainText("hash map");
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await expect(page.getByRole("link", { name: "Two Sum" })).toBeVisible();
  await page.getByRole("button", { name: "Remove bookmark for Two Sum" }).click();
  await expect(page.getByTestId("no-bookmarks")).toBeVisible();
});

test("the submissions page filters attempts and opens one with code and a diff", async ({
  page,
}) => {
  await page.goto("/submissions");
  const list = page.getByRole("list", { name: "Submissions" });
  await expect(list.getByRole("listitem")).toHaveCount(3); // the AC, the WA and the compile error from earlier tests

  await page.getByLabel("Verdict").selectOption("AC");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await page.getByLabel("Verdict").selectOption("");
  await expect(list.getByRole("listitem")).toHaveCount(3);

  await list.getByRole("link", { name: "Two Sum" }).first().click();
  await expect(page).toHaveURL(/\/submissions\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("status", { name: /Verdict:/ })).toBeVisible();
  await expect(page.getByLabel("Submitted code")).toContainText("class Solution");

  await page.getByLabel("Compare with an earlier attempt").selectOption({ index: 1 });
  await expect(page.getByLabel("Changes between the two attempts")).toBeVisible();

  const note = page.getByLabel("What did you learn from this attempt?");
  await note.fill("forgot the empty case");
  await note.blur();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("What did you learn from this attempt?")).toHaveValue(
    "forgot the empty case",
  );
});
