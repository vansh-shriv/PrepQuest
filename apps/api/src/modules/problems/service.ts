import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  bookmarks,
  companies,
  customTests,
  codeDrafts,
  draftHistory,
  newId,
  problemCompanies,
  problemLanguages,
  problems,
  problemTags,
  sheetProblems,
  sheets,
  tags,
  userProblemState,
  withTransaction,
  type Database,
  type Db,
} from "@prepquest/db";
import {
  AppError,
  MAX_CUSTOM_TESTS,
  type CustomTest,
  type Draft,
  type DraftHistoryItem,
  type DraftSave,
  type LanguageValue,
  type ProblemDetail,
  type ProblemListItem,
  type ProblemListQuery,
  type ProblemListResponse,
  type ProblemStatus,
  type SheetDetail,
  type SheetSummary,
  type TagFacets,
} from "@prepquest/shared";

// ---------------------------------------------------------------- helpers

/** The caller's progress on a problem as a correlated subquery (NULL for anonymous callers). */
const stateOf = (userId: string | null): SQL<string | null> =>
  userId
    ? // raw `problems.id`: drizzle drops the table prefix of interpolated columns in single-table SELECT lists
      sql<
        string | null
      >`(select ups.status from user_problem_state ups where ups.problem_id = problems.id and ups.user_id = ${userId})`
    : sql<string | null>`null::text`;

const asStatus = (raw: string | null, signedIn: boolean): ProblemStatus | null =>
  !signedIn ? null : ((raw ?? "unseen") as ProblemStatus);

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { o: unknown };
    if (typeof o === "number" && Number.isInteger(o) && o >= 0 && o < 100_000) return o;
  } catch {
    /* fall through */
  }
  throw new AppError("VALIDATION_FAILED", 422, "Invalid input", {
    fields: { cursor: "Invalid cursor" },
  });
}

async function tagsFor(
  db: Db,
  ids: string[],
): Promise<Map<string, { topics: string[]; patterns: string[] }>> {
  const map = new Map<string, { topics: string[]; patterns: string[] }>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ problemId: problemTags.problemId, slug: tags.slug, kind: tags.kind })
    .from(problemTags)
    .innerJoin(tags, eq(tags.id, problemTags.tagId))
    .where(inArray(problemTags.problemId, ids))
    .orderBy(asc(tags.slug));
  for (const r of rows) {
    const entry = map.get(r.problemId) ?? { topics: [], patterns: [] };
    (r.kind === "topic" ? entry.topics : entry.patterns).push(r.slug);
    map.set(r.problemId, entry);
  }
  return map;
}

interface ListRow {
  id: string;
  slug: string;
  title: string;
  difficulty: ProblemListItem["difficulty"];
  acceptanceRate: string;
  estMinutes: number | null;
  status: string | null;
}

async function toItems(db: Db, rows: ListRow[], signedIn: boolean): Promise<ProblemListItem[]> {
  const tagMap = await tagsFor(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty,
    topics: tagMap.get(r.id)?.topics ?? [],
    patterns: tagMap.get(r.id)?.patterns ?? [],
    acceptanceRate: Number(r.acceptanceRate),
    estMinutes: r.estMinutes,
    status: asStatus(r.status, signedIn),
  }));
}

const tagExists = (slug: string, kind: "topic" | "pattern"): SQL =>
  sql`exists (select 1 from problem_tags pt join tags t on t.id = pt.tag_id
              where pt.problem_id = ${problems.id} and t.slug = ${slug} and t.kind = ${kind})`;

// ---------------------------------------------------------------- list

