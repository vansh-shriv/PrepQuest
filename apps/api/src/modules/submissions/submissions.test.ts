import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobSummary, JudgeJob, TestResult } from "@prepquest/judge-core";
import type {
  SubmissionCreated,
  SubmissionDetail,
  SubmissionListResponse,
} from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import { bearer, makeTestApp, signupAndLogin, type TestApp } from "../../test/helpers.js";
import { applyJudgeEvent, failStuckSubmissions } from "./ingest.js";

let t: TestApp;
let ada: string;
let bob: string;

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum", "valid-parentheses", "climbing-stairs"]);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
});
afterAll(() => t.close());

beforeEach(async () => {
  t.judge.jobs.length = 0;
  t.judge.failNext = false;
  await t.pool.query("DELETE FROM submissions");
  await t.pool.query("DELETE FROM user_problem_state");
  await t.pool.query("DELETE FROM custom_tests");
  await t.pool.query(
    "UPDATE problems SET submissions_count = 0, accepted_count = 0, acceptance_rate = 0",
  );
  // rate-limit counters live in the in-memory kv shared by the app
  (t.kv as unknown as { data: Map<string, unknown> }).data.clear();
});

const call = (
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  token: string | null,
  payload?: object,
  headers: Record<string, string> = {},
) =>
  t.app.inject({
    method,
    url,
    headers: { ...(token ? bearer(token) : {}), ...headers },
    ...(payload ? { payload } : {}),
  });

const CODE = "class Solution:\n    def twoSum(self, nums, target):\n        return []\n";
const submit = (token: string | null, over: object = {}, headers: Record<string, string> = {}) =>
  call(
    "POST",
    "/v1/submissions",
    token,
    { problemSlug: "two-sum", language: "python", code: CODE, kind: "submit", ...over },
    headers,
  );

const lastJob = (): JudgeJob => t.judge.jobs[t.judge.jobs.length - 1]!.job;

const result = (
  ordinal: number,
  kind: TestResult["kind"],
  over: Partial<TestResult> = {},
): TestResult => ({
  ordinal,
  kind,
  verdict: "AC",
  timeMs: 5,
  memoryKb: 2048,
  ...over,
});

function summary(job: JudgeJob, over: Partial<JobSummary> = {}): JobSummary {
  const results = job.tests.map((x) => result(x.ordinal, x.kind));
  return {
    verdict: "AC",
    passed: results.length,
    total: results.length,
    timeMs: 5,
    memoryKb: 2048,
    failingOrdinal: null,
    compileOutput: null,
    stderrTail: null,
    results,
    ...over,
  };
}

const finish = (job: JudgeJob, over: Partial<JobSummary> = {}) =>
  applyJudgeEvent(t.db, {
    type: "done",
    submissionId: job.submissionId,
    summary: summary(job, over),
  });

const detail = async (token: string, id: string) =>
  (await call("GET", `/v1/submissions/${id}`, token)).json<SubmissionDetail>();

