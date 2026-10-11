import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedBank, seedContent } from "../../test/content.js";
import { Interviews, readyResume, resetClock } from "../../test/interviews.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";

let t: TestApp;
let ada: Interviews;
let bob: Interviews;
let adaToken: string;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses", "three-sum", "climbing-stairs"]);
  await seedBank(t);
  adaToken = (await signupAndLogin(t)).accessToken;
  const bobToken = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" }))
    .accessToken;
  await verifyAllEmails(t);
  ada = new Interviews(t, adaToken);
  bob = new Interviews(t, bobToken);
});
afterAll(() => t.close());
afterEach(() => resetClock(t));
beforeEach(async () => {
  await t.pool.query("DELETE FROM interview_sessions");
  await t.pool.query("DELETE FROM question_memory");
  await t.pool.query("DELETE FROM company_packs WHERE provisional");
  await t.pool.query("UPDATE user_settings SET personalized_callbacks = true");
  t.mock.overrides.clear();
  t.mock.calls.length = 0;
});

interface Plan {
  type: string;
  minutes: number;
  questions: {
    kind: string;
    slug?: string;
    title: string;
    sourceRef?: string;
    category?: string;
    topic?: string;
  }[];
  pack: { slug: string; title: string; provisional: boolean } | null;
  packEffects: string[];
  rubricWeights: { key: string; name: string; weight: number }[];
  warnings: string[];
}
const preview = async (body: Record<string, unknown>) => {
  const res = await ada.call("POST", "/interviews/plan", body);
  return { res, plan: res.json<Plan>() };
};