/** Filtered, searchable, paginated list of published problems (D1). */
export async function listProblems(
  db: Db,
  query: ProblemListQuery,
  userId: string | null,
): Promise<ProblemListResponse> {
  const conds: SQL[] = [eq(problems.status, "published")];

  if (query.difficulty.length) conds.push(inArray(problems.difficulty, query.difficulty));
  if (query.topic.length) {
    const parts = query.topic.map((s) => tagExists(s, "topic"));
    conds.push((query.topicMode === "all" ? and(...parts) : or(...parts)) as SQL);
  }
  if (query.pattern.length)
    conds.push(or(...query.pattern.map((s) => tagExists(s, "pattern"))) as SQL);
  if (query.company.length) {
    conds.push(
      sql`exists (select 1 from problem_companies pc join companies c on c.id = pc.company_id
                  where pc.problem_id = ${problems.id} and c.slug in (${sql.join(
                    query.company.map((c) => sql`${c}`),
                    sql`, `,
                  )}))`,
    );
  }
  if (query.sheet) {
    conds.push(
      sql`exists (select 1 from sheet_problems sp join sheets sh on sh.id = sp.sheet_id
                  where sp.problem_id = ${problems.id} and sh.slug = ${query.sheet})`,
    );
  }
  if (query.minAcc !== undefined) conds.push(sql`${problems.acceptanceRate} >= ${query.minAcc}`);
  if (query.maxAcc !== undefined) conds.push(sql`${problems.acceptanceRate} <= ${query.maxAcc}`);
  if (query.maxMinutes !== undefined)
    conds.push(sql`${problems.estMinutes} <= ${query.maxMinutes}`);

  if (query.status.length) {
    if (!userId) throw new AppError("UNAUTHENTICATED", 401, "Sign in to filter by your progress");
    const state = stateOf(userId);
    const parts = query.status.map((s) =>
      s === "unsolved" ? sql`(${state} is null or ${state} = 'unseen')` : sql`${state} = ${s}`,
    );
    conds.push(or(...parts) as SQL);
  }

  // search: full-text (stemmed, ranked) OR trigram similarity (typo tolerance)
  let relevance: SQL | null = null;
  if (query.q) {
    const tsq = sql`websearch_to_tsquery('english', ${query.q})`;
    conds.push(
      sql`(${problems.search} @@ ${tsq}
            or word_similarity(${query.q}, ${problems.title}) > 0.4
            or similarity(${problems.title}, ${query.q}) > 0.25)`,
    );
    relevance = sql`(ts_rank(${problems.search}, ${tsq}) + word_similarity(${query.q}, ${problems.title}))`;
  }

  let order: SQL[];
  if (query.sort === "acceptance")
    order = [sql`${problems.acceptanceRate} desc`, asc(problems.title)];
  else if (query.sort === "recent") order = [desc(problems.createdAt), asc(problems.slug)];
  else if (query.sort === "difficulty") order = [asc(problems.difficulty), asc(problems.title)];
  else if (relevance) order = [sql`${relevance} desc`, asc(problems.title)];
  else if (query.sheet) {
    order = [
      sql`(select sp.ordinal from sheet_problems sp join sheets sh on sh.id = sp.sheet_id
           where sh.slug = ${query.sheet} and sp.problem_id = ${problems.id})`,
    ];
  } else
    order = [
      asc(problems.difficulty),
      sql`${problems.estMinutes} asc nulls last`,
      asc(problems.title),
    ];

  const offset = decodeCursor(query.cursor);
  const where = and(...conds);

  const rows = await db
    .select({
      id: problems.id,
      slug: problems.slug,
      title: problems.title,
      difficulty: problems.difficulty,
      acceptanceRate: problems.acceptanceRate,
      estMinutes: problems.estMinutes,
      status: stateOf(userId).as("status"),
    })
    .from(problems)
    .where(where)
    .orderBy(...order)
    .limit(query.limit + 1)
    .offset(offset);
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(problems)
    .where(where);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  return {
    items: await toItems(db, page, userId !== null),
    nextCursor: hasMore ? encodeCursor(offset + query.limit) : null,
    total: n,
  };
}

// ---------------------------------------------------------------- detail

/** Resolves a visible problem (published or archived) by slug. Drafts and in-review problems 404. */
export async function findVisibleProblem(db: Db, slug: string) {
  const [row] = await db
    .select()
    .from(problems)
    .where(and(eq(problems.slug, slug), inArray(problems.status, ["published", "archived"])))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", 404, "Problem not found");
  return row;
}

