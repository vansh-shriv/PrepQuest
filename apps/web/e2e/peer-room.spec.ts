import { expect, test, type Page } from "@playwright/test";
import { sql } from "./db";
import { editorText, logIn, newSession, signUp, typeInEditor, uniqueUser } from "./helpers";
import { verifyEmail } from "./interview-helpers";

// Phase 19: the live room of a peer mock through the real stack: two browsers in one room, the shared
// editor and whiteboard, an audio call (Chrome's fake microphone), the interviewer's suggestions and the
// end of the session. A booked session is moved to "now" in the database because the browser cannot move
// the server's clock; the rules around the clock are covered by the API tests.

const ada = uniqueUser("ra");
const bob = uniqueUser("rb");
test.describe.configure({ mode: "serial" });

let sessionUrl = "";

const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function enter(page: Page) {
  await page.goto(sessionUrl);
  await page.getByRole("button", { name: "Open the room" }).click();
  await expect(page.getByTestId("peer-room")).toBeVisible();
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

test("a booked session is moved to now and both people open the room", async ({
  page,
  browser,
}) => {
  await logIn(page, ada.email);
  await page.goto("/peer");
  await page.getByLabel("Start", { exact: true }).fill(local(new Date(Date.now() + 3 * 3_600_000)));
  await page.getByLabel("Topic", { exact: true }).selectOption("dsa");
  await page.getByRole("button", { name: "Make an invite link" }).click();
  const link = (await page.getByTestId("peer-invite-link").locator("code").textContent())!;

  const { context, page: friend } = await newSession(browser, bob.email);
  await friend.goto(link);
  await friend.getByRole("button", { name: "Accept and book it" }).click();
  await expect(friend).toHaveURL(/\/peer\/[0-9a-f-]{36}$/);
  sessionUrl = friend.url();
  await context.close();

  const id = sessionUrl.split("/").pop()!;
  await sql("UPDATE peer_sessions SET scheduled_at = now() - interval '1 minute' WHERE id = $1", [
    id,
  ]);
});

test("two browsers share a room, a code editor and a whiteboard", async ({ page, browser }) => {
  await logIn(page, ada.email);
  const { context, page: other } = await newSession(browser, bob.email);
  await enter(page);
  await enter(other);

  for (const p of [page, other]) {
    await expect(p.getByTestId("peer-room-connection")).toHaveText("Connected");
    await expect(p.getByTestId("peer-room-partner")).toContainText("is here");
  }

  // code typed by one appears for the other
  await typeInEditor(page, "print(42)");
  await expect.poll(() => editorText(other), { timeout: 10_000 }).toContain("print(42)");
  // and back
  await other.locator(".monaco-editor .view-lines").first().click();
  await other.keyboard.press("Control+End");
  await other.keyboard.type(" # ok");
  await expect.poll(() => editorText(page), { timeout: 10_000 }).toContain("# ok");

  // a stroke drawn by one is on the other's board
  await page.getByRole("button", { name: "Whiteboard" }).click();
  await other.getByRole("button", { name: "Whiteboard" }).click();
  const board = page.getByTestId("peer-board");
  await board.scrollIntoViewIfNeeded();
  const box = (await board.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect(board).toHaveAttribute("data-strokes", "1");
  await expect(other.getByTestId("peer-board")).toHaveAttribute("data-strokes", "1", {
    timeout: 10_000,
  });
  // clearing is shared too
  await other.getByRole("button", { name: "Clear the board" }).click();
  await expect(board).toHaveAttribute("data-strokes", "0", { timeout: 10_000 });
  await context.close();
});

test("the two hear each other: the call connects, mutes and leaves", async ({ page, browser }) => {
  await logIn(page, ada.email);
  const { context, page: other } = await newSession(browser, bob.email);
  await page.goto(sessionUrl);
  await other.goto(sessionUrl);
  await expect(page.getByTestId("peer-room")).toBeVisible();
  await expect(other.getByTestId("peer-room")).toBeVisible();

  await page.getByRole("button", { name: "Join the audio" }).click();
  await expect(page.getByTestId("peer-call-state")).toContainText("Waiting for your partner");
  // the partner sees a call coming in before they have joined: no microphone is opened for them yet
  await expect(other.getByTestId("peer-call-state")).toContainText("is calling");
  await other.getByRole("button", { name: "Answer the call" }).click();

  for (const p of [page, other])
    await expect(p.getByTestId("peer-call-state")).toContainText("Connected", { timeout: 25_000 });

  await page.getByRole("button", { name: "Mute" }).click();
  await expect(page.getByTestId("peer-call-state")).toContainText("you are muted");
  await page.getByRole("button", { name: "Unmute" }).click();
  await expect(page.getByTestId("peer-call-state")).not.toContainText("muted");

  await page.getByRole("button", { name: "Leave the audio" }).click();
  await expect(page.getByTestId("peer-call-state")).toContainText("Not on the call");
  await expect(other.getByTestId("peer-call-state")).toContainText("Waiting for your partner", {
    timeout: 10_000,
  });
  await context.close();
});

test("only the interviewer gets follow-up ideas, and the room closes for both at the end", async ({
  page,
  browser,
}) => {
  await logIn(page, ada.email);
  const { context, page: other } = await newSession(browser, bob.email);
  await page.goto(sessionUrl);
  await other.goto(sessionUrl);
  await expect(page.getByTestId("peer-room")).toBeVisible();
  await expect(other.getByTestId("peer-room")).toBeVisible();

  const roleOf = async (p: Page) => (await p.getByTestId("peer-role").textContent())!;
  const [interviewer, candidate] =
    (await roleOf(page)) === "interviewer" ? [page, other] : [other, page];
  await expect(candidate.getByTestId("peer-suggestions")).toHaveCount(0);
  await interviewer.getByRole("button", { name: "Suggest follow-ups" }).click();
  await expect(
    interviewer.getByTestId("peer-suggestion-list").getByRole("listitem").first(),
  ).toBeVisible();
  await expect(interviewer.getByTestId("peer-suggestions")).toContainText("11 left");
  // asking again straight away is refused with a reason, not silently
  await interviewer.getByRole("button", { name: "Suggest follow-ups" }).click();
  await expect(interviewer.getByTestId("peer-suggestions")).toContainText("another suggestion in");

  await page.getByRole("button", { name: "End the session" }).click();
  for (const p of [page, other])
    await expect(p.getByTestId("peer-feedback")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("peer-room")).toHaveCount(0);
  await context.close();
});
