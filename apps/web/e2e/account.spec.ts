import { expect, test, type Page } from "@playwright/test";

const MAILPIT = "http://localhost:8025/api/v1";
const SHOTS = "e2e-screenshots";

/** Finds the newest Mailpit message sent to `to` and returns the first link containing `needle`. */
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

const unique = Date.now().toString(36);
const user = {
  name: "E2E Player",
  handle: `e2e_${unique}`,
  email: `e2e-${unique}@example.com`,
  password: "e2e-correct-horse-battery",
};

test.describe.configure({ mode: "serial" });

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("signup validates, creates the account and lands on the dashboard", async ({ page }) => {
  await page.goto("/signup");
  await page.getByRole("button", { name: "Start quest" }).click();
  await expect(page.getByText("Required").first()).toBeVisible();

  await page.getByLabel("Display name").fill(user.name);
  await page.getByLabel("Handle").fill(user.handle);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Start quest" }).click();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();

  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Start quest" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: `Welcome, ${user.name}!` })).toBeVisible();
  await expect(page.getByText("Verify your email")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/dashboard-desktop.png` });
});

test("verifying the emailed link clears the banner", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const link = await linkFromMail(page, user.email, "verify-email");
  await page.goto(link);
  await expect(page.getByText("QUEST COMPLETE! Your email is verified.")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: `Welcome, ${user.name}!` })).toBeVisible();
  await expect(page.getByText("Verify your email")).toHaveCount(0);
});

test("login rejects a wrong password, accepts the right one, and survives a reload", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill("not-my-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Incorrect email or password")).toBeVisible();

  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.reload(); // access token is memory-only; the refresh cookie restores the session
  await expect(page.getByRole("heading", { name: `Welcome, ${user.name}!` })).toBeVisible();
});

test("settings: profile edit and theme persist; shell navigation works", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("link", { name: "Settings and profile" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.getByLabel("College").fill("Pixel Institute");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();

  await page.getByRole("button", { name: "night" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await page.screenshot({ path: `${SHOTS}/settings-night.png` });

  // saved to the account: survives a reload and a fresh sign-in
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await expect(page.getByLabel("College")).toHaveValue("Pixel Institute");

  // the problem list renders inside the shell
  await page.getByRole("link", { name: "Practice" }).first().click();
  await expect(page).toHaveURL(/\/problems$/);
  await expect(page.getByRole("heading", { name: "Quests", level: 1 })).toBeVisible();
});

test("mobile layout uses the bottom tab bar", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: /Practice/ })).toBeVisible();
  await expect(page.getByRole("search")).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/dashboard-mobile.png` });
  await context.close();
});

test("menu signs out and protects the app again", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Menu" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "Menu" }).first().click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("forgot password flow resets the password and signs in with the new one", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByText("a reset link is on its way")).toBeVisible();

  const link = await linkFromMail(page, user.email, "reset-password");
  await page.goto(link);
  const next = "e2e-a-new-passphrase";
  await page.getByLabel("New password").fill(next);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Password updated")).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(next);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