export async function getProblem(
  db: Db,
  slug: string,
  userId: string | null,
): Promise<ProblemDetail> {
  const p = await findVisibleProblem(db, slug);
  const tagMap = await tagsFor(db, [p.id]);
  const langs = await db
    .select({
      language: problemLanguages.language,
      timeLimitMs: problemLanguages.timeLimitMs,
      memoryLimitKb: problemLanguages.memoryLimitKb,
      starterCode: problemLanguages.starterCode,
    })
    .from(problemLanguages)
    .where(eq(problemLanguages.problemId, p.id));
  const order = ["cpp", "java", "python"];
  langs.sort((a, b) => order.indexOf(a.language) - order.indexOf(b.language));

  const cos = await db
    .select({ slug: companies.slug, name: companies.name })
    .from(problemCompanies)
    .innerJoin(companies, eq(companies.id, problemCompanies.companyId))
    .where(eq(problemCompanies.problemId, p.id))
    .orderBy(asc(companies.name));

  let state: ProblemDetail["state"] = null;
  let bookmarked: boolean | null = null;
  if (userId) {
    const [s] = await db
      .select({ status: userProblemState.status, attempts: userProblemState.attempts })
      .from(userProblemState)
      .where(and(eq(userProblemState.userId, userId), eq(userProblemState.problemId, p.id)))
      .limit(1);
    state = { status: (s?.status ?? "unseen") as ProblemStatus, attempts: s?.attempts ?? 0 };
    const [b] = await db
      .select({ folder: bookmarks.folder })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.problemId, p.id)))
      .limit(1);
    bookmarked = b !== undefined;
  }

  return {
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    statementMd: p.statementMd,
    constraintsMd: p.constraintsMd,
    examples: p.examples,
    topics: tagMap.get(p.id)?.topics ?? [],
    patterns: tagMap.get(p.id)?.patterns ?? [],
    companies: cos,
    estMinutes: p.estMinutes,
    acceptanceRate: Number(p.acceptanceRate),
    version: p.currentVersion,
    archived: p.status === "archived",
    languages: langs as ProblemDetail["languages"],
    state,
    bookmarked,
  };
}

// ---------------------------------------------------------------- facets and sheets

/** Tags with the number of published problems using them; `includeEmpty` also lists unused tags (for admin forms). */
export async function tagFacets(db: Db, includeEmpty = false): Promise<TagFacets> {
  const rows = await db
    .select({
      slug: tags.slug,
      name: tags.name,
      kind: tags.kind,
      count: sql<number>`count(${problems.id})::int`,
    })
    .from(tags)
    .leftJoin(problemTags, eq(problemTags.tagId, tags.id))
    .leftJoin(
      problems,
      and(eq(problems.id, problemTags.problemId), eq(problems.status, "published")),
    )
    .groupBy(tags.id)
    .orderBy(asc(tags.name));
  const facets: TagFacets = { topics: [], patterns: [] };
  for (const r of rows) {
    if (r.count === 0 && !includeEmpty) continue;
    (r.kind === "topic" ? facets.topics : facets.patterns).push({
      slug: r.slug,
      name: r.name,
      count: r.count,
    });
  }
  return facets;
}

export async function companyFacets(db: Db) {
  return db
    .select({
      slug: companies.slug,
      name: companies.name,
      count: sql<number>`count(${problems.id})::int`,
    })
    .from(companies)
    .innerJoin(problemCompanies, eq(problemCompanies.companyId, companies.id))
    .innerJoin(
      problems,
      and(eq(problems.id, problemCompanies.problemId), eq(problems.status, "published")),
    )
    .groupBy(companies.id)
    .orderBy(asc(companies.name));
}

