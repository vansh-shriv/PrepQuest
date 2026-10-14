import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { logIn, signUp, uniqueUser } from "./helpers";
import { verifyEmail } from "./interview-helpers";

// Phase 16: system design practice through the real stack: draw, autosave, undo, checks, review, reference.

const user = uniqueUser("ds");
test.describe.configure({ mode: "serial" });

let designUrl = "";

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

const nodes = (page: Page) => page.getByTestId("design-node");
const saved = (page: Page) =>
  expect(page.getByTestId("save-state")).toContainText("All changes saved");

test("first: sign up, verify the email and start a design", async ({ page }) => {
  await signUp(page, user);
  await verifyEmail(page, user.email);
  await page.goto("/system-design");
  await expect(page.getByTestId("design-prompts").getByRole("listitem")).toHaveCount(4);
  await expect(page.getByTestId("design-empty")).toBeVisible();
  await page.getByRole("button", { name: /^Start Design a URL shortener/ }).click();
  await expect(page.getByTestId("design-workspace")).toBeVisible();
  designUrl = page.url();
  expect(designUrl).toMatch(/\/system-design\/[0-9a-f-]{36}$/);
  await expect(nodes(page)).toHaveCount(0);
});

test("components are added, named and connected, and the drawing is checked", async ({ page }) => {
  await page.goto(designUrl);
  const toolbar = page.getByRole("toolbar", { name: "Add a component" });
  await toolbar.getByRole("button", { name: "+ Client" }).click();
  await toolbar.getByRole("button", { name: "+ Service" }).click();
  await toolbar.getByRole("button", { name: "+ Database" }).click();
  await expect(nodes(page)).toHaveCount(3);
  await expect(nodes(page).nth(1)).toHaveAttribute("data-type", "service");

  // rename the service (the newest component is selected, so click the one we want)
  await nodes(page).nth(1).click();
  await page.getByTestId("design-inspector").getByLabel("Service name").fill("Shortener API");
  await expect(nodes(page).nth(1)).toHaveAccessibleName(/Service: Shortener API/);

  // connect client -> service, then service -> database
  await nodes(page).nth(0).click();
  await page.getByRole("button", { name: "Connect to…" }).click();
  await expect(page.getByTestId("connect-hint")).toBeVisible();
  await nodes(page).nth(1).click();
  await nodes(page).nth(1).click();
  await page.getByRole("button", { name: "Connect to…" }).click();
  await nodes(page).nth(2).click();
  await expect(page.getByTestId("design-edge")).toHaveCount(2);

  // label a connection from the text outline
  await page.getByText("Outline of the design (text)").click();
  await page.getByRole("button", { name: /Client to Shortener API/ }).click();
  await page.getByTestId("design-inspector").getByLabel("What flows over it").fill("HTTPS");
  await expect(page.getByRole("button", { name: "Client to Shortener API (HTTPS)" })).toBeVisible();

  // the automatic checks read the saved drawing
  await saved(page);
  await expect(page.getByTestId("design-checks")).toContainText("One database with no replica");
  await expect(page.getByTestId("design-checks")).toContainText("A cache in front of it");
});

test("the drawing autosaves, survives a reload and has undo and redo", async ({ page }) => {
  await page.goto(designUrl);
  await expect(nodes(page)).toHaveCount(3);
  await expect(page.getByTestId("design-edge")).toHaveCount(2);

  // a fresh page has nothing to undo yet
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  // delete a component with the keyboard, then bring it back with undo
  await nodes(page).nth(2).focus();
  await page.keyboard.press("Delete");
  await expect(nodes(page)).toHaveCount(2);
  await expect(page.getByTestId("design-edge")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(nodes(page)).toHaveCount(3);
  await expect(page.getByTestId("design-edge")).toHaveCount(2);
  await saved(page);

  await page.reload();
  await expect(nodes(page)).toHaveCount(3);
  await expect(page.getByTestId("design-edge")).toHaveCount(2);
});

test("the requirements and the capacity calculator are kept with the design", async ({ page }) => {
  await page.goto(designUrl);
  const panel = page.getByTestId("design-panel");
  await panel
    .getByLabel("Functional requirements", { exact: true })
    .fill("Create a short link\nRedirect a short link\n");
  await panel.getByLabel("API", { exact: true }).fill("POST /links\nGET /{code}");
  // defaults: a million users, ten actions each
  await expect(panel.getByTestId("estimate-result")).toContainText("115.74 requests/s");
  await panel.getByLabel("Daily active users").fill("10000000");
  await expect(panel.getByTestId("estimate-result")).toContainText("1,157 requests/s");
  await saved(page);
  await page.reload();
  await expect(
    page.getByTestId("design-panel").getByLabel("Functional requirements", { exact: true }),
  ).toHaveValue("Create a short link\nRedirect a short link");
  await expect(page.getByTestId("design-panel").getByLabel("Daily active users")).toHaveValue(
    "10000000",
  );
});

test("the reference stays shut until the design has been reviewed", async ({ page }) => {
  await page.goto(designUrl);
  await page.getByRole("button", { name: "Show the reference" }).click();
  await expect(page.getByTestId("reference-locked")).toContainText("get a review first");
});

test("a review scores the design, points at components and asks five questions", async ({
  page,
}) => {
  await page.goto(designUrl);
  await page.getByTestId("design-review-start").click();
  const result = page.getByTestId("design-review-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("design-summary")).not.toBeEmpty();
  await expect(result.getByRole("list", { name: "Scores" }).getByRole("listitem")).toHaveCount(7);
  await expect(page.getByTestId("design-questions").getByRole("listitem")).toHaveCount(5);
  const finding = page.getByTestId("design-finding").filter({ hasText: "replica" });
  await expect(finding).toBeVisible();
  await expect(finding).toContainText("Important");
  // the finding points at the database: showing it marks that component
  await finding.getByRole("button", { name: "Show on the canvas" }).click();
  await expect(nodes(page).nth(2).locator("rect").nth(1)).toHaveAttribute(
    "stroke-dasharray",
    "8 4",
  );
});

test("after a review the reference designs open in three layers", async ({ page }) => {
  await page.goto(designUrl);
  await page.getByRole("button", { name: "Show the reference" }).click();
  const ref = page.getByTestId("design-reference");
  await expect(ref.getByRole("tab", { name: /Version 1/ })).toBeVisible();
  const count = async () => ref.getByTestId("design-node").count();
  const simple = await count();
  await ref.getByRole("tab", { name: /Version 3/ }).click();
  await expect.poll(count).toBeGreaterThan(simple);
  await expect(ref).toContainText("CDN");
});

test("the design exports as JSON", async ({ page }) => {
  await page.goto(designUrl);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("design-a-url-shortener.json");
  const doc = JSON.parse(await readFile((await file.path())!, "utf8")) as {
    format: string;
    canvas: { nodes: unknown[]; edges: unknown[] };
  };
  expect(doc.format).toBe("prepquest-design");
  expect(doc.canvas.nodes).toHaveLength(3);
  expect(doc.canvas.edges).toHaveLength(2);
});

test("a design can be deleted from the list", async ({ page }) => {
  await page.goto("/system-design");
  await expect(page.getByTestId("design-item")).toHaveCount(1);
  await expect(page.getByTestId("design-item")).toContainText("Reviewed");
  await page.getByRole("button", { name: "Delete Design a URL shortener" }).click();
  await expect(page.getByTestId("design-empty")).toBeVisible();
  const res = await page.goto(designUrl);
  expect(res?.status()).toBe(200);
  await expect(page.getByText("NOT FOUND")).toBeVisible();
});
