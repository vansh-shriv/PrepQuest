import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  newId,
  sqlAttempts,
  sqlDatasets,
  sqlProblems,
  type Database,
  type Db,
} from "@prepquest/db";
import { compareResults, guardQuery } from "@prepquest/analytics-core";
import { describeDataset, runQuery, type QueryResult, type TableInfo } from "@prepquest/sql-runner";
import {
  AppError,
  type SqlListResponse,
  type SqlProblemDto,
  type SqlRunResult,
  type SqlSubmitResult,
} from "@prepquest/shared";
import { grantXp } from "../progress/xp.js";

// SQL practice (C1). The learner's query is guarded (one read-only statement), run on a throwaway in-memory
// copy of the dataset with a row limit and a statement timeout, and compared with the expected result.

const SQL_XP = { easy: 10, medium: 20, hard: 30 } as const;

const tableCache = new Map<string, Promise<TableInfo[]>>();
/** Table descriptions are cached per dataset content, so editing the content refreshes them. */
function tablesFor(d: { slug: string; schemaSql: string; seedSql: string }): Promise<TableInfo[]> {
  const key = `${d.slug}:${d.schemaSql.length}:${d.seedSql.length}`;
  let hit = tableCache.get(key);
  if (!hit) {
    hit = describeDataset({ schema: d.schemaSql, seed: d.seedSql });
    tableCache.set(key, hit);
    hit.catch(() => tableCache.delete(key));
  }
  return hit;
}

const expectedCache = new Map<string, Promise<QueryResult>>();
function expectedFor(p: {
  id: string;
  expectedQuery: string;
  schemaSql: string;
  seedSql: string;
}): Promise<QueryResult> {
  const key = `${p.id}:${p.expectedQuery.length}:${p.schemaSql.length}:${p.seedSql.length}`;
  let hit = expectedCache.get(key);
  if (!hit) {
    hit = runQuery({ schema: p.schemaSql, seed: p.seedSql }, p.expectedQuery);
    expectedCache.set(key, hit);
    hit.catch(() => expectedCache.delete(key));
  }
  return hit;
}

const toRun = (r: QueryResult): SqlRunResult => ({
  ok: r.ok,
  columns: r.columns,
  rows: r.rows,
  truncated: r.truncated,
  ms: r.ms,
  error: r.error ?? null,
  timedOut: r.timedOut ?? false,
});

export async function listProblems(db: Database, userId: string): Promise<SqlListResponse> {
  const rows = await db
    .select({
      slug: sqlProblems.slug,
      title: sqlProblems.title,
      topic: sqlProblems.topic,
      difficulty: sqlProblems.difficulty,
      dataset: sqlDatasets.slug,
      datasetTitle: sqlDatasets.title,
      id: sqlProblems.id,
      position: sqlProblems.position,
    })
    .from(sqlProblems)
    .innerJoin(sqlDatasets, eq(sqlDatasets.id, sqlProblems.datasetId))
    .where(eq(sqlProblems.status, "published"))
    .orderBy(asc(sqlDatasets.slug), asc(sqlProblems.position));
  const stats = (
    await db.execute(sql`
      SELECT problem_id, count(*)::int AS attempts, bool_or(verdict = 'AC') AS solved
      FROM sql_attempts WHERE user_id = ${userId} GROUP BY problem_id`)
  ).rows as unknown as Array<{ problem_id: string; attempts: number; solved: boolean }>;
  const byId = new Map(stats.map((s) => [s.problem_id, s]));
  const problems = rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    topic: r.topic,
    difficulty: r.difficulty,
    dataset: r.dataset,
    datasetTitle: r.datasetTitle,
    solved: byId.get(r.id)?.solved ?? false,
    attempts: byId.get(r.id)?.attempts ?? 0,
  }));
  return {
    problems,
    topics: [...new Set(rows.map((r) => r.topic))].sort(),
    solved: problems.filter((p) => p.solved).length,
    total: problems.length,
  };
}

async function loadProblem(db: Database, slug: string) {
  const [row] = await db
    .select({
      p: sqlProblems,
      d: sqlDatasets,
    })
    .from(sqlProblems)
    .innerJoin(sqlDatasets, eq(sqlDatasets.id, sqlProblems.datasetId))
    .where(and(eq(sqlProblems.slug, slug), eq(sqlProblems.status, "published")));
  if (!row) throw new AppError("NOT_FOUND", 404, "That SQL problem does not exist.");
  return row;
}

