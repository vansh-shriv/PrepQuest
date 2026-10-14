import { expect, test, type Page } from "@playwright/test";
import { verifyEmail } from "./interview-helpers";
import { DEMO_PASSWORD, PASSWORD, logIn, newSession, signUp, uniqueUser } from "./helpers";

// Phase 15: two learners hand in the same solution in a contest. A reviewer scans, compares the code side by
// side and confirms; the learner is told, appeals, and the reviewer overturns it. Real stack and judge.

const ada = uniqueUser("ia");
const bob = uniqueUser("ib");
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
test.describe.configure({ mode: "serial" });

// long enough to be compared (very short answers never are), and correct
const ADA_CODE = `class Solution:
    def minDistance(self, a, b):
        prev = list(range(len(b) + 1))
        for i in range(1, len(a) + 1):
            cur = [i] + [0] * len(b)
            for j in range(1, len(b) + 1):
                if a[i - 1] == b[j - 1]:
                    cur[j] = prev[j - 1]
                else:
                    cur[j] = 1 + min(prev[j - 1], prev[j], cur[j - 1])
            prev = cur
        return prev[len(b)]
`;
// the same program with every name changed and a comment on each line
const BOB_CODE = `class Solution:
    def minDistance(self, first, second):
        above = list(range(len(second) + 1))  # start
        for row in range(1, len(first) + 1):  # each row
            current = [row] + [0] * len(second)  # new row
            for col in range(1, len(second) + 1):  # each column
                if first[row - 1] == second[col - 1]:  # same letter
                    current[col] = above[col - 1]  # free
                else:
                    current[col] = 1 + min(above[col - 1], above[col], current[col - 1])  # edit
            above = current  # next
        return above[len(second)]  # answer
`;

let slug = "";

async function token(page: Page, email: string) {
  const login = await page.request.post(`${API}/v1/auth/login`, {
    data: { email, password: PASSWORD },
  });
  return ((await login.json()) as { accessToken: string }).accessToken;
}

async function solve(page: Page, email: string, source: string) {
  const headers = { authorization: `Bearer ${await token(page, email)}` };
  const created = await page.request.post(`${API}/v1/submissions`, {
    headers,
    data: {
      problemSlug: "edit-distance",
      language: "python",
      code: source,
      kind: "submit",
      mode: "contest",
      contestSlug: slug,
    },
  });
  expect(created.status()).toBe(202);
  const { submissionId } = (await created.json()) as { submissionId: string };
  await expect
    .poll(
      async () =>
        (
          (await (
            await page.request.get(`${API}/v1/submissions/${submissionId}`, { headers })
          ).json()) as {
            verdict: string;
          }
        ).verdict,
      { timeout: 60_000 },
    )
    .toBe("AC");
}

test("first: two learners join a contest and hand in matching solutions", async ({
  page,
  browser,
}) => {
  await signUp(page, ada);
  await verifyEmail(page, ada.email);
  const headers = { authorization: `Bearer ${await token(page, ada.email)}` };
  const made = await page.request.post(`${API}/v1/contests`, {
    headers,
    data: {
      title: "Fair play round",
      kind: "private",
      scoring: "icpc",
      startsAt: new Date(Date.now() - 10_000).toISOString(),
      durationMinutes: 60,
      problems: [{ slug: "edit-distance" }],
    },
  });
  expect(made.status()).toBe(201);
  const body = (await made.json()) as { slug: string; inviteCode: string };
  slug = body.slug;
  await solve(page, ada.email, ADA_CODE);

  const context = await browser.newContext();
  const guest = await context.newPage();
  await signUp(guest, bob);
  const reg = await guest.request.post(`${API}/v1/contests/${slug}/register`, {
    headers: { authorization: `Bearer ${await token(guest, bob.email)}` },
    data: { inviteCode: body.inviteCode },
  });
  expect(reg.status()).toBe(200);
  await solve(guest, bob.email, BOB_CODE);
  await context.close();
});

test("the contest page says what is monitored", async ({ page }) => {
  await logIn(page, ada.email);
  await page.goto(`/contests/${slug}`);
  await page.getByText("How fair play works").click();
  await expect(page.getByTestId("fair-play")).toContainText("never a verdict");
  await expect(page.getByTestId("fair-play")).toContainText("appeal once");
});

test("ordinary learners cannot open the queue", async ({ page }) => {
  await logIn(page, bob.email);
  await page.goto("/integrity");
  await expect(page.getByText("This queue is for reviewers")).toBeVisible();
});

test("a reviewer scans, sees both programs side by side and confirms", async ({ browser }) => {
  const { context, page } = await newSession(browser, "reviewer@prepquest.dev", DEMO_PASSWORD);
  await page.goto("/integrity");
  await page.getByLabel("Contest slug").fill(slug);
  await page.getByRole("button", { name: "Scan" }).click();
  await expect(page.getByTestId("scan-result")).toContainText("2 new flags");

  await page.getByTestId("flag-row").filter({ hasText: bob.handle }).click();
  const detail = page.getByTestId("flag-detail");
  await expect(detail).toContainText("Code similarity");
  await expect(detail.getByTestId("flag-pair")).toContainText("appears in the other");
  await expect(detail.getByTestId("flag-code")).toHaveCount(2);
  await expect(detail.getByTestId("flag-code").nth(1)).toContainText("prev = list(range");

  // nothing happens without a reason
  const confirm = detail.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirm).toBeDisabled();
  await detail
    .getByLabel(/Reason/)
    .fill("The two programs match line for line once names are ignored.");
  await confirm.click();
  await expect(detail).toContainText("Confirmed");
  await context.close();
});

test("the confirmed learner leaves the standings, is told why and appeals", async ({
  page,
  browser,
}) => {
  await logIn(page, ada.email);
  await page.goto(`/contests/${slug}`);
  await expect(page.getByTestId("standings")).toContainText(ada.handle);
  await expect(page.getByTestId("standings")).not.toContainText(bob.handle);

  const { context, page: bobPage } = await newSession(browser, bob.email);
  await bobPage.goto("/settings");
  const notice = bobPage.getByTestId("integrity-notice");
  await expect(notice).toContainText("A fair-play review reached a decision");
  await expect(notice).toContainText("match line for line");
  // the other learner is never named
  await expect(notice).not.toContainText(ada.handle);
  await notice
    .getByLabel("Your appeal")
    .fill("I wrote this alone; the overlap is the textbook table method.");
  await notice.getByRole("button", { name: "Send appeal" }).click();
  await expect(bobPage.getByTestId("integrity-notice")).toContainText("being reviewed");
  await context.close();
});

test("the reviewer reads the appeal and overturns the decision", async ({ browser }) => {
  const { context, page } = await newSession(browser, "reviewer@prepquest.dev", DEMO_PASSWORD);
  await page.goto("/integrity");
  await page.getByLabel("Show").selectOption("appealed");
  await page.getByTestId("flag-row").filter({ hasText: bob.handle }).click();
  await expect(page.getByTestId("flag-appeal")).toContainText("textbook table method");
  await page.getByLabel(/Reason/).fill("Appeal accepted: this is the standard approach.");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("flag-detail")).toContainText("Dismissed");
  await context.close();

  const learner = await browser.newContext();
  const bobPage = await learner.newPage();
  await logIn(bobPage, bob.email);
  await bobPage.goto("/settings");
  await expect(bobPage.getByTestId("integrity-notice")).toContainText("Your appeal was accepted");
  await bobPage.goto(`/contests/${slug}`);
  await expect(bobPage.getByTestId("standings")).toContainText(bob.handle);
  await learner.close();
});