describe("packs", () => {
  it("lists the curated company packs with their disclaimer", async () => {
    const res = await ada.call("GET", "/interview/company-packs");
    const items = res.json<{
      items: { slug: string; provisional: boolean; disclaimer: string; topWeights: unknown[] }[];
    }>().items;
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.every((p) => !p.provisional && /not an official/i.test(p.disclaimer))).toBe(true);
    expect(items.map((p) => p.slug)).toContain("product-high-bar");
  });

  it("changes the preview visibly: emphasis, hints, weights and pitfalls", async () => {
    const plain = await preview({ type: "dsa", minutes: 30 });
    const withPack = await preview({ type: "dsa", minutes: 30, packSlug: "product-high-bar" });
    expect(plain.plan.packEffects).toEqual([]);
    expect(plain.plan.pack).toBeNull();
    expect(withPack.plan.pack).toMatchObject({ slug: "product-high-bar", provisional: false });
    expect(withPack.plan.packEffects.join(" ")).toMatch(/Hints: sparse/);
    const w = (p: Plan, k: string) => p.rubricWeights.find((x) => x.key === k)!.weight;
    expect(w(plain.plan, "problem_solving")).toBe(25);
    expect(w(withPack.plan, "problem_solving")).toBe(30);
    expect(withPack.plan.rubricWeights.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(100, 0);
    expect(withPack.plan.warnings.join(" ")).toMatch(/clarifying|brute force|complexity/i);
    expect(
      (await ada.call("POST", "/interviews/plan", { type: "dsa", packSlug: "nope" })).statusCode,
    ).toBe(422);
  });

  it("a sparse pack caps hints and the plan carries the pack through to the session", async () => {
    const { body } = await ada.create({ hintBudget: 3, packSlug: "product-high-bar", minutes: 30 });
    expect(body.session.hintBudget).toBe(1);
    const { rows } = await t.pool.query("SELECT plan FROM interview_sessions WHERE id = $1", [
      body.session.id,
    ]);
    expect(rows[0].plan).toMatchObject({
      packSlug: "product-high-bar",
      style: { followUpDepth: 3 },
    });
    expect(rows[0].plan.rubricWeights.problem_solving).toBe(30);
  });

  it("the interviewer is told the pack's style", async () => {
    const id = await ada.startNew({ packSlug: "fintech-systems", minutes: 30 });
    const sys = t.mock.calls.filter((c) => c.task === "interviewer_turn").at(-1)!.system;
    expect(sys).toMatch(/INTERVIEW STYLE:/);
    expect(sys).toMatch(/consistency/);
    await ada.end(id);
  });

  it("scores with the pack's weights, not the model's", async () => {
    const id = await ada.startNew({
      packSlug: "consulting-tech",
      problemSlugs: ["two-sum"],
      minutes: 30,
    });
    await ada.say(id, "Hi, I'm Ada, a final year student who enjoys algorithms.");
    await ada.say(
      id,
      "I would use a hash map to store complements which gives O(n) time and O(n) space.",
    );
    await ada.end(id);
    const review = (await ada.call("GET", `/interviews/${id}/review`)).json<{
      scorecard: { scores: { dimension: string; weight: number }[] };
    }>();
    const w = Object.fromEntries(review.scorecard.scores.map((s) => [s.dimension, s.weight]));
    expect(w.communication).toBe(0.3);
    expect(w.problem_solving).toBe(0.2);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
  });

  it("infers a provisional pack from a free-text target once, flags it, and keeps it private", async () => {
    const first = await preview({ type: "dsa", company: "Initech Systems", role: "SDE" });
    expect(first.plan.pack).toBeNull();
    expect(first.plan.packEffects.join(" ")).toMatch(
      /provisional profile.*inferred when you start/i,
    );
    expect(t.mock.calls.filter((c) => c.task === "pack")).toHaveLength(0); // the preview never calls the model

    const created = await ada.create({ company: "Initech Systems", role: "SDE", minutes: 30 });
    expect(created.res.statusCode, created.res.body).toBe(201);
    expect(t.mock.calls.filter((c) => c.task === "pack")).toHaveLength(1);
    const { rows } = await t.pool.query(
      "SELECT slug, provisional, data FROM company_packs WHERE provisional",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data.disclaimer).toMatch(/Unverified/);
    expect(rows[0].data.interview_style.notes).toMatch(/not facts/i);
    // topics and weights obey the same rules as curated packs
    const sum = Object.values(rows[0].data.rubric_weights as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(sum).toBeCloseTo(1, 2);

    // reused, and now visible in the preview as provisional
    const again = await preview({ type: "dsa", company: "Initech Systems", role: "SDE" });
    expect(again.plan.pack).toMatchObject({ provisional: true });
    await ada.create({ company: "Initech Systems", role: "SDE", minutes: 30 });
    expect(t.mock.calls.filter((c) => c.task === "pack")).toHaveLength(1);

    const mine = (await ada.call("GET", "/interview/company-packs")).json<{
      items: { provisional: boolean }[];
    }>().items;
    expect(mine.some((p) => p.provisional)).toBe(true);
    const theirs = (await bob.call("GET", "/interview/company-packs")).json<{
      items: { provisional: boolean }[];
    }>().items;
    expect(theirs.some((p) => p.provisional)).toBe(false);
    expect(
      (await bob.call("POST", "/interviews/plan", { type: "dsa", packSlug: rows[0].slug }))
        .statusCode,
    ).toBe(422);
  });

  it("falls back to the standard style when the model cannot infer a profile", async () => {
    t.mock.overrides.set("pack", ["nope", "nope", "nope"]);
    const { res, body } = await ada.create({ company: "Hooli", minutes: 30 });
    expect(res.statusCode).toBe(201);
    const { rows } = await t.pool.query("SELECT plan FROM interview_sessions WHERE id = $1", [
      body.session.id,
    ]);
    expect(rows[0].plan.packSlug).toBeNull();
  });
});

describe("question bank rounds", () => {
  it("a CS round asks several short questions from the bank, moving on after the follow-ups", async () => {
    const { plan } = await preview({ type: "cs", minutes: 30 });
    expect(plan.questions).toHaveLength(4);
    expect(plan.questions.every((q) => q.kind === "verbal" && q.category === "cs")).toBe(true);
    expect(new Set(plan.questions.map((q) => q.topic)).size).toBeGreaterThanOrEqual(3);

    const { body } = await ada.create({ type: "cs", minutes: 30 });
    expect(body.session.questions.every((q) => q.hidden)).toBe(true);
    const id = body.session.id;
    await ada.call("POST", `/interviews/${id}/start`);
    await t.idle();
    const r1 = await ada.say(id, "Hi, I'm Ada, a final year student.");
    expect(r1.body.replies.at(-1)?.text).toMatch(/fundamentals question/i);
    expect(r1.body.state).toBe("FOLLOWUP");
    expect((await ada.get(id)).session.questionIndex).toBe(0);
    await ada.say(id, "A process has its own address space while threads share memory.");
    await ada.say(id, "Threads are cheaper to switch but a bug in one can corrupt the others.");
    const third = await ada.say(
      id,
      "Processes give isolation, at the cost of heavier communication.",
    );
    // the cap moved the interview on to the next question by itself
    expect(third.body.replies.at(-1)?.text).toMatch(/fundamentals question/i);
    expect((await ada.get(id)).session.questionIndex).toBe(1);
    // the first question is now visible, the later ones still are not
    const dto = (await ada.get(id)).session;
    expect(dto.questions[0]).toMatchObject({ hidden: false, kind: "verbal" });
    expect(dto.questions[3]?.hidden).toBe(true);
    await ada.end(id);
  });

  it("gives each type its own prompt guidance and keeps the reference answer confidential", async () => {
    const id = await ada.startNew({ type: "cs", minutes: 30 });
    await ada.say(id, "Hello there, nice to meet you.");
    const call = t.mock.calls.filter((c) => c.task === "interviewer_turn").at(-1)!;
    expect(call.system).toMatch(/computer science fundamentals/);
    expect(call.system).toMatch(/Do not teach or correct/);
    expect(call.context).toMatch(/<confidential>Interviewer-only\. Never reveal\./);
    expect(call.context).toMatch(/Reference: /);
    await ada.end(id);
    const b = await ada.startNew({ type: "behavioral", minutes: 30 });
    expect(t.mock.calls.filter((c) => c.task === "interviewer_turn").at(-1)!.system).toMatch(
      /What did YOU do|what did YOU do/,
    );
    await ada.end(b);
  });

  it("a system design round is one long question with no follow-up cap, text only", async () => {
    const { plan } = await preview({ type: "hld", minutes: 60 });
    expect(plan.questions).toHaveLength(1);
    expect(plan.questions[0]).toMatchObject({ kind: "verbal", category: "hld" });
    const id = await ada.startNew({ type: "hld", minutes: 60 });
    await ada.say(id, "Hello, ready to start.");
    for (const msg of [
      "First I would clarify requirements: read-heavy, 100M urls per month.",
      "Estimates: about 40 writes per second and 4000 reads per second.",
      "API: create and redirect; storage in a key-value store sharded by code.",
      "Then caching with a CDN in front of the redirect service.",
      "Trade-off: counter based codes avoid collisions but need coordination.",
    ]) {
      await ada.say(id, msg);
    }
    const s = (await ada.get(id)).session;
    expect(s).toMatchObject({ state: "FOLLOWUP", questionIndex: 0, usesEditor: false });
    expect(
      (
        await ada.call("POST", `/interviews/${id}/events`, {
          kind: "snapshot",
          code: "x",
          language: "python",
        })
      ).statusCode,
    ).toBe(422);
    await ada.end(id);
    const review = (await ada.call("GET", `/interviews/${id}/review`)).json<{
      scorecard: { rubric: { id: string }; scores: { dimension: string }[] };
    }>();
    expect(review.scorecard.rubric.id).toBe("hld");
    expect(review.scorecard.scores.map((x) => x.dimension)).toContain("estimation");
  });

  it("an LLD round uses its own rubric", async () => {
    const id = await ada.startNew({ type: "lld", minutes: 45 });
    await ada.say(id, "Hi there, ready.");
    await ada.say(
      id,
      "Entities: ParkingLot, Level, Spot, Ticket; pricing as a strategy to stay open for extension.",
    );
    await ada.end(id);
    const review = (await ada.call("GET", `/interviews/${id}/review`)).json<{
      scorecard: { rubric: { id: string } };
    }>();
    expect(review.scorecard.rubric.id).toBe("lld");
  });

  it("a resume walk-through needs a confirmed resume and cites resume items", async () => {
    expect((await ada.call("POST", "/interviews/plan", { type: "resume" })).statusCode).toBe(422);
    const resume = await readyResume(t, adaToken);
    const { res, body } = await ada.create({ type: "resume", resumeId: resume, minutes: 30 });
    expect(res.statusCode, res.body).toBe(201);
    const { rows } = await t.pool.query("SELECT plan FROM interview_sessions WHERE id = $1", [
      body.session.id,
    ]);
    expect(rows[0].plan.questions[0].sourceRef).toMatch(/^(projects|experience)\[\d+\]$/);
    const qgen = t.mock.calls.filter((c) => c.task === "qgen").at(-1)!;
    expect(qgen.messages[0]!.content).toMatch(/claim-testing|resume/i);
    await t.pool.query("DELETE FROM resumes");
  });

  it("lets the user choose the questions, and rejects ones from another round", async () => {
    const ok = await preview({
      type: "cs",
      minutes: 30,
      questionSlugs: ["bank:os-deadlock", "dbms-acid"],
    });
    expect(ok.plan.questions.map((q) => q.sourceRef)).toEqual([
      "bank:os-deadlock",
      "bank:dbms-acid",
    ]);
    expect(
      (await ada.call("POST", "/interviews/plan", { type: "cs", questionSlugs: ["beh-failure-1"] }))
        .statusCode,
    ).toBe(422);
    expect(
      (await ada.call("POST", "/interviews/plan", { type: "cs", questionSlugs: ["nope"] }))
        .statusCode,
    ).toBe(422);
  });

  it("a pack decides which behavioural competencies are asked", async () => {
    const wanted = new Set(["customer_focus", "leadership", "ambiguity", "conflict"]);
    for (let i = 0; i < 4; i++) {
      const { plan } = await preview({
        type: "behavioral",
        minutes: 30,
        packSlug: "consulting-tech",
      });
      const { rows } = await t.pool.query(
        "SELECT slug, competency FROM question_bank WHERE slug = ANY($1)",
        [plan.questions.map((q) => (q.sourceRef ?? "").replace("bank:", ""))],
      );
      expect(rows.length).toBe(plan.questions.length);
      for (const r of rows) expect(wanted.has(r.competency), r.slug).toBe(true);
    }
  });
});

describe("question memory", () => {
  it("never repeats a question over consecutive interviews inside the cooldown", async () => {
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = await ada.startNew({ type: "cs", minutes: 30 });
      await ada.say(id, "Hello, I am ready to begin.");
      const { rows } = await t.pool.query("SELECT plan FROM interview_sessions WHERE id = $1", [
        id,
      ]);
      const refs = (rows[0].plan.questions as { sourceRef: string }[])
        .slice(0, 1)
        .map((q) => q.sourceRef);
      await ada.end(id);
      // every question of the session is recorded, so the next plan avoids all of them
      const mem = await t.pool.query("SELECT ref_key FROM question_memory");
      seen.push(...refs);
      void mem;
    }
    const { rows } = await t.pool.query(
      "SELECT ref_key, count(*)::int AS n FROM question_memory GROUP BY ref_key HAVING count(*) > 1",
    );
    expect(rows).toEqual([]);
  });

  it("stores each asked question with an embedding and a topic", async () => {
    const id = await ada.startNew({ type: "behavioral", minutes: 30 });
    await ada.say(id, "Hello, I am ready to begin.");
    await ada.end(id);
    const { rows } = await t.pool.query(
      "SELECT kind, ref_key, topic, embedding IS NOT NULL AS has FROM question_memory",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ kind: "verbal", has: true });
    expect(rows[0].ref_key).toMatch(/^bank:beh-/);
    expect(rows[0].topic).toBeTruthy();
  });

  it("shows the history, lets the user delete an entry or all of it, and keeps it private", async () => {
    const id = await ada.startNew({ type: "cs", minutes: 30 });
    await ada.say(id, "Hello, I am ready to begin.");
    await ada.end(id);
    const items = (await ada.call("GET", "/me/question-history")).json<{
      items: { id: string; questionText: string }[];
    }>().items;
    expect(items.length).toBeGreaterThan(0);
    expect(
      (await bob.call("GET", "/me/question-history")).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);
    expect((await bob.call("DELETE", `/me/question-history/${items[0]!.id}`)).statusCode).toBe(404);
    expect((await ada.call("DELETE", `/me/question-history/${items[0]!.id}`)).statusCode).toBe(204);
    expect(
      (await ada.call("GET", "/me/question-history")).json<{ items: unknown[] }>().items,
    ).toHaveLength(items.length - 1);
    const cleared = await ada.call("DELETE", "/me/question-history");
    expect(cleared.json<{ deleted: number }>().deleted).toBe(items.length - 1);
  });

  it("a weak question comes back as a callback, unless the user turned callbacks off", async () => {
    const id = await ada.startNew({
      type: "cs",
      minutes: 30,
      questionSlugs: ["os-deadlock", "dbms-acid"],
    });
    await ada.say(id, "Hello, I am ready to begin.");
    await ada.say(
      id,
      "A deadlock is when two processes wait on each other forever without ever progressing.",
    );
    t.mock.overrides.set("ideal", [
      JSON.stringify({
        answers: [
          {
            question_index: 0,
            user_answer_summary: "Short definition only.",
            ideal_md:
              "State the four conditions, give an example, and describe prevention by lock ordering.",
            gaps: ["four conditions", "an example", "prevention", "detection"],
            extras: [],
            star_rewrite_md: null,
            added_suggestions: [],
          },
        ],
      }),
    ]);
    await ada.end(id);
    const weak = await t.pool.query("SELECT ref_key, weak FROM question_memory WHERE weak");
    expect(weak.rows.map((r) => r.ref_key)).toContain("bank:os-deadlock");

    const next = await ada.create({ type: "cs", minutes: 30 });
    const { rows } = await t.pool.query("SELECT plan FROM interview_sessions WHERE id = $1", [
      next.body.session.id,
    ]);
    expect(rows[0].plan.callbacks.join(" ")).toMatch(/struggled with the topic of os/);
    await ada.call("POST", `/interviews/${next.body.session.id}/start`);
    await t.idle();
    expect(
      t.mock.calls
        .filter((c) => c.task === "interviewer_turn")
        .at(-1)!
        .messages.at(-1)!.content,
    ).toMatch(/<memory>[^<]*struggled with/);
    await ada.end(next.body.session.id);

    // turn it off: no reference to the past reaches the prompt
    const off = await ada.call("PATCH", "/me/settings", { personalizedCallbacks: false });
    expect(off.statusCode, off.body).toBe(200);
    const again = await ada.create({ type: "cs", minutes: 30 });
    const stored = await t.pool.query("SELECT plan FROM interview_sessions WHERE id = $1", [
      again.body.session.id,
    ]);
    expect(stored.rows[0].plan.callbacks).toEqual([]);
    t.mock.calls.length = 0;
    await ada.call("POST", `/interviews/${again.body.session.id}/start`);
    await t.idle();
    const prompts = t.mock.calls
      .map((c) => `${c.system}\n${c.context}\n${c.messages.map((m) => m.content).join("\n")}`)
      .join("\n");
    expect(prompts).not.toMatch(/struggled with/);
    void bearer;
  });
});