export async function listSheets(db: Db, userId: string | null): Promise<SheetSummary[]> {
  const rows = await db
    .select({
      slug: sheets.slug,
      title: sheets.title,
      description: sheets.description,
      total: sql<number>`count(${problems.id})::int`,
      solved: userId
        ? sql<number>`count(*) filter (where ${userProblemState.status} = 'solved')::int`
        : sql<null>`null`,
    })
    .from(sheets)
    .leftJoin(sheetProblems, eq(sheetProblems.sheetId, sheets.id))
    .leftJoin(
      problems,
      and(eq(problems.id, sheetProblems.problemId), eq(problems.status, "published")),
    )
    .leftJoin(
      userProblemState,
      userId
        ? and(eq(userProblemState.problemId, problems.id), eq(userProblemState.userId, userId))
        : sql`false`,
    )
    .where(eq(sheets.visibility, "public"))
    .groupBy(sheets.id)
    .orderBy(asc(sheets.title));
  return rows;
}

export async function getSheet(db: Db, slug: string, userId: string | null): Promise<SheetDetail> {
  const [sheet] = await db
    .select()
    .from(sheets)
    .where(and(eq(sheets.slug, slug), eq(sheets.visibility, "public")))
    .limit(1);
  if (!sheet) throw new AppError("NOT_FOUND", 404, "Sheet not found");

  const rows = await db
    .select({
      id: problems.id,
      slug: problems.slug,
      title: problems.title,
      difficulty: problems.difficulty,
      acceptanceRate: problems.acceptanceRate,
      estMinutes: problems.estMinutes,
      status: stateOf(userId).as("status"),
      section: sheetProblems.section,
    })
    .from(sheetProblems)
    .innerJoin(
      problems,
      and(eq(problems.id, sheetProblems.problemId), eq(problems.status, "published")),
    )
    .where(eq(sheetProblems.sheetId, sheet.id))
    .orderBy(asc(sheetProblems.ordinal));

  const items = await toItems(db, rows, userId !== null);
  const sections: SheetDetail["sections"] = [];
  rows.forEach((row, i) => {
    const name = row.section ?? "Problems";
    let section = sections[sections.length - 1];
    if (!section || section.name !== name) {
      section = { name, problems: [] };
      sections.push(section);
    }
    section.problems.push(items[i] as ProblemListItem);
  });
  const solved = userId ? items.filter((i) => i.status === "solved").length : null;
  return {
    slug: sheet.slug,
    title: sheet.title,
    description: sheet.description,
    total: items.length,
    solved,
    sections,
  };
}

// ---------------------------------------------------------------- drafts (D2)

const HISTORY_MIN_GAP_MS = 60_000;
const HISTORY_KEEP = 5;