const solvedBy = async (db: Db, userId: string, problemId: string) =>
  (
    await db
      .select({ id: sqlAttempts.id })
      .from(sqlAttempts)
      .where(
        and(
          eq(sqlAttempts.userId, userId),
          eq(sqlAttempts.problemId, problemId),
          eq(sqlAttempts.verdict, "AC"),
        ),
      )
      .limit(1)
  ).length > 0;

export async function getProblem(
  db: Database,
  userId: string,
  slug: string,
): Promise<SqlProblemDto> {
  const { p, d } = await loadProblem(db, slug);
  const [tables, solved, last] = await Promise.all([
    tablesFor(d),
    solvedBy(db, userId, p.id),
    db
      .select({ query: sqlAttempts.query })
      .from(sqlAttempts)
      .where(and(eq(sqlAttempts.userId, userId), eq(sqlAttempts.problemId, p.id)))
      .orderBy(desc(sqlAttempts.createdAt))
      .limit(1),
  ]);
  return {
    slug: p.slug,
    title: p.title,
    topic: p.topic,
    difficulty: p.difficulty,
    statement: p.statementMd,
    orderSensitive: p.orderSensitive,
    hint: p.hint,
    dataset: { slug: d.slug, title: d.title, description: d.description },
    tables,
    solved,
    lastQuery: last[0]?.query ?? null,
    solution: solved ? { query: p.expectedQuery, note: p.solutionNote } : null,
  };
}

const refusal = (message: string): SqlRunResult => ({
  ok: false,
  columns: [],
  rows: [],
  truncated: false,
  ms: 0,
  error: message,
  timedOut: false,
});

/** Runs a query without judging it. */
export async function run(db: Database, slug: string, query: string): Promise<SqlRunResult> {
  const { d } = await loadProblem(db, slug);
  const guard = guardQuery(query);
  if (!guard.ok) return refusal(guard.reason);
  return toRun(await runQuery({ schema: d.schemaSql, seed: d.seedSql }, guard.query));
}

export async function submit(
  db: Database,
  userId: string,
  slug: string,
  query: string,
  now: Date,
): Promise<SqlSubmitResult> {
  const { p, d } = await loadProblem(db, slug);
  const expected = await expectedFor({
    id: p.id,
    expectedQuery: p.expectedQuery,
    schemaSql: d.schemaSql,
    seedSql: d.seedSql,
  });
  const guard = guardQuery(query);
  const result: SqlRunResult = guard.ok
    ? toRun(await runQuery({ schema: d.schemaSql, seed: d.seedSql }, guard.query))
    : refusal(guard.reason);

  let verdict: SqlSubmitResult["verdict"];
  let message: string | null = null;
  if (!result.ok) {
    verdict = result.timedOut ? "TLE" : "ERROR";
    message = result.error;
  } else if (result.truncated) {
    verdict = "WA";
    message = "The result has more rows than the 1000-row limit: filter it down.";
  } else {
    const cmp = compareResults(
      { columns: result.columns, rows: result.rows },
      { columns: expected.columns, rows: expected.rows },
      { orderSensitive: p.orderSensitive },
    );
    verdict = cmp.verdict;
    message = cmp.reason;
  }

  const attemptId = newId();
  let xpAwarded = 0;
  let firstSolve = false;
  await db.transaction(async (tx) => {
    if (verdict === "AC") {
      firstSolve = !(await solvedBy(tx, userId, p.id));
      if (firstSolve) xpAwarded = SQL_XP[p.difficulty];
    }
    await tx.insert(sqlAttempts).values({
      id: attemptId,
      userId,
      problemId: p.id,
      query: query.slice(0, 5000),
      verdict,
      message,
      rowCount: result.ok ? result.rows.length : null,
      runMs: result.ms,
      xpAwarded,
    });
    if (firstSolve) {
      await grantXp(tx, userId, {
        xp: xpAwarded,
        reason: "sql",
        refType: "sql_attempt",
        refId: attemptId,
        now,
        activity: "problems",
      });
    }
  });

  const solved = verdict === "AC" || (await solvedBy(db, userId, p.id));
  return {
    verdict,
    message,
    result,
    expected: { columns: expected.columns, rows: expected.rows.length },
    xpAwarded,
    firstSolve,
    solution: solved ? { query: p.expectedQuery, note: p.solutionNote } : null,
  };
}
