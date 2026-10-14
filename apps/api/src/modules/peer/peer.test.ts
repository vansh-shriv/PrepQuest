import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedBank, seedContent } from "../../test/content.js";
import { Interviews, resetClock, setClock } from "../../test/interviews.js";
import { makeTestApp, signupAndLogin, verifyAllEmails, type TestApp } from "../../test/helpers.js";

// Phase 18: peer mock interviews: availability, matching, invites, the two halves, feedback and safety.

let t: TestApp;
let ada: Interviews;
let bob: Interviews;
let cyd: Interviews;
const ids: Record<string, string> = {};

const MIN = 60_000;
const real = () => Date.now();
const at = (minutes: number) => new Date(real() + minutes * MIN).toISOString();

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses", "three-sum", "climbing-stairs"]);
  await seedBank(t);
  const make = async (email: string, handle: string) => {
    const login = await signupAndLogin(t, { email, handle });
    return { token: login.accessToken, id: (login.body as { user: { id: string } }).user.id };
  };
  const a = await make("ada@example.com", "ada_h");
  const b = await make("bob@example.com", "bob_h");
  const c = await make("cyd@example.com", "cyd_h");
  await verifyAllEmails(t);
  ada = new Interviews(t, a.token);
  bob = new Interviews(t, b.token);
  cyd = new Interviews(t, c.token);
  Object.assign(ids, { ada: a.id, bob: b.id, cyd: c.id });
});
afterAll(() => t.close());
afterEach(() => resetClock(t));
beforeEach(async () => {
  (t.kv as unknown as { data: Map<string, unknown> }).data.clear();
  await t.pool.query("DELETE FROM peer_reports");
  await t.pool.query("DELETE FROM peer_feedback");
  await t.pool.query("UPDATE peer_invites SET session_id = NULL");
  await t.pool.query("DELETE FROM peer_sessions");
  await t.pool.query("DELETE FROM peer_invites");
  await t.pool.query("DELETE FROM peer_blocks");
  await t.pool.query("DELETE FROM peer_availability");
});

const window = (from: number, to: number, extra: Record<string, unknown> = {}) => ({
  startsAt: at(from),
  endsAt: at(to),
  topics: ["dsa"],
  difficulty: 2,
  language: "python",
  ...extra,
});
const free = (who: Interviews, from = 60, to = 240, extra: Record<string, unknown> = {}) =>
  who.call("POST", "/peer/availability", window(from, to, extra));

interface Session {
  id: string;
  state: string;
  topic: string;
  source: string;
  scheduledAt: string;
  partner: { userId: string; handle: string; reputation: { label: string; noShows: number } };
  clock: { half: number | string; you: string; remainingMs: number } | null;
  question: { title: string; statementMd: string } | null;
  panel: { reference: string[]; rubric: string[] } | null;
  questions: { title: string }[] | null;
  consent: { you: boolean; partner: boolean; both: boolean };
  canOpen: boolean;
  canReportNoShow: boolean;
  feedbackGiven: boolean;
  feedbackFromPartner: { comments: string } | null;
}

/** Books a session between ada and bob (ada searches). */
async function booked(minutes = 60): Promise<Session> {
  expect((await free(ada)).statusCode).toBe(201);
  expect((await free(bob, 90, 300)).statusCode).toBe(201);
  const res = await ada.call("POST", "/peer/match", { minutes });
  expect(res.statusCode).toBe(201);
  return res.json<Session>();
}
const startOf = (s: Session) => new Date(s.scheduledAt).getTime();
const get = async (who: Interviews, id: string) =>
  (await who.call("GET", `/peer/sessions/${id}`)).json<Session>();

describe("availability", () => {
  it("adds, lists and removes windows, and refuses windows that make no sense", async () => {
    const res = await free(ada);
    expect(res.statusCode).toBe(201);
    const w = res.json<{ id: string; topics: string[] }>();
    expect(w.topics).toEqual(["dsa"]);
    expect(
      (await ada.call("GET", "/peer/availability")).json<{ items: unknown[] }>().items,
    ).toHaveLength(1);
    expect(
      (await bob.call("GET", "/peer/availability")).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);

    expect((await free(ada, 60, 80)).statusCode).toBe(422); // 20 minutes
    expect((await free(ada, 60, 60 + 9 * 60)).statusCode).toBe(422); // 9 hours
    expect((await free(ada, 240, 60)).statusCode).toBe(422); // ends before it starts
    expect((await free(ada, -300, -100)).statusCode).toBe(422); // already over
    expect((await free(ada, 60, 240, { topics: [] })).statusCode).toBe(422);
    expect((await free(ada, 60, 240, { topics: ["cooking"] })).statusCode).toBe(422);

    expect((await bob.call("DELETE", `/peer/availability/${w.id}`)).statusCode).toBe(404);
    expect((await ada.call("DELETE", `/peer/availability/${w.id}`)).statusCode).toBe(200);
  });

  it("keeps at most 20 open windows", async () => {
    for (let i = 0; i < 20; i++) expect((await free(ada, 60 + i, 240 + i)).statusCode).toBe(201);
    expect((await free(ada)).statusCode).toBe(409);
  });
});

