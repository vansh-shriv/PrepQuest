import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RoadmapDto, RoadmapsResponse, QuizAttemptDto } from "@prepquest/shared";
import { seedContent, seedLearning } from "../../test/content.js";
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

const SLUGS = ["two-sum", "valid-parentheses", "three-sum", "merge-intervals"];

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, SLUGS);
  await seedLearning(t);
  ada = (await signupAndLogin(t)).accessToken;
  await verifyAllEmails(t);
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetLearning(t);
  t.app.ai.now = () => new Date();
});

const get = <T>(url: string, token: string | null = ada) =>
  t.app
    .inject({ method: "GET", url: `/v1${url}`, ...(token ? { headers: bearer(token) } : {}) })
    .then((r) => ({ status: r.statusCode, body: r.json<T>() }));

const node = (r: RoadmapDto, id: string) => r.nodes.find((n) => n.id === id)!;

describe("roadmaps (P3)", () => {
  it("lists the roadmaps with a first step for a new learner", async () => {
    const r = await get<RoadmapsResponse>("/roadmaps");
    expect(r.status).toBe(200);
    expect(r.body.roadmaps.map((x) => x.slug)).toEqual(["cs-fundamentals", "sde-dsa-core"]);
    const dsa = r.body.roadmaps.find((x) => x.slug === "sde-dsa-core")!;
    expect(dsa).toMatchObject({ nodes: 11, cleared: 0, mastered: 0 });
    expect(dsa.nextNode?.id).toBe("arrays");
  });

  it("only nodes whose prerequisites are cleared are open", async () => {
    const r = (await get<RoadmapDto>("/roadmaps/sde-dsa-core")).body;
    expect(node(r, "arrays").state).toBe("open");
    expect(node(r, "strings").state).toBe("open");
    const hashing = node(r, "hashing");
    expect(hashing.state).toBe("locked");
    expect(hashing.blockedBy).toEqual(["Arrays"]);
    expect(hashing.layer).toBe(1);
    expect(node(r, "sliding-window").blockedBy.sort()).toEqual([
      "Hashing",
      "Strings",
      "Two pointers",
    ]);
    expect(node(r, "arrays").mastery).toBeNull();
  });

  it("solving problems clears a node and unlocks the next ones", async () => {
    for (const s of ["two-sum", "three-sum", "merge-intervals"]) await solveProblem(t, ada, s);
    const r = (await get<RoadmapDto>("/roadmaps/sde-dsa-core")).body;
    const arrays = node(r, "arrays");
    expect(arrays.mastery).toBeGreaterThanOrEqual(0.8);
    expect(arrays.state).toBe("mastered");
    // topics the solved problems are tagged with are cleared too, which unlocks what builds on them
    expect(node(r, "hashing").state).toBe("mastered");
    expect(node(r, "two-pointers").state).toBe("mastered");
    expect(node(r, "binary-search").state).toBe("open");
    // sliding window also needs strings, which has no solves yet
    expect(node(r, "sliding-window").state).toBe("locked");
    expect(node(r, "sliding-window").blockedBy).toEqual(["Strings"]);
    // the ladder shows only problems that exist, with the last one as the checkpoint
    const ladder = node(r, "hashing").ladder;
    expect(ladder.map((p) => p.slug)).toEqual(["two-sum"]);
    expect(ladder[0]).toMatchObject({ solved: true, checkpoint: true });
    expect(r.nextNode).not.toBe("arrays");
  });

  it("a fundamentals node is measured by quiz accuracy", async () => {
    const before = (await get<RoadmapDto>("/roadmaps/cs-fundamentals")).body;
    expect(node(before, "os").state).toBe("open");
    expect(node(before, "cn").state).toBe("locked");
    expect(node(before, "os").quiz?.href).toBe("/quizzes?subject=os");

    const start = await t.app.inject({
      method: "POST",
      url: "/v1/quizzes/attempts",
      headers: bearer(ada),
      payload: { mode: "practice", subject: "os", count: 12 },
    });
    const attempt = start.json<QuizAttemptDto>();
    for (const q of attempt.questions) {
      const k = (
        await t.pool.query(`SELECT type, answer FROM quiz_questions WHERE id = $1`, [q.id])
      ).rows[0] as { type: string; answer: unknown };
      await t.app.inject({
        method: "POST",
        url: `/v1/quizzes/attempts/${attempt.id}/answers`,
        headers: bearer(ada),
        payload: {
          questionId: q.id,
          response:
            k.type === "blank" || k.type === "output" ? (k.answer as string[])[0] : k.answer,
        },
      });
    }
    await t.app.inject({
      method: "POST",
      url: `/v1/quizzes/attempts/${attempt.id}/finish`,
      headers: bearer(ada),
    });
    const after = (await get<RoadmapDto>("/roadmaps/cs-fundamentals")).body;
    expect(node(after, "os").state).toBe("mastered");
    expect(node(after, "cn").state).toBe("open");
  });

  it("answers 404 for an unknown roadmap and 401 without signing in", async () => {
    expect((await get("/roadmaps/nope")).status).toBe(404);
    expect((await get("/roadmaps", null)).status).toBe(401);
  });
});
