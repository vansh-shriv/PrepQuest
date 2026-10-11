import { expect, test, type Page } from "@playwright/test";
import { logIn, signUp, uniqueUser } from "./helpers";
import { makePdf, setEditorText, verifyEmail } from "./interview-helpers";

// AI interviews end to end through the real stack. The model is the scripted mock (LLM_MODE=mock):
// these tests are about the product around it (state machine, streaming, timer, judge, scorecard).

const user = uniqueUser("iv");
test.describe.configure({ mode: "serial" });

const RESUME = [
  "Jane Doe",
  "Education",
  "IIT Delhi - B.Tech in Computer Science",
  "Projects",
  "Chat Platform | Tech: Node.js, Redis, WebSocket",
  "- Built a realtime chat serving 10k users with p95 latency of 120 ms",
  "- Reduced message delivery cost by 40% using batching",
  "Experience",
  "Acme Corp | Backend Intern",
  "- Improved API throughput by 3x by adding a cache layer",
  "Skills",
  "Languages: TypeScript, Python, Go",
];

const GOOD = `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for j, x in enumerate(nums):
            if target - x in seen:
                return [seen[target - x], j]
            seen[x] = j
        return []
`;

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

/** Sends a message with Enter and waits for the interviewer's new reply to mention `expectReply`. */
const say = async (page: Page, text: string, expectReply: RegExp) => {
  const before = await page.getByTestId("msg-interviewer").count();
  await page.getByLabel("Your answer").fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("msg-candidate").last()).toContainText(text.slice(0, 20));
  await expect(page.getByTestId("msg-interviewer").nth(before)).toBeVisible();
  await expect(page.getByTestId("chat-log")).toContainText(expectReply);
};

test("first: sign up and verify the email", async ({ page }) => {
  await signUp(page, user);
  await verifyEmail(page, user.email);
});

test("the hub invites you to start and links to resumes", async ({ page }) => {
  await page.goto("/interview");
  await expect(page.getByRole("heading", { name: "Boss fights" })).toBeVisible();
  await expect(page.getByTestId("new-interview")).toBeVisible();
  await expect(page.getByText("NO BOSS FIGHTS YET. START ONE!")).toBeVisible();
});

test("a resume is uploaded, read, reviewed and confirmed", async ({ page }) => {
  await page.goto("/resumes");
  await page.getByLabel("Resume file").setInputFiles({
    name: "jane.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(RESUME),
  });
  const row = page.getByTestId("resume-row").first();
  await expect(row).toContainText("Needs your review");
  await row.getByRole("button", { name: "Review" }).click();
  const editor = page.getByTestId("resume-editor");
  await expect(editor.getByLabel("Name", { exact: true }).first()).toHaveValue("Chat Platform");
  // fix what the parser got wrong
  await editor.getByLabel("Name", { exact: true }).first().fill("Realtime Chat");
  await editor.getByRole("button", { name: "Looks right, confirm" }).click();
  await expect(row).toContainText("Ready");
  await expect(row).toContainText("default");
});

test("a project interview: briefing, streamed conversation, early end and a scorecard", async ({
  page,
}) => {
  await page.goto("/interview/new?type=project");
  await expect(page.getByTestId("plan-preview")).toContainText("projects[0]");
  await page.getByRole("button", { name: "Start setup" }).click();

  await expect(page.getByRole("heading", { name: /Ready for Project deep-dive/ })).toBeVisible();
  await page.getByRole("button", { name: "Begin interview" }).click();
  await expect(page.getByTestId("interview-room")).toBeVisible();
  await expect(page.getByTestId("chat-log")).toContainText(/tell me a bit about yourself/i);
  await expect(page.getByRole("timer")).toBeVisible();

  await say(
    page,
    "Hi, I'm Jane, a backend engineer who likes realtime systems.",
    /talk about your work/,
  );
  await say(
    page,
    "I chose Redis instead of Kafka because latency mattered more than durability in that trade-off.",
    /\?/,
  );
  await say(page, "We measured 120 ms at the 95th percentile with 10k users.", /\?/);

  // the clock is the server's: a reload restores the conversation and the time left
  await page.reload();
  await expect(page.getByTestId("chat-log")).toContainText("talk about your work");
  await expect(page.getByRole("timer")).toContainText(/\d\d:\d\d/);

  await page.getByRole("button", { name: "End interview" }).click();
  await page.getByRole("button", { name: "End and get my scorecard" }).click();
  await expect(page.getByTestId("interview-finished")).toBeVisible();
  await page
    .getByRole("link", { name: /scorecard|review/i })
    .first()
    .click();

  await expect(page.getByTestId("scorecard")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("overall-score")).toBeVisible();
  await expect(page.getByRole("img", { name: /Radar chart/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Project deep-dive: review/ })).toBeVisible();
  // an early finish is flagged, and the transcript shows what was said
  await expect(page.getByTestId("low-confidence")).toBeVisible();
  await expect(page.getByRole("list", { name: "Transcript" })).toContainText(
    "Redis instead of Kafka",
  );
  await page.getByRole("tab", { name: "Evidence" }).click();
  await expect(page.getByText("Ownership").first()).toBeVisible();
});

