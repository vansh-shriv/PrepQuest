import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { logIn, newSession, signUp, uniqueUser } from "./helpers";
import { verifyEmail } from "./interview-helpers";

// Phase 18: peer mocks through the real stack: free times, matching, an invite link, the session page,
// the calendar file, and the safety actions. The clock-driven parts (opening the room, the swap at half
// time, no-shows) are covered by the API tests: a browser cannot move the server's clock.

const ada = uniqueUser("pa");
const bob = uniqueUser("pb");
test.describe.configure({ mode: "serial" });

// a day far from the windows other runs left in the shared database, so only this spec's people match
const day = new Date(Date.now() + (4 + Math.floor(Math.random() * 18)) * 86_400_000);
const stamp = (hour: number, minute = 0) => {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const hour = 8 + Math.floor(Math.random() * 6); // 08:00 to 13:00

let sessionUrl = "";

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, ada.email);
});

async function addWindow(page: Page, from: string, to: string) {
  await page.goto("/peer");
  const form = page.getByTestId("peer-availability");
  await form.getByLabel("From", { exact: true }).fill(from);
  await form.getByLabel("Until", { exact: true }).fill(to);
  await form.getByRole("button", { name: "Add this window" }).click();
  await expect(page.getByTestId("peer-windows").getByRole("listitem")).not.toHaveCount(0);
}

test("first: two learners sign up and verify their emails", async ({ page, browser }) => {
  await signUp(page, ada);
  await verifyEmail(page, ada.email);
  const context = await browser.newContext();
  const other = await context.newPage();
  await signUp(other, bob);
  await verifyEmail(other, bob.email);
  await context.close();
});

test("a window is added and a search with nobody else finds nobody", async ({ page }) => {
  await page.goto("/peer");
  await expect(page.getByTestId("peer-no-sessions")).toBeVisible();
  await expect(page.getByTestId("peer-reputation")).toContainText("not enough sessions");
  await addWindow(page, stamp(hour), stamp(hour + 3));
  await page.getByRole("button", { name: "Find a partner" }).click();
  await expect(page.getByTestId("peer-no-match")).toBeVisible();
  // the window is still there
  await expect(page.getByTestId("peer-windows").getByRole("listitem")).toHaveCount(1);
});

test("a second learner with an overlapping window is matched and the session is booked", async ({
  browser,
}) => {
  const { context, page } = await newSession(browser, bob.email);
  await addWindow(page, stamp(hour + 1), stamp(hour + 4));
  await page.getByRole("button", { name: "Find a partner" }).click();
  await expect(page).toHaveURL(/\/peer\/[0-9a-f-]{36}$/);
  sessionUrl = page.url();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(ada.handle);
  await expect(page.getByTestId("peer-state")).toHaveText("Booked");
  await expect(page.getByTestId("partner-reputation")).toContainText("not enough sessions");
  // the question and the interviewer's panel stay shut until the session is running
  await expect(page.getByTestId("peer-question")).toHaveCount(0);
  await expect(page.getByTestId("peer-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open the room" })).toHaveCount(0);

  // the calendar file
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to my calendar" }).click();
  const file = await download;
  const ics = await readFile((await file.path())!, "utf8");
  expect(ics).toContain("BEGIN:VEVENT");
  expect(ics).toContain(`SUMMARY:PrepQuest peer mock with ${ada.handle}`);
  await context.close();
});

test("the partner sees the same session, and consent needs both people", async ({ page }) => {
  await page.goto("/peer");
  const row = page.getByTestId("peer-session");
  await expect(row).toContainText(bob.handle);
  await row.getByRole("link").click();
  await expect(page).toHaveURL(sessionUrl);
  const consent = page.getByTestId("peer-consent");
  await expect(consent).toContainText("Without both of you agreeing, nothing is analysed");
  await consent.getByRole("checkbox").click();
  await expect(consent.getByRole("checkbox")).toBeChecked();
  // one person's yes is not enough
  await expect(consent).toContainText("Without both of you agreeing, nothing is analysed");
});

test("an invite link books a session for a friend, once", async ({ page, browser }) => {
  await page.goto("/peer");
  await page.getByLabel("Start", { exact: true }).fill(stamp(hour + 6));
  await page.getByLabel("Topic", { exact: true }).selectOption("cs");
  await page.getByRole("button", { name: "Make an invite link" }).click();
  const link = (await page.getByTestId("peer-invite-link").locator("code").textContent())!;
  expect(link).toMatch(/\/peer\/join\/[A-Za-z0-9_-]{20,}$/);

  const { context, page: friend } = await newSession(browser, bob.email);
  await friend.goto(link);
  await expect(friend.getByTestId("peer-join")).toContainText(`${ada.handle} invited you`);
  await friend.getByRole("button", { name: "Accept and book it" }).click();
  await expect(friend).toHaveURL(/\/peer\/[0-9a-f-]{36}$/);
  await expect(friend.getByRole("heading", { level: 1 })).toContainText("CS fundamentals");

  // a used link is gone
  await friend.goto(link);
  await expect(friend.getByTestId("peer-invite-gone")).toBeVisible();
  await context.close();

  await page.reload();
  await expect(page.getByTestId("peer-invites")).toContainText("accepted");
});

test("a report is sent, and blocking cancels what was booked", async ({ page }) => {
  await page.goto(sessionUrl);
  const safety = page.getByTestId("peer-safety");
  await safety.getByRole("button", { name: `Report ${bob.handle}` }).click();
  await safety.getByLabel("Reason").selectOption("harassment");
  await safety.getByLabel("What happened?").fill("Rude comments during the call.");
  await safety.getByRole("button", { name: "Send the report" }).click();
  await expect(page.getByTestId("peer-report-sent")).toBeVisible();

  await safety.getByRole("button", { name: `Block ${bob.handle}` }).click();
  await expect(page.getByTestId("peer-state")).toHaveText("Cancelled");
  await page.goto("/peer");
  await expect(page.getByText("People you blocked")).toBeVisible();
  await page.getByRole("button", { name: /Unblock/ }).click();
  await expect(page.getByText("People you blocked")).toHaveCount(0);
});
