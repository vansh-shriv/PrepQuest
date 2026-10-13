import { expect } from "vitest";
import type { JobSummary, JudgeJob } from "@prepquest/judge-core";
import type { SubmissionCreated } from "@prepquest/shared";
import { applyJudgeEvent } from "../modules/submissions/ingest.js";
import { bearer, type TestApp } from "./helpers.js";

const summary = (job: JudgeJob, verdict: JobSummary["verdict"]): JobSummary => ({
  verdict,
  passed: verdict === "AC" ? job.tests.length : 0,
  total: job.tests.length,
  timeMs: 5,
  memoryKb: 100,
  failingOrdinal: verdict === "AC" ? null : 1,
  compileOutput: null,
  stderrTail: null,
  results: [],
});

/** Submits `slug` as `token` and has the judge answer `verdict` (the way a real verdict arrives). */
export async function solveProblem(
  t: TestApp,
  token: string,
  slug: string,
  verdict: JobSummary["verdict"] = "AC",
): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/submissions",
    headers: bearer(token),
    payload: { problemSlug: slug, language: "python", code: "x", kind: "submit" },
  });
  expect(res.statusCode, res.body).toBe(202);
  const id = res.json<SubmissionCreated>().submissionId;
  const job = t.judge.jobs[t.judge.jobs.length - 1]!.job;
  await applyJudgeEvent(t.db, { type: "done", submissionId: id, summary: summary(job, verdict) });
  return id;
}

/** Resets everything a learner accumulates, keeping users and problems. */
export async function resetLearning(t: TestApp) {
  for (const table of [
    "sql_attempts",
    "oa_attempts",
    "srs_reviews",
    "srs_cards",
    "quiz_attempt_answers",
    "quiz_attempts",
    "user_tracks",
    "plan_diffs",
    "plan_tasks",
    "study_plans",
    "daily_goals",
    "goal_templates",
    "readiness_snapshots",
    "diagnostics",
    "interview_sessions",
    "submissions",
    "user_problem_state",
    "hint_usage",
    "xp_events",
    "activity_days",
    "badges_earned",
  ]) {
    await t.pool.query(`DELETE FROM ${table}`);
  }
  await t.pool.query(
    `UPDATE profiles SET xp = 0, level = 1, streak_current = 0, streak_best = 0, streak_last_active = NULL,
       streak_freezes = 1, timezone = 'UTC', placement_date = NULL, hours_per_day = NULL`,
  );
  t.judge.jobs.length = 0;
  (t.kv as unknown as { data: Map<string, unknown> }).data.clear();
}