describe("POST /submissions", () => {
  it("requires sign-in", async () => {
    expect((await submit(null)).statusCode).toBe(401);
  });

  it("queues a submission with every test, the signature and the language's limits", async () => {
    const res = await submit(ada);
    expect(res.statusCode).toBe(202);
    const body = res.json<SubmissionCreated>();
    expect(body).toMatchObject({ status: "QUEUED", queuePosition: 1 });

    expect(t.judge.jobs).toHaveLength(1);
    expect(t.judge.jobs[0]!.lane).toBe("submit");
    const job = lastJob();
    expect(job).toMatchObject({
      submissionId: body.submissionId,
      kind: "submit",
      language: "python",
      checker: { type: "exact" },
    });
    expect(job.signature.function).toBe("twoSum");
    expect(job.tests.length).toBeGreaterThanOrEqual(10);
    expect(job.tests[0]).toMatchObject({ ordinal: 1, kind: "sample" });
    expect(job.tests.every((x) => x.inputKey && x.outputKey)).toBe(true);
    // python gets 5x the C++ time limit (doc 12 §3)
    const cpp = (await submit(ada, { language: "cpp" })).statusCode;
    expect(cpp).toBe(202);
    expect(job.limits.timeMs).toBe(lastJob().limits.timeMs * 5);

    const row = await detail(ada, body.submissionId);
    expect(row).toMatchObject({ verdict: "QUEUED", finished: false, kind: "submit" });
    expect(row.code).toBeUndefined(); // code is returned once finished
  });

  it("a run uses the samples plus the chosen custom tests, numbered above the real ones", async () => {
    const saved = await call("POST", "/v1/problems/two-sum/custom-tests", ada, {
      label: "mine",
      input: "2\n1 2\n3\n",
    });
    const savedId = saved.json<{ id: string }>().id;
    const res = await submit(ada, {
      kind: "run",
      customTestIds: [savedId],
      customInputs: ["1\n5\n5\n"],
    });
    expect(res.statusCode).toBe(202);
    expect(t.judge.jobs[0]!.lane).toBe("run");
    const job = lastJob();
    const samples = job.tests.filter((x) => x.kind === "sample");
    const custom = job.tests.filter((x) => x.kind === "custom");
    expect(samples.length).toBeGreaterThanOrEqual(1);
    expect(job.tests.length).toBe(samples.length + 2);
    expect(custom.map((x) => x.ordinal)).toEqual([1001, 1002]);
    expect(custom[0]).toMatchObject({ customInput: "2\n1 2\n3\n", label: "mine" });
    expect(custom[1]?.customInput).toBe("1\n5\n5\n");
  });

  it("rejects custom tests that aren't yours, and custom tests on a submit", async () => {
    const saved = await call("POST", "/v1/problems/two-sum/custom-tests", bob, {
      input: "1\n1\n1\n",
    });
    const bobsId = saved.json<{ id: string }>().id;
    expect((await submit(ada, { kind: "run", customTestIds: [bobsId] })).statusCode).toBe(422);
    expect((await submit(ada, { customInputs: ["x"] })).statusCode).toBe(422);
    expect(t.judge.jobs).toHaveLength(0);
  });

  it("validates the request", async () => {
    expect((await submit(ada, { code: "" })).statusCode).toBe(422);
    expect((await submit(ada, { code: "x".repeat(70_000) })).statusCode).toBe(422);
    expect((await submit(ada, { language: "ruby" })).statusCode).toBe(422);
    expect((await submit(ada, { mode: "contest" })).statusCode).toBe(422);
    expect((await submit(ada, { problemSlug: "nope" })).statusCode).toBe(404);
    expect((await submit(ada, {}, { "idempotency-key": "short" })).statusCode).toBe(422);
  });

  it("does not accept unpublished or archived problems", async () => {
    await t.pool.query("UPDATE problems SET status = 'archived' WHERE slug = 'climbing-stairs'");
    expect((await submit(ada, { problemSlug: "climbing-stairs" })).statusCode).toBe(404);
    await t.pool.query("UPDATE problems SET status = 'published' WHERE slug = 'climbing-stairs'");
    await t.pool.query("UPDATE problems SET status = 'draft' WHERE slug = 'climbing-stairs'");
    expect((await submit(ada, { problemSlug: "climbing-stairs" })).statusCode).toBe(404);
    await t.pool.query("UPDATE problems SET status = 'published' WHERE slug = 'climbing-stairs'");
  });

  it("replays an idempotent request instead of queuing twice", async () => {
    const headers = { "idempotency-key": "retry-key-12345" };
    const first = await submit(ada, {}, headers);
    const second = await submit(ada, {}, headers);
    expect(second.statusCode).toBe(202);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(second.json<SubmissionCreated>().submissionId).toBe(
      first.json<SubmissionCreated>().submissionId,
    );
    expect(t.judge.jobs).toHaveLength(1);
    // the key is per user
    const other = await submit(bob, {}, headers);
    expect(other.json<SubmissionCreated>().submissionId).not.toBe(
      first.json<SubmissionCreated>().submissionId,
    );
  });

  it("limits submissions in flight and submissions per minute", async () => {
    for (let i = 0; i < 5; i++) expect((await submit(ada)).statusCode).toBe(202);
    const blocked = await submit(ada);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("TOO_MANY_PENDING");

    // finish them so only the per-minute budget (10) is left to trip
    await t.pool.query("UPDATE submissions SET verdict = 'WA'");
    // (the refused request above also used one unit of the per-minute budget of 10)
    for (let i = 0; i < 4; i++) expect((await submit(ada)).statusCode).toBe(202);
    await t.pool.query("UPDATE submissions SET verdict = 'WA'");
    const limited = await submit(ada);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
  });

  it("answers 503 and closes the submission when the queue is unreachable", async () => {
    t.judge.failNext = true;
    const res = await submit(ada);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("JUDGE_UNAVAILABLE");
    const { rows } = await t.pool.query("SELECT verdict FROM submissions");
    expect(rows).toEqual([{ verdict: "IE" }]);
  });
});