function toDraft(row: typeof codeDrafts.$inferSelect): Draft {
  return {
    code: row.code,
    cursor: (row.cursor as Draft["cursor"]) ?? null,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getDraft(
  db: Db,
  userId: string,
  problemId: string,
  language: LanguageValue,
): Promise<Draft | null> {
  const [row] = await db
    .select()
    .from(codeDrafts)
    .where(
      and(
        eq(codeDrafts.userId, userId),
        eq(codeDrafts.problemId, problemId),
        eq(codeDrafts.language, language),
      ),
    )
    .limit(1);
  return row ? toDraft(row) : null;
}

/**
 * Saves an autosaved draft with optimistic concurrency: `baseVersion` must equal the stored version,
 * otherwise 409 with the current draft so the client can prompt ("a newer draft exists"). When the
 * previous code is replaced, it is snapshotted into history at most once a minute (last 5 kept).
 */
export async function saveDraft(
  db: Database,
  userId: string,
  problemId: string,
  language: LanguageValue,
  input: DraftSave,
): Promise<Draft> {
  return withTransaction(db, async (tx) => {
    const key = and(
      eq(codeDrafts.userId, userId),
      eq(codeDrafts.problemId, problemId),
      eq(codeDrafts.language, language),
    );
    const [existing] = await tx.select().from(codeDrafts).where(key).for("update").limit(1);
    const stale = (existing?.version ?? 0) !== input.baseVersion;
    if (stale) {
      throw new AppError("CONFLICT", 409, "A newer draft exists", {
        current: existing ? toDraft(existing) : null,
      });
    }

    if (!existing) {
      const [created] = await tx
        .insert(codeDrafts)
        .values({
          userId,
          problemId,
          language,
          code: input.code,
          cursor: input.cursor ?? null,
          version: 1,
        })
        .returning();
      return toDraft(created as typeof codeDrafts.$inferSelect);
    }

    const unchanged = existing.code === input.code;
    if (unchanged && !input.cursor) return toDraft(existing);

    if (!unchanged) {
      const [last] = await tx
        .select({ savedAt: draftHistory.savedAt })
        .from(draftHistory)
        .where(
          and(
            eq(draftHistory.userId, userId),
            eq(draftHistory.problemId, problemId),
            eq(draftHistory.language, language),
          ),
        )
        .orderBy(desc(draftHistory.savedAt))
        .limit(1);
      if (!last || Date.now() - last.savedAt.getTime() >= HISTORY_MIN_GAP_MS) {
        await tx
          .insert(draftHistory)
          .values({ id: newId(), userId, problemId, language, code: existing.code });
        await tx.execute(sql`
          delete from draft_history where id in (
            select id from draft_history
            where user_id = ${userId} and problem_id = ${problemId} and language = ${language}
            order by saved_at desc offset ${HISTORY_KEEP})`);
      }
    }
    const [updated] = await tx
      .update(codeDrafts)
      .set({
        code: input.code,
        cursor: input.cursor ?? existing.cursor,
        version: existing.version + 1,
      })
      .where(key)
      .returning();
    return toDraft(updated as typeof codeDrafts.$inferSelect);
  });
}

export async function draftHistoryFor(
  db: Db,
  userId: string,
  problemId: string,
  language: LanguageValue,
): Promise<DraftHistoryItem[]> {
  const rows = await db
    .select({ code: draftHistory.code, savedAt: draftHistory.savedAt })
    .from(draftHistory)
    .where(
      and(
        eq(draftHistory.userId, userId),
        eq(draftHistory.problemId, problemId),
        eq(draftHistory.language, language),
      ),
    )
    .orderBy(desc(draftHistory.savedAt))
    .limit(HISTORY_KEEP);
  return rows.map((r) => ({ code: r.code, savedAt: r.savedAt.toISOString() }));
}

// ---------------------------------------------------------------- custom tests (D2)

export async function listCustomTests(
  db: Db,
  userId: string,
  problemId: string,
): Promise<CustomTest[]> {
  return db
    .select({ id: customTests.id, label: customTests.label, input: customTests.input })
    .from(customTests)
    .where(and(eq(customTests.userId, userId), eq(customTests.problemId, problemId)))
    .orderBy(asc(customTests.createdAt));
}

export async function addCustomTest(
  db: Database,
  userId: string,
  problemId: string,
  input: { label?: string | undefined; input: string },
): Promise<CustomTest> {
  return withTransaction(db, async (tx) => {
    // serialize concurrent adds per user+problem so the cap can't be raced
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`custom-tests:${userId}:${problemId}`}))`,
    );
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(customTests)
      .where(and(eq(customTests.userId, userId), eq(customTests.problemId, problemId)));
    if (n >= MAX_CUSTOM_TESTS) {
      throw new AppError(
        "QUOTA_EXCEEDED",
        429,
        `You can keep up to ${MAX_CUSTOM_TESTS} custom tests per problem`,
      );
    }
    const [row] = await tx
      .insert(customTests)
      .values({
        id: newId(),
        userId,
        problemId,
        label: input.label?.trim() || null,
        input: input.input,
      })
      .returning({ id: customTests.id, label: customTests.label, input: customTests.input });
    return row as CustomTest;
  });
}

export async function deleteCustomTest(
  db: Db,
  userId: string,
  problemId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(customTests)
    .where(
      and(
        eq(customTests.id, id),
        eq(customTests.userId, userId),
        eq(customTests.problemId, problemId),
      ),
    )
    .returning({ id: customTests.id });
  return rows.length > 0;
}
