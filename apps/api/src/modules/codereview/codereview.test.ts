import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobSummary, JudgeJob, TestResult } from "@prepquest/judge-core";
import type {
  CodeReviewDto,
  ComplexityDto,
  SubmissionCreated,
  SubmissionListResponse,
} from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";
import { resetLearning } from "../../test/solve.js";
import { applyJudgeEvent } from "../submissions/ingest.js";

let t: TestApp;
let ada: string;
let bob: string;
let carol: string;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "climbing-stairs"]);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
  // carol never verifies her email
  carol = (await signupAndLogin(t, { email: "carol@example.com", handle: "carol_h" })).accessToken;
});
afterAll(() => t.close());

beforeEach(async () => {
  await resetLearning(t);
  await t.pool.query("DELETE FROM llm_usage");
  await t.pool.query("UPDATE user_settings SET review_strictness = 'strict'");
  t.mock.overrides.clear();
  t.mock.calls.length = 0;
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

const NESTED = `class Solution:
    def twoSum(self, nums, target):
        for i in range(len(nums)):
            for j in range(i + 1, len(nums)):
                if nums[i] + nums[j] == target:
                    return [i, j]
        return []
`;

const result = (ordinal: number, over: Partial<TestResult> = {}): TestResult => ({
  ordinal,
  kind: "custom",
  verdict: "AC",
  timeMs: 5,
  memoryKb: 2048,
  ...over,
});

const lastJob = (): JudgeJob => t.judge.jobs[t.judge.jobs.length - 1]!.job;

async function finish(job: JudgeJob, verdict: JobSummary["verdict"], results?: TestResult[]) {
  const rows = results ?? job.tests.map((x) => result(x.ordinal, { kind: x.kind }));
  await applyJudgeEvent(t.db, {
    type: "done",
    submissionId: job.submissionId,
    summary: {
      verdict,
      passed: verdict === "AC" ? rows.length : 0,
      total: rows.length,
      timeMs: 5,
      memoryKb: 2048,
      failingOrdinal: verdict === "AC" ? null : 1,
      compileOutput: null,
      stderrTail: null,
      results: rows,
    },
  });
}

/** Submits code and has the judge answer; returns the submission id. */
async function submitCode(
  token: string,
  code = NESTED,
  verdict: JobSummary["verdict"] = "AC",
  slug = "two-sum",
) {
  const res = await call<SubmissionCreated>("POST", "/submissions", token, {
    problemSlug: slug,
    language: "python",
    code,
    kind: "submit",
  });
  expect(res.status).toBe(202);
  await finish(lastJob(), verdict);
  return res.body.submissionId;
}

const review = async (token: string, id: string, strictness?: string) =>
  call<CodeReviewDto>("POST", `/submissions/${id}/review`, token, strictness ? { strictness } : {});
const readReview = async (token: string, id: string) =>
  (await call<{ review: CodeReviewDto | null }>("GET", `/submissions/${id}/review`, token)).body
    .review;

describe("code review (X3)", () => {
  it("needs sign-in and a verified email", async () => {
    const id = await submitCode(ada);
    expect((await call("POST", `/submissions/${id}/review`, null, {})).status).toBe(401);
    const mine = await submitCode(carol);
    expect((await review(carol, mine)).status).toBe(403);
  });

  it("writes line comments about the real code and keeps them inside the file", async () => {
    const id = await submitCode(ada);
    const res = await review(ada, id);
    expect(res.status).toBe(202);
    // the mock model answers so fast that the review may already be done
    expect(res.body).toMatchObject({ strictness: "strict" });
    expect(["pending", "ready"]).toContain(res.body.status);
    await t.idle();

    const done = (await readReview(ada, id))!;
    expect(done.status).toBe("ready");
    expect(done.summary).toBeTruthy();
    const lines = NESTED.split("\n").length;
    expect(done.comments.length).toBeGreaterThan(0);
    for (const c of done.comments) {
      expect(c.line).toBeGreaterThanOrEqual(1);
      expect(c.line).toBeLessThanOrEqual(lines);
    }
    expect(done.comments).toContainEqual(
      expect.objectContaining({ line: 4, severity: "important", category: "complexity" }),
    );
    expect(Object.keys(done.ratings).sort()).toEqual([
      "complexity",
      "edge-cases",
      "idioms",
      "maintainability",
      "presentation",
      "readability",
    ]);

    // the model sees numbered code and the verdict, and no test data
    const prompt = t.mock.calls.find((c) => c.task === "code_review")!.messages[0]!.content;
    expect(prompt).toContain("4|             for j in range");
    expect(prompt).toContain("verdict on this code: AC");
    expect(prompt).not.toContain("hidden");
  });

  it("returns the same review for the same submission and strictness without another model call", async () => {
    const id = await submitCode(ada);
    await review(ada, id);
    await t.idle();
    const before = t.mock.calls.filter((c) => c.task === "code_review").length;
    const again = await review(ada, id);
    expect(again.body.status).toBe("ready");
    expect(t.mock.calls.filter((c) => c.task === "code_review")).toHaveLength(before);

    // a different strictness is a different review
    const gentle = await review(ada, id, "gentle");
    await t.idle();
    expect(gentle.body.strictness).toBe("gentle");
    expect(t.mock.calls.filter((c) => c.task === "code_review")).toHaveLength(before + 1);
    const g = (await readReview(ada, id))!;
    expect(g.comments.every((c) => c.severity !== "nit")).toBe(true);
  });

  it("uses the saved strictness when none is given", async () => {
    expect(
      (await call("PUT", "/code-review/settings", ada, { strictness: "pedantic" })).status,
    ).toBe(200);
    expect((await call<{ strictness: string }>("GET", "/code-review/settings", ada)).body).toEqual({
      strictness: "pedantic",
    });
    const id = await submitCode(ada);
    expect((await review(ada, id)).body.strictness).toBe("pedantic");
    await t.idle();
    expect((await call("PUT", "/code-review/settings", ada, { strictness: "harsh" })).status).toBe(
      422,
    );
  });

  it("asks the model again when it points at a line that does not exist", async () => {
    const bad = {
      summary: "Fine.",
      ratings: {
        readability: 3,
        idioms: 3,
        complexity: 3,
        "edge-cases": 3,
        maintainability: 3,
        presentation: 3,
      },
      comments: [{ line: 99, severity: "nit", category: "readability", message: "Rename this." }],
      refactor: null,
    };
    t.mock.overrides.set("code_review", [JSON.stringify(bad)]);
    const id = await submitCode(ada);
    await review(ada, id);
    await t.idle();
    const done = (await readReview(ada, id))!;
    expect(done.status).toBe("ready");
    expect(done.comments.every((c) => c.line <= NESTED.split("\n").length)).toBe(true);
    expect(t.mock.calls.filter((c) => c.task === "code_review")).toHaveLength(2);
  });

  it("reports a failure plainly and lets the learner try again", async () => {
    t.mock.overrides.set("code_review", ["not json", "still not json", "nope"]);
    const id = await submitCode(ada);
    await review(ada, id);
    await t.idle();
    const failed = (await readReview(ada, id))!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("could not be written");
    expect(failed.comments).toEqual([]);

    await review(ada, id);
    await t.idle();
    expect((await readReview(ada, id))!.status).toBe("ready");
  });

  it("reports a review whose job was lost as failed so it can be retried", async () => {
    const id = await submitCode(ada);
    await review(ada, id);
    await t.idle();
    // the updated_at trigger would reset the clock, so switch it off while ageing the row
    await t.pool.query("ALTER TABLE code_reviews DISABLE TRIGGER code_reviews_set_updated_at");
    await t.pool.query(
      "UPDATE code_reviews SET status = 'pending', updated_at = now() - interval '10 minutes' WHERE submission_id = $1",
      [id],
    );
    await t.pool.query("ALTER TABLE code_reviews ENABLE TRIGGER code_reviews_set_updated_at");
    const stale = (await readReview(ada, id))!;
    expect(stale.status).toBe("failed");
    expect(stale.error).toContain("too long");
    await review(ada, id);
    await t.idle();
    expect((await readReview(ada, id))!.status).toBe("ready");
  });

  it("shows a refactor only after the judge accepts it on every test", async () => {
    const id = await submitCode(ada);
    await review(ada, id);
    await t.idle();

    const checking = (await readReview(ada, id))!;
    expect(checking.refactor).toEqual({ status: "checking", code: null, notes: null });

    // the refactor went to the judge as a full submission of its own
    const job = lastJob();
    expect(job.kind).toBe("submit");
    expect(job.code).toContain("# reviewed");
    const [row] = (
      await t.pool.query("SELECT mode, kind FROM submissions WHERE id = $1", [job.submissionId])
    ).rows;
    expect(row).toMatchObject({ mode: "review", kind: "submit" });

    await finish(job, "AC");
    const ok = (await readReview(ada, id))!;
    expect(ok.refactor.status).toBe("verified");
    expect(ok.refactor.code).toContain("# reviewed");
    expect(ok.refactor.notes).toBeTruthy();
  });

  it("hides a refactor that fails a test", async () => {
    const id = await submitCode(ada);
    await review(ada, id);
    await t.idle();
    await finish(lastJob(), "WA");
    const rejected = (await readReview(ada, id))!;
    expect(rejected.refactor).toEqual({ status: "rejected", code: null, notes: null });
    // the stored text is not sent to the browser either
    expect(JSON.stringify(rejected)).not.toContain("# reviewed");
  });

  it("can skip the refactor", async () => {
    const id = await submitCode(ada);
    await call("POST", `/submissions/${id}/review`, ada, { refactor: false });
    await t.idle();
    expect((await readReview(ada, id))!.refactor.status).toBe("none");
    expect(t.judge.jobs).toHaveLength(1); // only the original submission
  });

  it("never counts as an attempt, earns nothing and stays out of the history", async () => {
    const id = await submitCode(ada);
    await review(ada, id);
    await t.idle();
    const [before] = (
      await t.pool.query(
        "SELECT attempts FROM user_problem_state WHERE problem_id = (SELECT problem_id FROM submissions WHERE id = $1)",
        [id],
      )
    ).rows;
    const [{ xp: xp1 }] = (await t.pool.query("SELECT xp FROM profiles LIMIT 1")).rows;
    const [{ n: count1 }] = (
      await t.pool.query("SELECT submissions_count AS n FROM problems WHERE slug = 'two-sum'")
    ).rows;
    await finish(lastJob(), "AC");
    const [after] = (
      await t.pool.query(
        "SELECT attempts FROM user_problem_state WHERE problem_id = (SELECT problem_id FROM submissions WHERE id = $1)",
        [id],
      )
    ).rows;
    expect(after.attempts).toBe(before.attempts);
    expect((await t.pool.query("SELECT xp FROM profiles LIMIT 1")).rows[0].xp).toBe(xp1);
    expect(
      (await t.pool.query("SELECT submissions_count AS n FROM problems WHERE slug = 'two-sum'"))
        .rows[0].n,
    ).toBe(count1);
    const list = await call<SubmissionListResponse>("GET", "/me/submissions?kind=all", ada);
    expect(list.body.items.map((x) => x.id)).toEqual([id]);
  });

  it("belongs to its owner and waits for the judge", async () => {
    const id = await submitCode(ada);
    expect((await review(bob, id)).status).toBe(404);
    // someone else's submission has no review to show
    expect(await readReview(bob, id)).toBeNull();

    const pending = await call<SubmissionCreated>("POST", "/submissions", ada, {
      problemSlug: "two-sum",
      language: "python",
      code: NESTED,
      kind: "submit",
    });
    expect((await review(ada, pending.body.submissionId)).status).toBe(409);
  });

  it("limits how many reviews a learner can start in a minute", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await submitCode(ada, `${NESTED}# ${i}\n`));
    for (const id of ids.slice(0, 3)) expect((await review(ada, id)).status).toBe(202);
    expect((await review(ada, ids[3]!)).status).toBe(429);
    await t.idle();
  });
});