test("a DSA interview with the editor, the judge and a scorecard that counts the verdict", async ({
  page,
}) => {
  await page.goto("/interview/new");
  await expect(page.getByTestId("plan-preview")).toContainText("Questions");
  await page.getByLabel("Length (minutes)").fill("30");
  await page.getByLabel("Problem 1").selectOption({ label: "Two Sum (easy)" });
  await expect(page.getByTestId("plan-preview")).toContainText("Two Sum");
  await page.getByRole("button", { name: "Start setup" }).click();
  await page.getByRole("button", { name: "Begin interview" }).click();
  await expect(page.getByTestId("chat-log")).toContainText(/introduce|tell me/i);

  await say(page, "Hi, I'm Jane.", /Here's the problem: Two Sum/);
  await expect(page.getByTestId("interview-code")).toBeVisible();
  await say(page, "I would use a hash map for complements.", /time complexity/i);
  await say(
    page,
    "I will scan once, store each value and check the complement.",
    /write the code/i,
  );

  await setEditorText(page, GOOD);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("status", { name: "Verdict: Accepted" })).toBeVisible({
    timeout: 30_000,
  });
  // the interviewer reacts to the judge's verdict on its own
  await expect(page.getByTestId("chat-log")).toContainText(/time and space complexity/i);
  await expect(page.getByTestId("interview-state")).toContainText("optimize");

  await page.getByRole("button", { name: "End interview" }).click();
  await page.getByRole("button", { name: "End and get my scorecard" }).click();
  await page
    .getByRole("link", { name: /scorecard|review/i })
    .first()
    .click();
  await expect(page.getByTestId("scorecard")).toBeVisible({ timeout: 30_000 });
  // the replay shows the code as it evolved, with the submit marked
  await page.getByRole("tab", { name: "Code replay" }).click();
  const scrub = page.getByLabel(/Time:/);
  await expect(page.getByTestId("replay-code")).toContainText("def twoSum"); // opens on the final code
  await scrub.focus();
  await scrub.press("Home");
  await expect(page.getByText("Nothing written yet")).toBeVisible();
  await scrub.press("End");
  await expect(page.getByTestId("replay-code")).toContainText("def twoSum");
  await expect(page.getByRole("list", { name: "Moments" })).toContainText("Submit: AC");
  await page.getByRole("tab", { name: "Evidence" }).click();
  await page.locator("summary", { hasText: "Correctness" }).click();
  await expect(page.getByText(/accepted by the judge|final verdict AC/i).first()).toBeVisible();
});

test("the history lists both interviews with their scores", async ({ page }) => {
  await page.goto("/interview");
  const rows = page.getByTestId("interview-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("DSA coding round");
  await expect(rows.nth(1)).toContainText("Project deep-dive");
  await rows.first().getByRole("link", { name: "Review" }).click();
  await expect(page.getByTestId("scorecard")).toBeVisible();
});

test("the interview room works on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/interview/new");
  await page.getByLabel("Length (minutes)").fill("20");
  await page.getByRole("button", { name: "Start setup" }).click();
  await page.getByRole("button", { name: "Begin interview" }).click();
  await expect(page.getByTestId("chat-log")).toContainText(/introduce|tell me/i);
  await say(page, "Hi from my phone.", /\S/);
  await page.getByRole("button", { name: "End interview" }).click();
  await page.getByRole("button", { name: "End and get my scorecard" }).click();
  await expect(page.getByTestId("interview-finished")).toBeVisible();
});
