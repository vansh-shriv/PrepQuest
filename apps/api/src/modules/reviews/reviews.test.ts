import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ReviewGradeResponse, ReviewsResponse } from "@prepquest/shared";
import { localDay, addDays } from "@prepquest/analytics-core";
import { seedContent } from "../../test/content.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";
import { resetLearning, solveProblem } from "../../test/solve.js";

let t: TestApp;
let ada: string;
let bob: string;

const SLUGS = [
  "two-sum",
  "valid-parentheses",
  "three-sum",
  "climbing-stairs",
  "edit-distance",
  "merge-intervals",
];

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, SLUGS);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetLearning(t);
  t.app.ai.now = () => new Date();
});

const call = <T>(
  method: "GET" | "POST" | "PUT",
  url: string,
  token: string | null,
  payload?: object,
) =>
  t.app
    .inject({
      method,
      url: `/v1${url}`,
      ...(token ? { headers: bearer(token) } : {}),
      ...(payload ? { payload } : {}),
    })
    .then((r) => ({ status: r.statusCode, body: r.json<T>() }));

const reviews = async (token = ada) => {
  const r = await call<ReviewsResponse>("GET", "/me/reviews", token);
  expect(r.status).toBe(200);
  return r.body;
};
const pastDue = (slug: string, daysAgo: number) =>
  t.pool.query(
    `UPDATE srs_cards SET due_on = (current_date - $2::int)
     WHERE problem_id = (SELECT id FROM problems WHERE slug = $1)`,
    [slug, daysAgo],
  );
const cardRow = async (slug: string) =>
  (
    await t.pool.query(
      `SELECT c.* FROM srs_cards c JOIN problems p ON p.id = c.problem_id WHERE p.slug = $1`,
      [slug],
    )
  ).rows[0];

