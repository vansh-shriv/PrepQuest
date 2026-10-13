import { expect, test } from "@playwright/test";
import { logIn, saveDraft, signUp, uniqueUser } from "./helpers";
import { verifyEmail } from "./interview-helpers";
import { localInputValue } from "../src/features/contest/contest-view";

// Phase 12: a private contest through the real stack: create, join with the code, solve, standings.

const host = uniqueUser("ch");
const guest = uniqueUser("cg");
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

let contestSlug = "";
let inviteCode = "";

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, host.email);
});

test("first: sign up and verify the email", async ({ page }) => {
  await signUp(page, host);
  await verifyEmail(page, host.email);
});

test("the contest list starts empty and offers a form to create one", async ({ page }) => {
  await page.goto("/contests");
  await expect(page.getByRole("heading", { name: "Contests", level: 1 })).toBeVisible();
  await expect(page.getByTestId("contests-upcoming-empty")).toBeVisible();
  await page.getByRole("button", { name: "Create a contest" }).click();
  await expect(page.getByTestId("contest-form")).toBeVisible();
});

test("creating a private contest shows its clock, its problems and an invite code", async ({
  page,
}) => {
  await page.goto("/contests");
  await page.getByRole("button", { name: "Create a contest" }).click();
  await page.getByLabel("Title").fill("E2E friday round");
  await page.getByLabel("Starts").fill(localInputValue(new Date()));
  await page.getByLabel("Minutes", { exact: true }).fill("60");
  const picker = page.getByTestId("contest-problem-picker");
  await picker.getByLabel(/Two Sum/).check();
  await picker.getByLabel(/Valid Parentheses/).check();
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("heading", { name: /E2E friday round/, level: 1 })).toBeVisible();
  await expect(page.getByTestId("contest-clock")).toHaveText(/\d+:\d\d/);
  await expect(page.getByTestId("contest-problems")).toContainText("Two Sum");
  const note = await page.getByTestId("invite-code").innerText();
  inviteCode = /Invite code: (\w{8})/.exec(note)![1]!;
  contestSlug = new URL(page.url()).pathname.split("/").pop()!;
  expect(contestSlug).toMatch(/^e2e-friday-round-/);
});

test("a contest problem switches help off, and an accepted solution reaches the standings", async ({
  page,
  request,
}) => {
  await saveDraft(request, { email: host.email }, "two-sum", "python", GOOD);
  await page.goto(`/problems/two-sum?contest=${contestSlug}`);
  await expect(page.getByTestId("contest-bar")).toBeVisible();
  await page.getByRole("tab", { name: "Hints" }).click();
  await expect(page.getByText("Hints are off during a contest.")).toBeVisible();
  await page.getByLabel("Language").selectOption({ label: "Python 3" });
  await expect(page.getByTestId("draft-status")).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByTestId("result-done").getByRole("status", { name: "Verdict: Accepted" }),
  ).toBeVisible();

  await page.goto(`/contests/${contestSlug}`);
  await expect(page.getByTestId(`cell-${host.handle}-A`)).toContainText("+");
  await expect(page.getByTestId("contest-submissions")).toContainText("Accepted");
});

test("a friend joins with the invite code and shows up in the standings", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, guest);
  await page.goto(`/contests/${contestSlug}`);
  await expect(page.getByText("That contest does not exist.")).toBeVisible(); // no code, no entry
  await page.goto(`/contests/${contestSlug}?code=${inviteCode}`);
  await page.getByRole("button", { name: "Join now" }).click();
  await expect(page.getByTestId("standings")).toContainText(guest.handle);
  await expect(page.getByTestId("standings")).toContainText(host.handle);
  await expect(
    page.getByTestId("contest-problems").getByRole("link", { name: /Two Sum/ }),
  ).toBeVisible();
  await context.close();
});