// ---------------------------------------------------------------- complexity

const SIZES = 9; // two-sum/scale.json
const sizeOf = (x: JudgeJob["tests"][number]) => Number(x.customInput!.split("\n")[0]);
const quadratic = (job: JudgeJob) =>
  job.tests.map((x) =>
    result(x.ordinal, { timeMs: Math.round(18 + (sizeOf(x) / 128_000) ** 2 * 3000) }),
  );
const linear = (job: JudgeJob) =>
  job.tests.map((x, i) =>
    result(x.ordinal, { timeMs: Math.round(18 + (sizeOf(x) / 128_000) * 400 + ((i * 7) % 5)) }),
  );

const startCx = (token: string, id: string, claimed = "O(n log n)") =>
  call<ComplexityDto>("POST", `/submissions/${id}/complexity`, token, { claimed });
const readCx = async (token: string, id: string) =>
  (
    await call<{ supported: boolean; analysis: ComplexityDto | null }>(
      "GET",
      `/submissions/${id}/complexity`,
      token,
    )
  ).body;

describe("complexity analyzer (X4)", () => {
  it("runs the code on growing generated inputs, one per size", async () => {
    const id = await submitCode(ada);
    expect(await readCx(ada, id)).toEqual({ supported: true, analysis: null });
    const res = await startCx(ada, id);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "running", claimed: "O(n log n)" });

    const job = lastJob();
    expect(job.kind).toBe("run");
    expect(job.code).toBe(NESTED);
    expect(job.tests).toHaveLength(SIZES);
    expect(job.tests.every((x) => x.kind === "custom" && x.customInput)).toBe(true);
    // each size is timed three times and the fastest counts
    expect(job.tests.every((x) => x.repeat === 3)).toBe(true);
    // canonical input: the array length first, then the numbers, then the target
    const sizes = job.tests.map((x) => Number(x.customInput!.split("\n")[0]));
    expect(sizes).toEqual([500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000]);
    expect(job.tests[0]!.customInput!.trimEnd().split("\n")[2]).toBe("2000000000");
    // the run is stored apart from the learner's attempts
    const [row] = (
      await t.pool.query("SELECT mode FROM submissions WHERE id = $1", [job.submissionId])
    ).rows;
    expect(row.mode).toBe("review");
  });

  it("says what was measured against what was claimed, and where the nested loop is", async () => {
    const id = await submitCode(ada);
    await startCx(ada, id, "O(n log n)");
    const job = lastJob();
    await finish(job, "AC", quadratic(job));

    const { analysis } = await readCx(ada, id);
    expect(analysis).toMatchObject({ status: "ready", verdict: "worse" });
    expect(analysis!.measured).toMatchObject({ label: "O(n²)" });
    expect(analysis!.message).toContain("You claimed O(n log n)");
    expect(analysis!.message).toContain("O(n²)");
    expect(analysis!.message).toContain("line 4");
    expect(analysis!.hint).toMatchObject({ maxLoopDepth: 2, deepestLine: 4 });
    expect(analysis!.samples).toHaveLength(SIZES);
    expect(analysis!.samples[0]).toMatchObject({ n: 500, limit: false });
    // never presented as a proof
    expect(analysis!.caveat).toMatch(/not a proof/);
  });

  it("agrees with a claim the measurement supports", async () => {
    const id = await submitCode(ada);
    await startCx(ada, id, "O(n)");
    const job = lastJob();
    await finish(job, "AC", linear(job));
    const { analysis } = await readCx(ada, id);
    expect(analysis).toMatchObject({ status: "ready", verdict: "matches" });
  });

  it("treats the first size that ran out of time as a lower bound and drops the rest", async () => {
    const id = await submitCode(ada);
    await startCx(ada, id, "O(n^2)");
    const job = lastJob();
    const rows = job.tests.map((x, i) =>
      i < 5
        ? result(x.ordinal, { timeMs: Math.round(15 + (sizeOf(x) / 8000) ** 2 * 300) })
        : result(x.ordinal, { verdict: "TLE", timeMs: 2000 }),
    );
    await finish(job, "TLE", rows);
    const { analysis } = await readCx(ada, id);
    expect(analysis!.status).toBe("ready");
    expect(analysis!.samples[5]).toMatchObject({ limit: true });
    expect(analysis!.samples[6]).toMatchObject({ timeMs: null, limit: false });
  });

  it("does not claim more than a very fast run can show", async () => {
    const id = await submitCode(ada);
    await startCx(ada, id, "O(n)");
    const job = lastJob();
    await finish(
      job,
      "AC",
      job.tests.map((x) => result(x.ordinal, { timeMs: 20 })),
    );
    const { analysis } = await readCx(ada, id);
    expect(analysis).toMatchObject({ status: "ready", verdict: "inconclusive", measured: null });
    expect(analysis!.message).toContain("too fast");
  });

  it("fails clearly when the program crashes on every size", async () => {
    const id = await submitCode(ada);
    await startCx(ada, id);
    const job = lastJob();
    await finish(
      job,
      "RE",
      job.tests.map((x) => result(x.ordinal, { verdict: "RE", timeMs: 3 })),
    );
    const { analysis } = await readCx(ada, id);
    expect(analysis).toMatchObject({ status: "failed" });
    expect(analysis!.error).toContain("failed on the generated inputs");
  });

  it("returns a running check as it is and replaces a finished one", async () => {
    const id = await submitCode(ada);
    await startCx(ada, id, "O(n)");
    const jobs = t.judge.jobs.length;
    const again = await startCx(ada, id, "O(n^2)");
    expect(again.body.claimed).toBe("O(n)");
    expect(t.judge.jobs).toHaveLength(jobs);

    const job = lastJob();
    await finish(job, "AC", linear(job));
    await readCx(ada, id);
    const redo = await startCx(ada, id, "O(n^2)");
    expect(redo.body).toMatchObject({ status: "running", claimed: "O(n^2)" });
    expect(t.judge.jobs).toHaveLength(jobs + 1);
  });

  it("explains an unsupported problem and refuses unfinished or uncompilable code", async () => {
    const stairs = await submitCode(ada, "x", "AC", "climbing-stairs");
    expect(await readCx(ada, stairs)).toEqual({ supported: false, analysis: null });
    const res = await startCx(ada, stairs);
    expect(res.status).toBe(422);

    const ce = await submitCode(ada, "x", "CE");
    expect((await startCx(ada, ce)).status).toBe(422);

    const pending = await call<SubmissionCreated>("POST", "/submissions", ada, {
      problemSlug: "two-sum",
      language: "python",
      code: NESTED,
      kind: "submit",
    });
    expect((await startCx(ada, pending.body.submissionId)).status).toBe(409);
  });

  it("belongs to its owner and validates the claim", async () => {
    const id = await submitCode(ada);
    expect((await startCx(bob, id)).status).toBe(404);
    expect((await call("GET", `/submissions/${id}/complexity`, bob)).status).toBe(404);
    expect(
      (await call("POST", `/submissions/${id}/complexity`, ada, { claimed: "  " })).status,
    ).toBe(422);
  });
});
