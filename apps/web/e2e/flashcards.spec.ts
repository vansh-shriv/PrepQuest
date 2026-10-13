import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { logIn, signUp, uniqueUser } from "./helpers";

// Phase 13: flashcards through the real stack, including a study session that loses its connection.

const user = uniqueUser("fc");
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  if (test.info().title.startsWith("first")) return;
  await logIn(page, user.email);
});

const addCard = async (page: Page, front: string, back: string, type?: string) => {
  const form = page.getByTestId("card-form").first();
  if (type) await form.getByLabel("Card type").selectOption(type);
  await form.getByLabel(type === "cloze" ? "Text with blanks" : "Front").fill(front);
  if (back) await form.getByLabel(/^(Back|Extra detail)/).fill(back);
  await form.getByRole("button", { name: "Add card" }).click();
};

const makeDeck = async (page: Page, name: string, cards: Array<[string, string]>) => {
  await page.goto("/flashcards");
  await page.getByLabel("Deck name").fill(name);
  await page.getByRole("button", { name: "Create deck" }).click();
  await page.getByTestId("deck-list").getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  for (const [i, [front, back]] of cards.entries()) {
    await addCard(page, front, back);
    await expect(page.getByTestId("card-row")).toHaveCount(i + 1);
  }
};

test("first: sign up", async ({ page }) => {
  await signUp(page, user);
});

test("a new account has no decks and can copy a starter deck once", async ({ page }) => {
  await page.goto("/flashcards");
  await expect(page.getByTestId("decks-empty")).toBeVisible();
  const starters = page.getByTestId("starter-list");
  await expect(starters).toContainText("Big-O cheat sheet");
  await page.getByRole("button", { name: "Add Big-O cheat sheet to my decks" }).click();
  await expect(page.getByTestId("deck-list")).toContainText("Big-O cheat sheet");
  await expect(starters.getByRole("link", { name: "Open my copy" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Big-O cheat sheet to my decks" })).toHaveCount(
    0,
  );
});

test("a cloze card hides its blank until the answer is shown", async ({ page }) => {
  await makeDeck(page, "Cloze deck", [["What does DFS use?", "A stack"]]);
  await addCard(page, "BFS uses a {{c1::queue::structure}}.", "", "cloze");
  await expect(page.getByTestId("card-row")).toHaveCount(2);
  await expect(page.getByTestId("card-list")).toContainText("BFS uses a [structure].");

  await page.getByRole("link", { name: "Study this deck" }).click();
  await expect(page.getByTestId("study-progress")).toHaveText("0 of 2");
  await expect(page.getByTestId("study-answer")).toHaveCount(0);
  await page.getByRole("button", { name: "Show the answer" }).click();
  await expect(page.getByTestId("study-answer")).toBeVisible();
  await page.getByRole("button", { name: "Good", exact: true }).click();
  await expect(page.getByTestId("study-progress")).toHaveText("1 of 2");
  // the keyboard works too: space flips, 3 is "Good"
  await page.keyboard.press("Space");
  await expect(page.getByTestId("study-answer")).toBeVisible();
  await page.keyboard.press("3");
  await expect(page.getByTestId("study-done")).toContainText("2 cards reviewed.");
});

test("answers given offline are kept on the device and synced after reconnecting", async ({
  page,
  context,
}) => {
  await makeDeck(page, "Offline deck", [
    ["Q1", "A1"],
    ["Q2", "A2"],
    ["Q3", "A3"],
  ]);
  await page.getByRole("link", { name: "Study this deck" }).click();
  await expect(page.getByTestId("study-progress")).toHaveText("0 of 3");

  await context.setOffline(true);
  for (let i = 1; i <= 3; i++) {
    await page.getByRole("button", { name: "Show the answer" }).click();
    await page.getByRole("button", { name: "Good", exact: true }).click();
    await expect(page.getByTestId("study-progress")).toHaveText(`${i} of 3`);
  }
  await expect(page.getByTestId("study-done")).toBeVisible();
  await expect(page.getByTestId("sync-status")).toContainText("3 answers will sync");

  await context.setOffline(false);
  await expect(page.getByTestId("sync-status")).toHaveCount(0, { timeout: 30_000 });

  // the server now has all three: none of the cards is new any more
  await page.goto("/flashcards");
  await page.getByTestId("deck-list").getByRole("link", { name: "Offline deck" }).click();
  await expect(page.getByTestId("deck")).toContainText("3 cards · Nothing due");
  await expect(page.getByTestId("card-list")).not.toContainText("new");
});

test("cram goes through every card without moving the schedule", async ({ page }) => {
  await page.goto("/flashcards");
  await page.getByTestId("deck-list").getByRole("link", { name: "Offline deck" }).click();
  await page.getByRole("link", { name: "Cram" }).click();
  await expect(page.getByText("no scheduling")).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Show the answer" }).click();
    await page.getByRole("button", { name: "Again", exact: true }).click();
  }
  await expect(page.getByTestId("study-done")).toContainText("3 cards crammed.");
  await page.goto("/flashcards");
  await page.getByTestId("deck-list").getByRole("link", { name: "Offline deck" }).click();
  // forgetting in cram mode lowered nothing
  await expect(page.getByTestId("card-list")).not.toContainText("forgotten");
});

test("a deck is exported and imported again as a new deck", async ({ page }) => {
  await page.goto("/flashcards");
  await page.getByTestId("deck-list").getByRole("link", { name: "Offline deck" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("offline-deck.deck.json");
  const path = await file.path();
  const exported = JSON.parse(await readFile(path, "utf8")) as { format: string; cards: unknown[] };
  expect(exported).toMatchObject({ format: "prepquest-deck" });
  expect(exported.cards).toHaveLength(3);

  await page.goto("/flashcards");
  await page.getByTestId("deck-file").setInputFiles(path);
  await expect(
    page.getByTestId("deck-list").getByRole("link", { name: "Offline deck" }),
  ).toHaveCount(2);

  // a file that is not a deck is refused with a clear message
  await page.getByTestId("deck-file").setInputFiles({
    name: "nope.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ not json"),
  });
  await expect(page.getByText("not a PrepQuest deck")).toBeVisible();
});

test("the daily limit holds back new cards and can be changed", async ({ page }) => {
  // five new cards were studied earlier in this run (2 + 3), and the limit counts across decks
  const study = async () => {
    await page.goto("/flashcards");
    await page.getByTestId("deck-list").getByRole("link", { name: "Big-O cheat sheet" }).click();
    await page.getByRole("link", { name: "Study this deck" }).click();
  };
  const setLimit = async (n: string) => {
    await page.goto("/flashcards");
    await page.getByLabel("New cards per day").fill(n);
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByLabel("New cards per day")).toHaveValue(n);
  };
  await setLimit("1");
  await study();
  await expect(page.getByTestId("study-done")).toContainText("done for today");
  await setLimit("6");
  await study();
  await expect(page.getByTestId("study-progress")).toHaveText("0 of 1");
});