describe("matching", () => {
  it("books a session in the common time, uses the windows up and hides the question", async () => {
    const s = await booked(60);
    expect(s).toMatchObject({ state: "scheduled", topic: "dsa", source: "match" });
    expect(s.partner).toMatchObject({ handle: "bob_h", userId: ids.bob });
    // the common time starts when the later window opens (90 min from now)
    expect(Math.abs(startOf(s) - (real() + 90 * MIN))).toBeLessThan(5_000);
    expect(s.question).toBeNull();
    expect(s.panel).toBeNull();
    expect(s.questions).toBeNull();

    // the partner sees the same session from their side
    const theirs = await get(bob, s.id);
    expect(theirs.partner.handle).toBe("ada_h");

    // what was left of the windows stays open: ada 60-90 is 30 min (too short, dropped), 150-240 is 90 min
    const left = (await ada.call("GET", "/peer/availability")).json<{
      items: { startsAt: string; endsAt: string }[];
    }>().items;
    expect(left).toHaveLength(1);
    expect(Math.abs(new Date(left[0]!.startsAt).getTime() - (real() + 150 * MIN))).toBeLessThan(
      5_000,
    );
  });

  it("answers 409 without a window and 404 when nobody fits", async () => {
    expect((await ada.call("POST", "/peer/match", { minutes: 60 })).statusCode).toBe(409);
    await free(ada, 60, 240, { topics: ["hld"] });
    await free(bob, 60, 240, { topics: ["cs"] });
    const res = await ada.call("POST", "/peer/match", { minutes: 60 });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("NO_MATCH");
    expect((await ada.call("POST", "/peer/match", { minutes: 50 })).statusCode).toBe(422);
  });

  it("needs enough common time for the length asked", async () => {
    await free(ada, 60, 150);
    await free(bob, 100, 300); // 50 minutes in common
    expect((await ada.call("POST", "/peer/match", { minutes: 60 })).statusCode).toBe(404);
    expect((await ada.call("POST", "/peer/match", { minutes: 40 })).statusCode).toBe(201);
  });

  it("never pairs people who blocked each other", async () => {
    const s = await booked();
    await t.pool.query("DELETE FROM peer_availability");
    expect((await ada.call("POST", "/peer/blocks", { userId: ids.bob })).statusCode).toBe(200);
    // the block cancelled the booked session
    expect((await get(ada, s.id)).state).toBe("cancelled");
    await free(ada);
    await free(bob);
    expect((await ada.call("POST", "/peer/match", { minutes: 60 })).statusCode).toBe(404);
    expect((await bob.call("POST", "/peer/match", { minutes: 60 })).statusCode).toBe(404);
    expect((await ada.call("DELETE", `/peer/blocks/${ids.bob}`)).statusCode).toBe(200);
    expect((await ada.call("POST", "/peer/match", { minutes: 60 })).statusCode).toBe(201);
  });

  it("will not double-book a person for overlapping times", async () => {
    await booked();
    await free(ada, 100, 300);
    await free(cyd, 100, 300);
    const res = await ada.call("POST", "/peer/match", { minutes: 60 });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("SESSION_CONFLICT");
  });
});

