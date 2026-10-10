import { expect, test } from "@playwright/test";
import {
  editorText,
  logIn,
  newSession,
  PASSWORD,
  signUp,
  typeInEditor,
  uniqueUser,
} from "./helpers";

const user = uniqueUser("quest");
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  // each test gets a fresh page; the account is created once and signed in again
  if (test.info().title.startsWith("first")) return;
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("first: create the account used by these specs", async ({ page }) => {
  await signUp(page, user);
});

test("the problem bank lists every published quest with sheets and no raw data", async ({
  page,
}) => {
  await page.goto("/problems");
  await expect(page.getByTestId("result-count")).toHaveText("20 quests");
  await expect(page.getByTestId("problem-row")).toHaveCount(20);
  await expect(page.getByRole("button", { name: /Foundations 20/ })).toBeVisible();
  // curriculum order: easy problems first
  await expect(page.getByTestId("problem-row").first()).toContainText("easy");
  await expect(page.getByText("Two Sum").first()).toBeVisible();
});

test("filters narrow the list, live in the URL, and survive a reload", async ({ page }) => {
  await page.goto("/problems");
  await expect(page.getByTestId("result-count")).toHaveText("20 quests");

  // the checkbox is driven by the URL, so its state changes a moment after the click
  await page.getByLabel("Hard").click();
  await expect(page.getByLabel("Hard")).toBeChecked();
  await expect(page.getByTestId("result-count")).toHaveText("2 quests");
  await expect(page).toHaveURL(/difficulty=hard/);
  await expect(page.getByTestId("problem-row")).toHaveCount(2);

  await page.reload();
  await expect(page.getByTestId("result-count")).toHaveText("2 quests");
  await expect(page.getByLabel("Hard")).toBeChecked();

  await page
    .getByRole("button", { name: /Clear filters/ })
    .first()
    .click();
  await expect(page.getByTestId("result-count")).toHaveText("20 quests");

  await page.getByLabel(/^dynamic programming \(/).click();
  await expect(page.getByTestId("result-count")).toHaveText("4 quests");
  await expect(page).toHaveURL(/topic=dynamic-programming/);
});

test("search tolerates typos and shows an empty state", async ({ page }) => {
  await page.goto("/problems");
  await page.getByRole("searchbox", { name: "Search problems" }).fill("edt distnce");
  await expect(page).toHaveURL(/q=edt\+distnce|q=edt%20distnce/);
  await expect(page.getByTestId("problem-row").first()).toContainText("Edit Distance");

  await page.getByRole("searchbox", { name: "Search problems" }).fill("zzzzqqqq");
  await expect(page.getByText("NOTHING HERE YET. TRY FEWER FILTERS!")).toBeVisible();
});

test("a curated sheet filters the list in its own order and shows progress", async ({ page }) => {
  await page.goto("/problems");
  await page.getByRole("button", { name: /Foundations 20/ }).click();
  await expect(page).toHaveURL(/sheet=foundations-20/);
  await expect(page.getByRole("progressbar", { name: /Foundations 20 progress/ })).toBeVisible();
  await expect(page.getByText("0 of 20 solved")).toBeVisible();
  await expect(page.getByTestId("problem-row").first()).toContainText("Two Sum");
});

test("opening a problem shows the statement, examples and a working editor", async ({ page }) => {
  await page.goto("/problems");
  await page.getByRole("link", { name: "Play Two Sum" }).click();
  await expect(page).toHaveURL(/\/problems\/two-sum$/);

  await expect(page.getByRole("heading", { name: "Two Sum", level: 1 })).toBeVisible();
  await expect(page.getByText("Exactly one pair of positions has that sum")).toBeVisible();
  // examples also appear in the Samples tab under the editor, so look inside the problem pane
  const pane = page.getByRole("region", { name: "Problem" });
  await expect(pane.getByText("nums = [2, 7, 11, 15]")).toBeVisible();
  await expect(page.getByText("2 <= nums.length <= 20000")).toBeVisible();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
});

test("code autosaves, survives a reload and keeps a separate draft per language", async ({
  page,
}) => {
  await page.goto("/problems/two-sum");
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Language").selectOption("python");
  await expect(page.getByTestId("draft-status")).toHaveText("All changes saved");

  await typeInEditor(page, "# my python attempt");
  await expect(page.getByTestId("draft-status")).toHaveText("Unsaved changes");
  await expect(page.getByTestId("draft-status")).toHaveText("All changes saved", {
    timeout: 15_000,
  });

  await page.reload();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Language")).toHaveValue("python"); // remembered
  await expect.poll(() => editorText(page)).toContain("my python attempt");

  await page.getByLabel("Language").selectOption("java");
  await expect.poll(() => editorText(page)).toContain("class Solution");
  await expect.poll(() => editorText(page)).not.toContain("my python attempt");
  await page.getByLabel("Language").selectOption("python");
  await expect.poll(() => editorText(page)).toContain("my python attempt");
});

test("reset returns to the starter code and History restores earlier work", async ({ page }) => {
  await page.goto("/problems/two-sum");
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Language").selectOption("python");
  await expect.poll(() => editorText(page)).toContain("my python attempt");

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Reset" }).click();
  await expect.poll(() => editorText(page)).toContain("class Solution");
  await expect(page.getByTestId("draft-status")).toHaveText("All changes saved", {
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "History" }).click();
  const dialog = page.getByRole("dialog", { name: "Earlier versions" });
  await expect(dialog.getByRole("button", { name: "Restore" }).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Restore" }).first().click();
  await expect.poll(() => editorText(page)).toContain("my python attempt");
});

test("custom tests can be saved and deleted", async ({ page }) => {
  await page.goto("/problems/two-sum");
  await page.getByRole("tab", { name: "Custom tests" }).click();
  await expect(page.getByText("No custom tests yet.")).toBeVisible();
  await page.getByLabel("Label (optional)").fill("tiny case");
  await page.getByLabel("Input", { exact: true }).fill("2\n1 2\n3");
  await page.getByRole("button", { name: "Save test" }).click();
  await expect(page.getByRole("list", { name: "Custom tests" })).toContainText("tiny case");

  await page.reload();
  await page.getByRole("tab", { name: "Custom tests" }).click();
  await expect(page.getByRole("list", { name: "Custom tests" })).toContainText("tiny case");
  await page.getByRole("button", { name: "Delete tiny case" }).click();
  await expect(page.getByText("No custom tests yet.")).toBeVisible();
});

test("the divider resizes with the keyboard and the position is remembered", async ({ page }) => {
  await page.goto("/problems/two-sum");
  const divider = page.getByRole("separator", { name: "Resize panels" });
  await expect(divider).toBeVisible();
  const before = Number(await divider.getAttribute("aria-valuenow"));
  await divider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  expect(Number(await divider.getAttribute("aria-valuenow"))).toBe(before + 10);
  await page.reload();
  await expect(page.getByRole("separator", { name: "Resize panels" })).toHaveAttribute(
    "aria-valuenow",
    String(before + 10),
  );
});

test("an unknown problem gets a friendly 404", async ({ page }) => {
  await page.goto("/problems/no-such-problem");
  await expect(page.getByText("THIS PAGE WENT EXTINCT")).toBeVisible();
});

test("on a phone the problem and the code are separate views", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await logIn(page, user.email); // waits for the dashboard, so the session cookie exists
  await page.goto("/problems/two-sum");
  await expect(page.getByRole("heading", { name: "Two Sum", level: 1 })).toBeVisible();
  await expect(page.getByRole("separator", { name: "Resize panels" })).toBeHidden();
  await expect(page.locator(".monaco-editor")).toHaveCount(0);

  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Two Sum", level: 1 })).toBeHidden();
  await context.close();
});

test("a newer draft saved on another device is offered instead of being overwritten", async ({
  page,
  browser,
}) => {
  await page.goto("/problems/valid-parentheses");
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Language").selectOption("python");
  await typeInEditor(page, "# from device A");
  await expect(page.getByTestId("draft-status")).toHaveText("All changes saved", {
    timeout: 15_000,
  });

  // device B picks up A's draft and saves a newer version
  const b = await newSession(browser, user.email);
  await b.page.goto("/problems/valid-parentheses");
  await expect(b.page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  // a fresh device starts in the account's default language, so switch to the one A used
  await b.page.getByLabel("Language").selectOption("python");
  await expect.poll(() => editorText(b.page)).toContain("from device A");
  await typeInEditor(b.page, "# from device B");
  await expect(b.page.getByTestId("draft-status")).toHaveText("All changes saved", {
    timeout: 15_000,
  });
  await b.context.close();

  // device A (still on the old version) edits: the save is refused and the choice is offered
  await typeInEditor(page, "# A edits again");
  const banner = page.getByRole("alert").filter({ hasText: "Newer draft found" });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await banner.getByRole("button", { name: "Load the newer one" }).click();
  await expect.poll(() => editorText(page)).toContain("from device B");
  await expect(page.getByTestId("draft-status")).toHaveText("All changes saved");
});
