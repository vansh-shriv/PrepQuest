import { expect, test } from "@playwright/test";
import { zipSync } from "fflate";
import { DEMO_PASSWORD, logIn, signUp, uniqueUser } from "./helpers";

const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`;
const slug = `e2e-${unique}`;
const title = `E2E Problem ${unique}`;

/** A valid zip for `total(nums: int[]) -> int`: 1 sample, hidden tests, 1 edge, 2 stress (all with labels). */
function testsZip(): Buffer {
  const enc = (s: string) => new TextEncoder().encode(s);
  const files: Record<string, Uint8Array> = {};
  const manifest: object[] = [];
  const total = 13;
  for (let i = 1; i <= total; i++) {
    const values = Array.from({ length: i + 1 }, (_, k) => k * i - 3);
    const n = String(i).padStart(2, "0");
    files[`${n}.in`] = enc(`${values.length}\n${values.join(" ")}\n`);
    files[`${n}.out`] = enc(`${values.reduce((a, b) => a + b, 0)}\n`);
    const kind =
      i === 1 ? "sample" : i > total - 2 ? "stress" : i === total - 2 ? "edge" : "hidden";
    manifest.push({
      ordinal: i,
      kind,
      ...(kind === "edge" || kind === "stress" ? { label: `${kind} ${i}` } : {}),
    });
  }
  files["manifest.json"] = enc(JSON.stringify(manifest));
  return Buffer.from(zipSync(files));
}

test.describe.configure({ mode: "serial" });

test("ordinary players see no Admin section and are turned away from its URL", async ({ page }) => {
  await signUp(page, uniqueUser("plain"));
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await page.goto("/admin/problems");
  await expect(page.getByText("This area is for content editors and reviewers.")).toBeVisible();
});

test("an editor drafts a problem, writes it, uploads tests and submits it for review", async ({
  page,
}) => {
  await logIn(page, "editor@prepquest.dev", DEMO_PASSWORD);
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin\/problems$/);
  await expect(page.getByTestId("admin-table")).toContainText("Two Sum"); // all 20 imported problems are listed

  await page.getByRole("link", { name: "New problem" }).click();
  // the tag list arrives after hydration; filling earlier would be discarded by the controlled inputs
  await expect(page.getByLabel("Arrays")).toBeVisible();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Arrays").check();
  await page.getByLabel("Function name").fill("total");
  await page.getByRole("button", { name: "Create draft" }).click();

  await expect(page).toHaveURL(/\/admin\/problems\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("draft", { exact: true })).toBeVisible();

  // nothing is written yet: the checklist says what's missing
  await page.getByRole("button", { name: "Run checks" }).click();
  const checks = page.getByRole("list", { name: "Validation checks" });
  await expect(checks).toContainText("Statement is written");
  await expect(checks.getByText("fail").first()).toBeVisible();

  // statement + example
  await page.getByRole("tab", { name: "Statement" }).click();
  await page
    .getByRole("textbox", { name: "Statement" })
    .fill("Given an array of integers, return the sum of all of its elements as a single integer.");
  await page.getByLabel("Constraints").fill("- `1 <= nums.length <= 100`");
  await page.getByRole("button", { name: "Add example" }).click();
  await page.getByLabel("Example 1 input").fill("nums = [1, 2, 3]");
  await page.getByLabel("Example 1 output").fill("6");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();

  // preview renders the Markdown
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("Given an array of integers")).toBeVisible();

  // tests: a bad zip is explained, a good one is accepted
  await page.getByRole("tab", { name: "Tests" }).click();
  await page.setInputFiles('input[type="file"]', {
    name: "bad.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("not a zip"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("That file isn't a valid zip archive")).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: "tests.zip",
    mimeType: "application/zip",
    buffer: testsZip(),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText(/Uploaded 13 tests as version \d+\./)).toBeVisible();
  await expect(page.getByText("Current tests (13)")).toBeVisible();

  await page.getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByRole("list", { name: "Validation checks" })).toContainText(
    "Tests are valid (13 found)",
  );

  // workflow: editors can submit but not publish
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("in review", { exact: true })).toBeVisible();
  await expect(page.getByText("Waiting for a reviewer.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for review" })).toHaveCount(0);

  // not public yet
  await page.goto(`/problems/${slug}`);
  await expect(page.getByText("THIS PAGE WENT EXTINCT")).toBeVisible();
});

test("a reviewer publishes it, players can find it, then it is archived with a reason", async ({
  page,
}) => {
  await logIn(page, "reviewer@prepquest.dev", DEMO_PASSWORD);
  await page.goto("/admin/problems");
  await page.getByRole("searchbox", { name: "Search by title" }).fill(unique);
  await page.getByRole("link", { name: title }).click();

  await expect(page.getByText("in review", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("published", { exact: true })).toBeVisible();

  // players see it, with its tests hidden
  await page.goto(`/problems?q=${unique}`);
  await expect(page.getByTestId("problem-row")).toHaveCount(1);
  await page.getByRole("link", { name: `Play ${title}` }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByText("Given an array of integers")).toBeVisible();

  // archive needs a reason
  await page.goBack();
  await page.goto("/admin/problems");
  await page.getByRole("searchbox", { name: "Search by title" }).fill(unique);
  await page.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Archive" }).click();
  const dialog = page.getByRole("dialog", { name: "Archive problem" });
  await expect(dialog.getByRole("button", { name: "Archive" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Replaced by a cleaner problem");
  await dialog.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("archived", { exact: true })).toBeVisible();

  // the audit trail records who did what, and why
  await page.getByRole("tab", { name: "Audit" }).click();
  const audit = page.getByRole("list", { name: "Audit log" });
  await expect(audit).toContainText("problem.archive");
  await expect(audit).toContainText("Reason: Replaced by a cleaner problem");
  await expect(audit).toContainText("problem.publish");
  await expect(audit).toContainText("problem.tests.upload");
  await expect(audit).toContainText("problem.create");

  // gone from the player-facing list
  await page.goto(`/problems?q=${unique}`);
  await expect(page.getByText("NOTHING HERE YET. TRY FEWER FILTERS!")).toBeVisible();
});

test("editors can't see the audit log tab", async ({ page }) => {
  await logIn(page, "editor@prepquest.dev", DEMO_PASSWORD);
  await page.goto("/admin/problems");
  await page.getByRole("searchbox", { name: "Search by title" }).fill(unique);
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("tab", { name: "Versions" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Audit" })).toHaveCount(0);
});