describe("invites", () => {
  const invite = (who: Interviews, extra: Record<string, unknown> = {}) =>
    who.call("POST", "/peer/invites", {
      topic: "cs",
      difficulty: 2,
      minutes: 60,
      scheduledAt: at(120),
      ...extra,
    });

  it("a friend accepts a link once; only a hash is stored", async () => {
    const created = (await invite(ada)).json<{ id: string; token: string; status: string }>();
    expect(created.status).toBe("open");
    const { rows } = await t.pool.query("SELECT token_hash FROM peer_invites");
    expect(rows[0].token_hash).not.toContain(created.token);
    const listed = (await ada.call("GET", "/peer/invites")).json<{
      items: Record<string, unknown>[];
    }>();
    expect(JSON.stringify(listed)).not.toContain(created.token);

    const preview = (await bob.call("GET", `/peer/invites/${created.token}`)).json<{
      owner: string;
      topic: string;
    }>();
    expect(preview).toMatchObject({ owner: "ada_h", topic: "cs" });
    const accepted = await bob.call("POST", `/peer/invites/${created.token}/accept`);
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json<Session>()).toMatchObject({ source: "invite", topic: "cs" });
    expect(accepted.json<Session>().partner.handle).toBe("ada_h");

    // a used link looks like an unknown one
    expect((await cyd.call("POST", `/peer/invites/${created.token}/accept`)).statusCode).toBe(404);
    expect((await cyd.call("GET", `/peer/invites/${created.token}`)).statusCode).toBe(404);
    expect(
      (await ada.call("GET", "/peer/invites")).json<{ items: { status: string }[] }>().items[0]!
        .status,
    ).toBe("accepted");
  });

  it("refuses your own link, a revoked link, an expired link and a time that is too near or too far", async () => {
    const own = (await invite(ada)).json<{ token: string; id: string }>();
    expect((await ada.call("POST", `/peer/invites/${own.token}/accept`)).statusCode).toBe(422);
    expect((await ada.call("DELETE", `/peer/invites/${own.id}`)).statusCode).toBe(200);
    expect((await bob.call("POST", `/peer/invites/${own.token}/accept`)).statusCode).toBe(404);

    const soon = (await invite(ada, { scheduledAt: at(120) })).json<{ token: string }>();
    setClock(t, new Date(real() + 121 * MIN));
    expect((await bob.call("POST", `/peer/invites/${soon.token}/accept`)).statusCode).toBe(404);
    resetClock(t);

    expect((await invite(ada, { scheduledAt: at(5) })).statusCode).toBe(422);
    expect((await invite(ada, { scheduledAt: at(60 * 24 * 40) })).statusCode).toBe(422);
    expect((await bob.call("DELETE", `/peer/invites/${own.id}`)).statusCode).toBe(404);
  });

  it("does not let a blocked person accept", async () => {
    const s = await booked();
    await bob.call("POST", "/peer/blocks", { userId: ids.ada });
    expect((await get(bob, s.id)).state).toBe("cancelled");
    const inv = (await invite(ada, { scheduledAt: at(600) })).json<{ token: string }>();
    expect((await bob.call("POST", `/peer/invites/${inv.token}/accept`)).statusCode).toBe(404);
  });
});

describe("the session", () => {
  it("opens shortly before the start, then shows each person only their own side", async () => {
    const s = await booked();
    expect((await ada.call("POST", `/peer/sessions/${s.id}/open`)).statusCode).toBe(409); // too early
    setClock(t, new Date(startOf(s) - 5 * MIN));
    const a = (await ada.call("POST", `/peer/sessions/${s.id}/open`)).json<Session>();
    expect(a.state).toBe("live");
    expect(a.question).toBeNull(); // the clock has not started yet
    setClock(t, new Date(startOf(s) + 2 * MIN));
    await bob.call("POST", `/peer/sessions/${s.id}/open`);

    const [first, second] = [await get(ada, s.id), await get(bob, s.id)];
    expect(first.clock!.half).toBe(1);
    const candidate = first.clock!.you === "candidate" ? first : second;
    const interviewer = first.clock!.you === "candidate" ? second : first;
    expect(candidate.clock!.you).toBe("candidate");
    expect(interviewer.clock!.you).toBe("interviewer");
    expect(candidate.question!.statementMd.length).toBeGreaterThan(10);
    expect(candidate.panel).toBeNull(); // the candidate never gets the cheat panel
    expect(interviewer.panel!.rubric.length).toBeGreaterThan(0);
    expect(interviewer.question!.title).toBe(candidate.question!.title);
    expect(JSON.stringify(candidate)).not.toContain("reference");

    // half time: roles swap and the second question appears
    setClock(t, new Date(startOf(s) + 31 * MIN));
    const [swappedA, swappedB] = [await get(ada, s.id), await get(bob, s.id)];
    expect(swappedA.clock).toMatchObject({
      half: 2,
      you: first.clock!.you === "candidate" ? "interviewer" : "candidate",
    });
    expect(swappedA.question!.title).not.toBe(first.question!.title);
    expect(swappedB.clock!.you).toBe(
      first.clock!.you === "candidate" ? "candidate" : "interviewer",
    );

    // the end: the review shows both questions
    const done = (await ada.call("POST", `/peer/sessions/${s.id}/complete`)).json<Session>();
    expect(done.state).toBe("completed");
    expect(done.questions).toHaveLength(2);
    expect(done.question).toBeNull();
  });

  it("is private to its two people", async () => {
    const s = await booked();
    expect((await cyd.call("GET", `/peer/sessions/${s.id}`)).statusCode).toBe(404);
    expect((await cyd.call("POST", `/peer/sessions/${s.id}/cancel`)).statusCode).toBe(404);
    expect((await cyd.call("GET", `/peer/sessions/${s.id}/calendar.ics`)).statusCode).toBe(404);
    expect(
      (await cyd.call("GET", "/peer/sessions")).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);
  });

  it("cancels before the start and not after", async () => {
    const s = await booked();
    expect((await ada.call("POST", `/peer/sessions/${s.id}/cancel`)).json<Session>().state).toBe(
      "cancelled",
    );
    expect((await ada.call("POST", `/peer/sessions/${s.id}/cancel`)).statusCode).toBe(409);
    expect((await ada.call("POST", `/peer/sessions/${s.id}/open`)).statusCode).toBe(409);
  });

  it("closes a session nobody ended once its time and a grace period are over", async () => {
    const s = await booked();
    setClock(t, new Date(startOf(s) + 1 * MIN));
    await ada.call("POST", `/peer/sessions/${s.id}/open`);
    setClock(t, new Date(startOf(s) + 60 * MIN + 16 * MIN));
    expect((await get(ada, s.id)).state).toBe("completed");
  });

  it("builds a calendar file for an upcoming session", async () => {
    const s = await booked();
    const res = await ada.call("GET", `/peer/sessions/${s.id}/calendar.ics`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/calendar/);
    expect(res.body).toMatch(
      /BEGIN:VEVENT[\s\S]*SUMMARY:PrepQuest peer mock with bob_h[\s\S]*TRIGGER:-PT15M/,
    );
    await ada.call("POST", `/peer/sessions/${s.id}/cancel`);
    expect((await ada.call("GET", `/peer/sessions/${s.id}/calendar.ics`)).statusCode).toBe(409);
  });
});

