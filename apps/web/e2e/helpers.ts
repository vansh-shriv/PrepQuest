import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

export const PASSWORD = "e2e-an-unusual-passphrase-77";
export const DEMO_PASSWORD = "demo-password";

/** A unique account per test run so drafts and custom tests never leak between runs. */
export function uniqueUser(tag: string) {
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  return {
    name: `E2E ${tag}`,
    handle: `e2e_${tag}_${unique}`.slice(0, 20),
    email: `e2e-${tag}-${unique}@example.com`,
  };
}

export async function signUp(page: Page, user: ReturnType<typeof uniqueUser>) {
  await page.goto("/signup");
  await page.getByLabel("Display name").fill(user.name);
  await page.getByLabel("Handle").fill(user.handle);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Start quest" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** A second signed-in browser, e.g. another device or a reviewer next to an editor. */
export async function newSession(
  browser: Browser,
  email: string,
  password = PASSWORD,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, email, password);
  return { context, page };
}

/** Types into the Monaco editor, replacing everything. */
export async function typeInEditor(page: Page, text: string) {
  const surface = page.locator(".monaco-editor .view-lines").first();
  await surface.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
}

/** The editor's text. Monaco renders spaces as non-breaking spaces, so normalise them. */
export const editorText = async (page: Page) =>
  (await page.locator(".monaco-editor .view-lines").first().innerText()).replace(/\u00a0/g, " ");

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Puts code straight into the user's draft through the API. Typing multi-line code into Monaco fights
 * its auto-indent, and these tests are about the judge, not the editor.
 */
export async function saveDraft(
  request: APIRequestContext,
  credentials: { email: string; password?: string },
  slug: string,
  language: "python" | "cpp" | "java",
  code: string,
) {
  const login = await request.post(`${API}/v1/auth/login`, {
    data: { email: credentials.email, password: credentials.password ?? PASSWORD },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };
  const url = `${API}/v1/problems/${slug}/draft?language=${language}`;
  const current = (await (await request.get(url, { headers })).json()) as {
    draft: { version: number } | null;
  };
  const res = await request.put(url, {
    headers,
    data: { code, baseVersion: current.draft?.version ?? 0 },
  });
  expect(res.ok()).toBe(true);
}
