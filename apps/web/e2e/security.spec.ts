import { expect, test, type Page } from "@playwright/test";
import { base32Decode, hotp, stepAt } from "../../api/src/lib/totp";

const MAILPIT = "http://localhost:8025/api/v1";

async function linkFromMail(page: Page, to: string, needle: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = await page.request.get(
      `${MAILPIT}/search?query=${encodeURIComponent(`to:${to}`)}`,
    );
    const messages = ((await list.json()) as { messages?: Array<{ ID: string }> }).messages ?? [];
    for (const m of messages) {
      const msg = await page.request.get(`${MAILPIT}/message/${m.ID}`);
      const text = ((await msg.json()) as { Text: string }).Text;
      const match = text.match(new RegExp(`https?://\\S*${needle}\\S*`));
      if (match) return match[0];
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`no email to ${to} with a ${needle} link`);
}

const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const password = "e2e-an-unusual-passphrase-77";

function newUser(tag: string) {
  return {
    name: `E2E ${tag}`,
    handle: `e2e_${tag}_${unique}`.slice(0, 20),
    email: `e2e-${tag}-${unique}@example.com`,
  };
}

async function signUp(page: Page, user: ReturnType<typeof newUser>) {
  await page.goto("/signup");
  await page.getByLabel("Display name").fill(user.name);
  await page.getByLabel("Handle").fill(user.handle);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Start quest" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Menu" }).first().click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe.configure({ mode: "serial" });

test.describe("AI interviews need a verified email", () => {
  const user = newUser("gate");

  test("unverified users are blocked, verified users are cleared", async ({ page }) => {
    await signUp(page, user);
    await page.goto("/interview");
    await expect(
      page.getByText("AI mock interviews unlock once your email is verified"),
    ).toBeVisible();
    await expect(page.getByText("You're cleared for AI interviews")).toHaveCount(0);

    await page.goto(await linkFromMail(page, user.email, "verify-email"));
    await expect(page.getByText("QUEST COMPLETE! Your email is verified.")).toBeVisible();

    await page.goto("/interview");
    await expect(page.getByText("You're cleared for AI interviews")).toBeVisible();
  });
});

test.describe("public profile", () => {
  const user = newUser("pub");

  test("is private until opted in, honours privacy toggles, and can be hidden again", async ({
    page,
    browser,
  }) => {
    await signUp(page, user);
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();

    await visitor.goto(`/u/${user.handle}`);
    await expect(visitor.getByText("THIS PLAYER WENT EXTINCT")).toBeVisible();

    await page.goto("/settings");
    await page.getByLabel("College").fill("Pixel Institute");
    await page.getByLabel("Let anyone view my profile").check();
    await page.getByLabel("Show my college").uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();

    await visitor.goto(`/u/${user.handle}`);
    await expect(visitor.getByRole("heading", { name: user.name })).toBeVisible();
    await expect(visitor.getByText("Pixel Institute")).toHaveCount(0); // hidden by the toggle
    await expect(visitor.getByText(user.email)).toHaveCount(0);

    await page.getByLabel("Let anyone view my profile").uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();
    await visitor.goto(`/u/${user.handle}`);
    await expect(visitor.getByText("THIS PLAYER WENT EXTINCT")).toBeVisible();
    await anonymous.close();
  });
});

test.describe("two-factor authentication", () => {
  const user = newUser("mfa");
  let secret = "";
  let recoveryCodes: string[] = [];
  const codeAt = (offset: number) => hotp(base32Decode(secret), stepAt(Date.now()) + offset);
  // The server accepts steps -1..+1 around ITS clock. A code for "previous step" computed just before
  // a 30 s boundary would be rejected a moment later, so wait out the last second of a step first.
  const clearOfBoundary = async (page: Page) => {
    const intoStep = Date.now() % 30_000;
    if (intoStep > 28_500) await page.waitForTimeout(30_000 - intoStep + 300);
  };

  test("can be turned on from settings and shows recovery codes once", async ({ page }) => {
    await signUp(page, user);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Set up" }).click();
    await expect(page.getByAltText("QR code for your authenticator app")).toBeVisible();
    secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByText("That code didn't work")).toBeVisible();

    await clearOfBoundary(page);
    await page.getByLabel("6-digit code").fill(codeAt(-1));
    await page.getByRole("button", { name: "Turn on" }).click();
    const list = page.getByTestId("recovery-codes");
    await expect(list).toBeVisible();
    recoveryCodes = (await list.locator("li").allTextContents()).map((s) => s.trim());
    expect(recoveryCodes).toHaveLength(10);

    await page.getByRole("button", { name: "I saved them" }).click();
    await expect(page.getByRole("button", { name: "Turn off" })).toBeVisible();
  });

  test("login now asks for a code; wrong codes fail, the right one signs in", async ({ page }) => {
    await logIn(page, user.email);
    await expect(page.getByLabel("Authentication code")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Authentication code").fill("123456");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("That code didn't work")).toBeVisible();

    await page.getByLabel("Authentication code").fill(codeAt(0));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a recovery code signs in once", async ({ page }) => {
    await logIn(page, user.email);
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill(recoveryCodes[0]!);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await signOut(page);
    await logIn(page, user.email);
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await page.getByLabel("Recovery code").fill(recoveryCodes[0]!);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("That code didn't work")).toBeVisible();
  });
});

test.describe("your data", () => {
  const user = newUser("data");

  test("export downloads a JSON file with the user's data", async ({ page }) => {
    await signUp(page, user);
    await page.goto("/settings");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export my data" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`prepquest-export-${user.handle}.json`);
    const path = await file.path();
    const data = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
    expect(data.account.email).toBe(user.email);
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|password_hash|argon2/i);
  });

  test("deleting the account schedules it, signs out, and signing in lets you cancel", async ({
    page,
  }) => {
    await logIn(page, user.email); // each test gets a fresh browser page, so sign in again
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Delete my account" }).click();
    const submit = page.getByRole("button", { name: "Delete in 14 days" });
    await expect(submit).toBeDisabled();

    await page.getByLabel("Password").fill("not-my-password");
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await submit.click();
    await expect(page.getByText("Incorrect password")).toBeVisible();

    await page.getByLabel("Password").fill(password);
    await submit.click();
    await expect(page).toHaveURL(/\/login$/);

    await logIn(page, user.email);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Account scheduled for deletion")).toBeVisible();
    await page.getByRole("button", { name: "Cancel deletion" }).click();
    await expect(page.getByText("Account scheduled for deletion")).toHaveCount(0);
  });
});