describe("judge results", () => {
  it("shows progress, then the final verdict with per-test results", async () => {
    const { submissionId: id } = (await submit(ada)).json<SubmissionCreated>();
    const job = lastJob();

    await applyJudgeEvent(t.db, {
      type: "stage",
      submissionId: id,
      stage: "COMPILING",
      total: job.tests.length,
    });
    expect((await detail(ada, id)).verdict).toBe("COMPILING");
    await applyJudgeEvent(t.db, {
      type: "stage",
      submissionId: id,
      stage: "RUNNING",
      total: job.tests.length,
    });
    await applyJudgeEvent(t.db, {
      type: "test",
      submissionId: id,
      result: result(1, "sample", { stdoutTail: "[0,1]\n" }),
    });
    const mid = await detail(ada, id);
    expect(mid).toMatchObject({ verdict: "RUNNING", finished: false, total: job.tests.length });
    expect(mid.results).toHaveLength(1);

    await finish(job);
    const done = await detail(ada, id);
    expect(done).toMatchObject({
      verdict: "AC",
      finished: true,
      passed: job.tests.length,
      timeMs: 5,
      memoryKb: 2048,
    });
    expect(done.results).toHaveLength(job.tests.length);
    expect(done.code).toBe(CODE);
    expect(done.failing).toBeNull();
  });

  it("shows samples in full but never reveals hidden test data", async () => {
    const { submissionId: id } = (await submit(ada)).json<SubmissionCreated>();
    const job = lastJob();
    const hidden = job.tests.find((x) => x.kind === "hidden")!;
    const edge = job.tests.find((x) => x.kind === "edge")!;
    const results: TestResult[] = [
      result(1, "sample", {
        stdoutTail: "[1,2]\n",
        inputPreview: "2\n1 2\n3\n",
        expectedPreview: "[0,1]\n",
        checkerMsg: 'Line 1: expected "[0,1]" but got "[1,2]".',
        verdict: "WA",
      }),
      result(hidden.ordinal, "hidden", {
        verdict: "WA",
        stdoutTail: "SECRET OUTPUT",
        inputPreview: "SECRET INPUT",
        checkerMsg: "Wrong answer on a hidden test.",
      }),
      result(edge.ordinal, "edge", {
        verdict: "RE",
        stderrTail: "IndexError: list index out of range",
      }),
    ];
    await finish(job, { verdict: "WA", passed: 0, failingOrdinal: 1, results });

    const d = await detail(ada, id);
    const byOrdinal = (n: number) => d.results.find((r) => r.ordinal === n);
    const [s, h, e] = [byOrdinal(1), byOrdinal(hidden.ordinal), byOrdinal(edge.ordinal)];
    expect(s).toMatchObject({ stdout: "[1,2]\n", input: "2\n1 2\n3\n", expected: "[0,1]\n" });
    expect(s?.checkerMsg).toContain("expected");
    // hidden: verdict, time and memory only
    expect(h).toMatchObject({
      kind: "hidden",
      verdict: "WA",
      checkerMsg: "Wrong answer on a hidden test.",
    });
    expect(h?.stdout).toBeUndefined();
    expect(h?.input).toBeUndefined();
    expect(h?.expected).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain("SECRET");
    // a crash on a hidden test still shows its error message
    expect(e?.stderr).toContain("IndexError");
    expect(d.failing).toMatchObject({ ordinal: 1, kind: "sample" });
  });

  it("names the failing hidden test by its author's label", async () => {
    const { submissionId: id } = (await submit(ada)).json<SubmissionCreated>();
    const job = lastJob();
    const labelled = job.tests.find((x) => x.kind === "edge")!;
    await finish(job, {
      verdict: "WA",
      passed: 0,
      failingOrdinal: labelled.ordinal,
      results: [result(labelled.ordinal, "edge", { verdict: "WA" })],
    });
    const d = await detail(ada, id);
    expect(d.failing).toMatchObject({ ordinal: labelled.ordinal, kind: "edge" });
    expect(d.failing?.label).toBeTruthy();
  });

  it("updates progress and statistics for real submissions only", async () => {
    const stat = async () =>
      (
        await t.pool.query(
          "SELECT submissions_count AS n, accepted_count AS a, acceptance_rate::float AS r FROM problems WHERE slug = 'two-sum'",
        )
      ).rows[0] as { n: number; a: number; r: number };
    const state = async () =>
      (
        await t.pool.query(
          "SELECT status, attempts, first_try_ac, best_time_ms, first_ac_at IS NOT NULL AS solved_at FROM user_problem_state",
        )
      ).rows[0] as
        | {
            status: string;
            attempts: number;
            first_try_ac: boolean | null;
            best_time_ms: number | null;
            solved_at: boolean;
          }
        | undefined;

    // a run changes nothing
    await submit(ada, { kind: "run" });
    await finish(lastJob());
    expect(await state()).toBeUndefined();
    expect(await stat()).toMatchObject({ n: 0, a: 0 });

    // infrastructure errors are never counted
    await submit(ada);
    await finish(lastJob(), { verdict: "IE", results: [] });
    expect(await state()).toBeUndefined();

    // a wrong answer: attempted
    await submit(ada);
    await finish(lastJob(), { verdict: "WA", passed: 0, failingOrdinal: 1, results: [] });
    expect(await state()).toMatchObject({ status: "attempted", attempts: 1, first_try_ac: null });
    expect(await stat()).toMatchObject({ n: 1, a: 0, r: 0 });

    // then accepted: solved, not a first-try solve
    await submit(ada);
    await finish(lastJob(), { timeMs: 40 });
    expect(await state()).toMatchObject({
      status: "solved",
      attempts: 2,
      first_try_ac: false,
      best_time_ms: 40,
      solved_at: true,
    });
    expect(await stat()).toMatchObject({ n: 2, a: 1, r: 50 });

    // a faster AC improves the best time; a later failure keeps the problem solved
    await submit(ada);
    await finish(lastJob(), { timeMs: 10 });
    await submit(ada);
    await finish(lastJob(), { verdict: "TLE", passed: 3, failingOrdinal: 4, results: [] });
    expect(await state()).toMatchObject({ status: "solved", attempts: 4, best_time_ms: 10 });
    expect(await stat()).toMatchObject({ n: 4, a: 2, r: 50 });

    // the list now reports the status
    const list = await call("GET", "/v1/problems?q=two", ada);
    expect(list.json().items[0]).toMatchObject({ slug: "two-sum", status: "solved" });
  });

  it("records a first-try solve", async () => {
    await submit(ada);
    await finish(lastJob());
    const { rows } = await t.pool.query("SELECT first_try_ac, attempts FROM user_problem_state");
    expect(rows).toEqual([{ first_try_ac: true, attempts: 1 }]);
  });

  it("ignores a repeated final event and events after the verdict", async () => {
    const { submissionId: id } = (await submit(ada)).json<SubmissionCreated>();
    const job = lastJob();
    await finish(job);
    await finish(job);
    await applyJudgeEvent(t.db, { type: "stage", submissionId: id, stage: "RUNNING", total: 1 });
    await applyJudgeEvent(t.db, {
      type: "test",
      submissionId: id,
      result: result(99, "hidden", { verdict: "WA" }),
    });
    const d = await detail(ada, id);
    expect(d.verdict).toBe("AC");
    expect(d.results.some((r) => r.ordinal === 99)).toBe(false);
    const { rows } = await t.pool.query("SELECT attempts FROM user_problem_state");
    expect(rows).toEqual([{ attempts: 1 }]);
    const stats = await t.pool.query(
      "SELECT submissions_count AS n FROM problems WHERE slug = 'two-sum'",
    );
    expect(stats.rows[0].n).toBe(1);
  });

  it("stores compiler output for a compile error", async () => {
    const { submissionId: id } = (await submit(ada, { language: "cpp" })).json<SubmissionCreated>();
    await finish(lastJob(), {
      verdict: "CE",
      passed: 0,
      compileOutput: "main.cpp:3:1: error: oops",
      results: [],
    });
    expect(await detail(ada, id)).toMatchObject({
      verdict: "CE",
      compileOutput: "main.cpp:3:1: error: oops",
    });
  });

  it("fails submissions the judge never answered", async () => {
    const { submissionId: stuck } = (await submit(ada)).json<SubmissionCreated>();
    const { submissionId: fresh } = (await submit(ada)).json<SubmissionCreated>();
    await t.pool.query(
      "UPDATE submissions SET created_at = now() - interval '10 minutes' WHERE id = $1",
      [stuck],
    );
    expect(await failStuckSubmissions(t.db, 300)).toBe(1);
    expect(await detail(ada, stuck)).toMatchObject({ verdict: "IE", finished: true });
    expect((await detail(ada, fresh)).verdict).toBe("QUEUED");
  });
});