describe("no-shows", () => {
  it("a partner who never opens the room is reported after 15 minutes, and it counts against them", async () => {
    const s = await booked();
    setClock(t, new Date(startOf(s) - 2 * MIN));
    await ada.call("POST", `/peer/sessions/${s.id}/open`);
    setClock(t, new Date(startOf(s) + 14 * MIN));
    expect((await get(ada, s.id)).canReportNoShow).toBe(false);
    expect((await ada.call("POST", `/peer/sessions/${s.id}/no-show`)).statusCode).toBe(409);
    setClock(t, new Date(startOf(s) + 16 * MIN));
    expect((await get(ada, s.id)).canReportNoShow).toBe(true);
    // someone who was not there cannot claim it
    expect((await bob.call("POST", `/peer/sessions/${s.id}/no-show`)).statusCode).toBe(409);
    const res = await ada.call("POST", `/peer/sessions/${s.id}/no-show`);
    expect(res.json<Session>().state).toBe("no_show");
    expect((await bob.call("GET", "/peer/reputation")).json<{ noShows: number }>().noShows).toBe(1);
    expect((await ada.call("GET", "/peer/reputation")).json<{ noShows: number }>().noShows).toBe(0);
  });
});

describe("consent, feedback and reputation", () => {
  const good = {
    ratings: { punctuality: 5, helpfulness: 4, preparedness: 3 },
    comments:
      "You explained the hash map idea clearly at the start, but when you coded the loop you skipped the empty input check, so try listing edge cases first.",
  };
  async function completed() {
    const s = await booked();
    setClock(t, new Date(startOf(s) + MIN));
    await ada.call("POST", `/peer/sessions/${s.id}/open`);
    await bob.call("POST", `/peer/sessions/${s.id}/open`);
    await ada.call("POST", `/peer/sessions/${s.id}/complete`);
    return s;
  }

  it("needs both people to agree before AI may look at the session", async () => {
    const s = await booked();
    expect((await get(ada, s.id)).consent).toEqual({ you: false, partner: false, both: false });
    const a = (
      await ada.call("POST", `/peer/sessions/${s.id}/consent`, { ai: true })
    ).json<Session>();
    expect(a.consent).toEqual({ you: true, partner: false, both: false });
    expect((await get(bob, s.id)).consent).toEqual({ you: false, partner: true, both: false });
    const b = (
      await bob.call("POST", `/peer/sessions/${s.id}/consent`, { ai: true })
    ).json<Session>();
    expect(b.consent.both).toBe(true);
    const withdrawn = (
      await ada.call("POST", `/peer/sessions/${s.id}/consent`, { ai: false })
    ).json<Session>();
    expect(withdrawn.consent.both).toBe(false);
  });

  it("opens feedback after the session, nudges vague feedback and sends it when confirmed", async () => {
    const s = await booked();
    expect((await ada.call("POST", `/peer/sessions/${s.id}/feedback`, good)).statusCode).toBe(409);
    await t.pool.query("UPDATE peer_sessions SET state = 'completed' WHERE id = $1", [s.id]);

    const vague = {
      ratings: { punctuality: 5, helpfulness: 5, preparedness: 5 },
      comments: "Good job",
    };
    const first = (await ada.call("POST", `/peer/sessions/${s.id}/feedback`, vague)).json<{
      saved: boolean;
      nudges: { code: string }[];
    }>();
    expect(first.saved).toBe(false);
    expect(first.nudges.map((n) => n.code)).toEqual(expect.arrayContaining(["short", "uniform"]));
    expect((await get(ada, s.id)).feedbackGiven).toBe(false);

    const sent = (
      await ada.call("POST", `/peer/sessions/${s.id}/feedback`, { ...vague, confirmed: true })
    ).json<{ saved: boolean }>();
    expect(sent.saved).toBe(true);
    expect(
      (await ada.call("POST", `/peer/sessions/${s.id}/feedback`, { ...good, confirmed: true }))
        .statusCode,
    ).toBe(409);
    expect((await get(ada, s.id)).feedbackGiven).toBe(true);
    expect((await cyd.call("POST", `/peer/sessions/${s.id}/feedback`, good)).statusCode).toBe(404);
  });

  it("shows the partner's feedback only after you have written yours, and builds a reputation", async () => {
    const s = await completed();
    expect(
      (await bob.call("POST", `/peer/sessions/${s.id}/feedback`, good)).json<{ saved: boolean }>()
        .saved,
    ).toBe(true);
    expect(
      (await ada.call("GET", `/peer/sessions/${s.id}`)).json<Session>().feedbackFromPartner,
    ).toBeNull();
    expect(
      (await ada.call("POST", `/peer/sessions/${s.id}/feedback`, good)).json<{ saved: boolean }>()
        .saved,
    ).toBe(true);
    const seen = await get(ada, s.id);
    expect(seen.feedbackFromPartner!.comments).toContain("hash map");

    const rep = (await ada.call("GET", "/peer/reputation")).json<{
      sessions: number;
      rating: number;
      label: string;
    }>();
    expect(rep).toMatchObject({ sessions: 1, label: "new" }); // nobody is judged on one session
    expect(rep.rating).toBeGreaterThan(3.5);
    expect(seen.partner.reputation.label).toBe("new");
  });
});