describe("spaced repetition (D6)", () => {
  it("a first accepted solve makes a card that is due tomorrow", async () => {
    expect((await reviews()).stats.cards).toBe(0);
    await solveProblem(t, ada, "two-sum");
    const r = await reviews();
    expect(r.stats.cards).toBe(1);
    expect(r.due).toHaveLength(0);
    expect(r.upcoming[0]).toEqual({ date: addDays(r.today, 1), count: 1 });
    const card = await cardRow("two-sum");
    expect(card.interval_days).toBe(1);
    expect(card.repetitions).toBe(1);
  });

  it("a failed submission or a repeat accept does not make another card", async () => {
    await solveProblem(t, ada, "two-sum", "WA");
    expect((await reviews()).stats.cards).toBe(0);
    await solveProblem(t, ada, "two-sum");
    await solveProblem(t, ada, "two-sum");
    expect((await reviews()).stats.cards).toBe(1);
  });

  it("is due on the day, steps 1 day then 3 days, and a lapse starts over", async () => {
    await solveProblem(t, ada, "two-sum");
    const tomorrow = addDays(localDay(new Date(), "UTC"), 1);
    t.app.ai.now = () => new Date(`${tomorrow}T10:00:00Z`);
    const due = await reviews();
    expect(due.today).toBe(tomorrow);
    expect(due.due.map((c) => c.problem.slug)).toEqual(["two-sum"]);
    const id = due.due[0]!.id;

    const good = await call<ReviewGradeResponse>("POST", `/me/reviews/${id}/grade`, ada, {
      rating: "good",
    });
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({
      intervalDays: 3,
      lapsed: false,
      dueOn: addDays(tomorrow, 3),
    });
    expect((await reviews()).due).toHaveLength(0);

    // three days later a failure goes back to one day and lowers the ease by 0.2
    const later = addDays(tomorrow, 3);
    t.app.ai.now = () => new Date(`${later}T10:00:00Z`);
    const before = Number((await cardRow("two-sum")).ease);
    const again = await call<ReviewGradeResponse>("POST", `/me/reviews/${id}/grade`, ada, {
      rating: "again",
    });
    expect(again.body).toMatchObject({ intervalDays: 1, lapsed: true, lapses: 1 });
    expect(Number((await cardRow("two-sum")).ease)).toBeCloseTo(Math.max(1.3, before - 0.2), 2);
    expect(again.body.dueOn).toBe(addDays(later, 1));
  });

  it("refuses a review that is not due, a paused card and someone else's card", async () => {
    await solveProblem(t, ada, "two-sum");
    const card = await cardRow("two-sum");
    const early = await call<{ error: { code: string } }>(
      "POST",
      `/me/reviews/${card.id}/grade`,
      ada,
      { rating: "good" },
    );
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("NOT_DUE");

    await pastDue("two-sum", 1);
    const stranger = await call("POST", `/me/reviews/${card.id}/grade`, bob, { rating: "good" });
    expect(stranger.status).toBe(404);

    await call("POST", `/me/reviews/${card.id}/suspend`, ada, { suspended: true });
    const paused = await call<{ error: { code: string } }>(
      "POST",
      `/me/reviews/${card.id}/grade`,
      ada,
      { rating: "good" },
    );
    expect(paused.body.error.code).toBe("SUSPENDED");
    const r = await reviews();
    expect(r.due).toHaveLength(0);
    expect(r.paused.map((c) => c.problem.slug)).toEqual(["two-sum"]);
    await call("POST", `/me/reviews/${card.id}/suspend`, ada, { suspended: false });
    expect((await reviews()).due).toHaveLength(1);
  });

  it("never asks for more than the daily cap, and the rest carries over", async () => {
    for (const s of ["two-sum", "valid-parentheses", "three-sum", "climbing-stairs"])
      await solveProblem(t, ada, s);
    for (const [i, s] of ["two-sum", "valid-parentheses", "three-sum", "climbing-stairs"].entries())
      await pastDue(s, i + 1);
    expect((await call("PUT", "/me/reviews/settings", ada, { cap: 2 })).status).toBe(200);
    const r = await reviews();
    expect(r.cap).toBe(2);
    expect(r.due).toHaveLength(2);
    expect(r.waiting).toBe(2);
    // the most overdue come first
    expect(r.due.map((c) => c.problem.slug)).toEqual(["climbing-stairs", "three-sum"]);

    await call("POST", `/me/reviews/${r.due[0]!.id}/grade`, ada, { rating: "good" });
    const after = await reviews();
    expect(after.doneToday).toBe(1);
    expect(after.due).toHaveLength(1);
    await call("POST", `/me/reviews/${after.due[0]!.id}/grade`, ada, { rating: "good" });
    const done = await reviews();
    expect(done.due).toHaveLength(0);
    expect(done.waiting).toBe(2);
  });

  it("validates the cap", async () => {
    expect((await call("PUT", "/me/reviews/settings", ada, { cap: 0 })).status).toBe(422);
    expect((await call("PUT", "/me/reviews/settings", ada, { cap: 99 })).status).toBe(422);
  });

  it("snoozing pushes the card out and never pulls it in", async () => {
    await solveProblem(t, ada, "two-sum");
    const card = await cardRow("two-sum");
    await pastDue("two-sum", 2);
    const r1 = await call<{ dueOn: string }>("POST", `/me/reviews/${card.id}/snooze`, ada, {
      days: 5,
    });
    expect(r1.body.dueOn).toBe(addDays(localDay(new Date(), "UTC"), 5));
    const r2 = await call<{ dueOn: string }>("POST", `/me/reviews/${card.id}/snooze`, ada, {
      days: 1,
    });
    expect(r2.body.dueOn).toBe(r1.body.dueOn);
    expect((await reviews()).due).toHaveLength(0);
  });

  it("solving a due problem again is its review, graded from how the attempt went", async () => {
    await solveProblem(t, ada, "two-sum");
    await pastDue("two-sum", 1);
    await solveProblem(t, ada, "two-sum", "WA");
    await solveProblem(t, ada, "two-sum");
    const rows = (await t.pool.query(`SELECT quality, source FROM srs_reviews`)).rows;
    expect(rows).toEqual([{ quality: 3, source: "auto" }]);
    const card = await cardRow("two-sum");
    expect(card.repetitions).toBe(2);
    expect(card.interval_days).toBe(3);
  });

  it("solving a problem that is not due yet is not a review", async () => {
    await solveProblem(t, ada, "two-sum");
    await solveProblem(t, ada, "two-sum");
    expect((await t.pool.query(`SELECT 1 FROM srs_reviews`)).rowCount).toBe(0);
  });

  it("the self-rating after a solve sets the card's ease until it is first reviewed", async () => {
    await solveProblem(t, ada, "two-sum");
    expect(Number((await cardRow("two-sum")).ease)).toBe(2.5);
    const easy = await call("POST", "/problems/two-sum/rating", ada, { rating: "easy" });
    expect(easy.status).toBe(200);
    expect(Number((await cardRow("two-sum")).ease)).toBe(2.6);
    await call("POST", "/problems/two-sum/rating", ada, { rating: "again" });
    expect(Number((await cardRow("two-sum")).ease)).toBeLessThan(2.1);
  });

  it("due days follow the learner's time zone", async () => {
    await t.pool.query(
      `UPDATE profiles SET timezone = 'Pacific/Kiritimati' WHERE user_id = (SELECT id FROM users WHERE email = 'ada@example.com')`,
    );
    const now = new Date();
    t.app.ai.now = () => now;
    const r = await reviews();
    expect(r.today).toBe(localDay(now, "Pacific/Kiritimati"));
    await solveProblem(t, ada, "two-sum");
    const after = await reviews();
    expect(after.upcoming[0]).toEqual({ date: addDays(after.today, 1), count: 1 });
  });

  it("solves from before spaced repetition get a card", async () => {
    await solveProblem(t, ada, "two-sum");
    await t.pool.query(`DELETE FROM srs_cards`);
    expect((await reviews()).stats.cards).toBe(1);
  });

  it("requires signing in", async () => {
    expect((await call("GET", "/me/reviews", null)).status).toBe(401);
  });
});