describe("access and history", () => {
  it("only the owner can read a submission", async () => {
    const { submissionId: id } = (await submit(ada)).json<SubmissionCreated>();
    expect((await call("GET", `/v1/submissions/${id}`, bob)).statusCode).toBe(404);
    expect((await call("GET", `/v1/submissions/${id}`, null)).statusCode).toBe(401);
    expect((await call("PATCH", `/v1/submissions/${id}/note`, bob, { note: "x" })).statusCode).toBe(
      404,
    );
    expect((await call("GET", "/v1/submissions/not-a-uuid", ada)).statusCode).toBe(422);
  });

  it("lists history newest first with cursor pagination, hiding runs by default", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await submit(ada)).json<SubmissionCreated>().submissionId);
      await t.pool.query("UPDATE submissions SET verdict = 'WA'");
      await t.pool.query(
        "UPDATE submissions SET created_at = now() - make_interval(mins => $1) WHERE id = $2",
        [3 - i, ids[i]],
      );
    }
    await submit(ada, { kind: "run" });
    await submit(bob);

    const first = await call("GET", "/v1/me/submissions?limit=2", ada);
    const page1 = first.json<SubmissionListResponse>();
    expect(page1.items.map((x) => x.id)).toEqual([ids[2], ids[1]]);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = (
      await call("GET", `/v1/me/submissions?limit=2&cursor=${page1.nextCursor}`, ada)
    ).json<SubmissionListResponse>();
    expect(page2.items.map((x) => x.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();

    const all = (
      await call("GET", "/v1/me/submissions?kind=all", ada)
    ).json<SubmissionListResponse>();
    expect(all.items).toHaveLength(4);
    expect(first.json<SubmissionListResponse>().items[0]).toMatchObject({
      problem: { slug: "two-sum", title: "Two Sum" },
      language: "python",
      verdict: "WA",
    });
  });

  it("filters by problem, verdict, language and title search", async () => {
    await submit(ada);
    await submit(ada, { language: "cpp" });
    await submit(ada, { problemSlug: "valid-parentheses", code: "class Solution:\n    pass\n" });
    await t.pool.query("UPDATE submissions SET verdict = 'WA'");
    await t.pool.query("UPDATE submissions SET verdict = 'AC' WHERE language = 'cpp'");

    const count = async (q: string) =>
      (await call("GET", `/v1/me/submissions?${q}`, ada)).json<SubmissionListResponse>().items
        .length;
    expect(await count("problem=two-sum")).toBe(2);
    expect(await count("verdict=AC")).toBe(1);
    expect(await count("language=python")).toBe(2);
    expect(await count("q=parenth")).toBe(1);
    expect(await count("mode=contest")).toBe(0);
    expect(await count("from=2999-01-01")).toBe(0);
    expect((await call("GET", "/v1/me/submissions?verdict=BOGUS", ada)).statusCode).toBe(422);
  });

  it("attaches a note to a submission", async () => {
    const { submissionId: id } = (await submit(ada)).json<SubmissionCreated>();
    const saved = await call("PATCH", `/v1/submissions/${id}/note`, ada, {
      note: "  forgot duplicates  ",
    });
    expect(saved.json()).toEqual({ note: "forgot duplicates" });
    expect((await detail(ada, id)).note).toBe("forgot duplicates");
    expect((await call("PATCH", `/v1/submissions/${id}/note`, ada, { note: "" })).json()).toEqual({
      note: null,
    });
    expect(
      (await call("PATCH", `/v1/submissions/${id}/note`, ada, { note: "x".repeat(501) }))
        .statusCode,
    ).toBe(422);
  });

  it("diffs two attempts at the same problem", async () => {
    const a = (await submit(ada, { code: "a\nb\nc" })).json<SubmissionCreated>().submissionId;
    const b = (await submit(ada, { code: "a\nx\nc" })).json<SubmissionCreated>().submissionId;
    const other = (
      await submit(ada, { problemSlug: "valid-parentheses", code: "q" })
    ).json<SubmissionCreated>().submissionId;
    const diff = await call("GET", `/v1/submissions/${b}/diff?against=${a}`, ada);
    expect(diff.statusCode).toBe(200);
    expect(diff.json().lines).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "x" },
      { type: "same", text: "c" },
    ]);
    expect((await call("GET", `/v1/submissions/${b}/diff?against=${other}`, ada)).statusCode).toBe(
      422,
    );
    expect((await call("GET", `/v1/submissions/${b}/diff?against=${a}`, bob)).statusCode).toBe(404);
  });
});

describe("account deletion", () => {
  it("submissions are removed with the account", async () => {
    const carol = await signupAndLogin(t, { email: "carol@example.com", handle: "carol_c" });
    await submit(carol.accessToken);
    expect((await t.pool.query("SELECT count(*)::int AS n FROM submissions")).rows[0].n).toBe(1);
    await t.pool.query("DELETE FROM users WHERE email = 'carol@example.com'");
    expect((await t.pool.query("SELECT count(*)::int AS n FROM submissions")).rows[0].n).toBe(0);
  });
});