describe("safety", () => {
  it("reports go to reviewers, only about people you shared a session with", async () => {
    const s = await booked();
    expect(
      (await ada.call("POST", "/peer/report", { userId: ids.cyd, reason: "abuse" })).statusCode,
    ).toBe(404);
    expect(
      (await ada.call("POST", "/peer/report", { userId: ids.ada, reason: "abuse" })).statusCode,
    ).toBe(422);
    expect(
      (
        await ada.call("POST", "/peer/report", {
          userId: ids.bob,
          sessionId: s.id,
          reason: "harassment",
          details: "Rude comments.",
        })
      ).statusCode,
    ).toBe(200);
    const { rows } = await t.pool.query("SELECT reason, status FROM peer_reports");
    expect(rows).toEqual([{ reason: "harassment", status: "open" }]);
    // a report does not change what happens to the reported person
    expect((await get(bob, s.id)).state).toBe("scheduled");
    expect(
      (await ada.call("POST", "/peer/report", { userId: ids.bob, reason: "nonsense" })).statusCode,
    ).toBe(422);
  });

  it("blocking needs a shared session and is listed with a handle", async () => {
    expect((await ada.call("POST", "/peer/blocks", { userId: ids.cyd })).statusCode).toBe(404);
    await booked();
    await ada.call("POST", "/peer/blocks", { userId: ids.bob });
    expect(
      (await ada.call("GET", "/peer/blocks")).json<{ items: { handle: string }[] }>().items,
    ).toEqual([{ userId: ids.bob, handle: "bob_h" }]);
  });

  it("is closed to people who have not verified their email", async () => {
    await t.pool.query("UPDATE users SET email_verified_at = NULL WHERE email = 'cyd@example.com'");
    expect((await cyd.call("GET", "/peer/sessions")).statusCode).toBe(403);
    await verifyAllEmails(t);
  });
});
