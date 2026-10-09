import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import {
  adminAuditLog,
  hints,
  newId,
  problemLanguages,
  problems,
  problemTags,
  problemVersions,
  tags,
  testCases,
  users,
  withTransaction,
  type Database,
  type Db,
} from "@prepquest/db";
import {
  AppError,
  type AdminProblemDetail,
  type AdminProblemListItem,
  type AuditEntry,
  type CreateProblem,
  type ProblemStatusValue,
  type Signature,
  type UpdateProblem,
  type UserRole,
  type ValidationCheck,
  type ValidationReport,
  type VersionInfo,
} from "@prepquest/shared";
import {
  generateStarter,
  hasErrors,
  languageLimits,
  syncTags,
  testKey,
  upsertLanguages,
  validateTests,
  LANGUAGES,
  type Issue,
  type Language,
  type ProblemBundle,
  type TestFile,
} from "@prepquest/content";
import type { ObjectStore } from "@prepquest/storage";
import { readTestZip } from "./zip.js";

export interface Actor {
  id: string;
  role: UserRole;
  ip: string | null;
}

export interface AdminContext {
  db: Database;
  store: ObjectStore;
  allowSelfPublish: boolean;
}

type ProblemRow = typeof problems.$inferSelect;

// ---------------------------------------------------------------- audit

export async function audit(
  db: Db,
  actor: Actor,
  entry: {
    action: string;
    entityId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    reason?: string | undefined;
  },
): Promise<void> {
  await db.insert(adminAuditLog).values({
    id: newId(),
    actorId: actor.id,
    actorRole: actor.role,
    action: entry.action,
    entityType: "problem",
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    ip: actor.ip,
  });
}

export async function listAudit(
  db: Db,
  entityId: string | undefined,
  limit = 100,
): Promise<AuditEntry[]> {
  const rows = await db
    .select()
    .from(adminAuditLog)
    .where(entityId ? eq(adminAuditLog.entityId, entityId) : undefined)
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(Math.min(limit, 200));
  return rows.map((r) => ({
    id: r.id,
    actorId: r.actorId,
    actorRole: r.actorRole,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    before: r.before,
    after: r.after,
  }));
}

// ---------------------------------------------------------------- permissions

const REVIEW_ROLES: UserRole[] = ["reviewer", "admin"];

/**
 * Who may do what (doc 17 §8). Editors work on their own drafts; reviewers and admins work on anything
 * that isn't archived and are the only ones who publish or archive. Authors can't publish their own
 * problems unless ALLOW_SELF_PUBLISH is on (separation of duties).
 */
export function permissionsFor(
  ctx: Pick<AdminContext, "allowSelfPublish">,
  actor: Actor,
  p: ProblemRow,
) {
  const reviewer = REVIEW_ROLES.includes(actor.role);
  const ownDraft = p.status === "draft" && p.createdBy === actor.id;
  const edit = reviewer ? p.status !== "archived" : ownDraft;
  const selfBlocked = p.createdBy === actor.id && !ctx.allowSelfPublish;
  return {
    edit,
    uploadTests: edit,
    submitReview: edit && p.status === "draft",
    publish: reviewer && (p.status === "in_review" || p.status === "draft") && !selfBlocked,
    archive: reviewer && p.status === "published",
  };
}

async function loadProblem(db: Db, id: string): Promise<ProblemRow> {
  const [row] = await db.select().from(problems).where(eq(problems.id, id)).limit(1);
  if (!row) throw new AppError("NOT_FOUND", 404, "Problem not found");
  return row;
}

function requireAllowed(allowed: boolean, what: string): void {
  if (!allowed) throw new AppError("FORBIDDEN", 403, `You can't ${what} this problem`);
}

// ---------------------------------------------------------------- list and detail

export async function listAdminProblems(
  db: Db,
  query: { status?: ProblemStatusValue | undefined; q?: string | undefined; limit: number },
): Promise<AdminProblemListItem[]> {
  const conds = [
    query.status ? eq(problems.status, query.status) : undefined,
    query.q ? ilike(problems.title, `%${query.q.replace(/[%_\\]/g, "\\$&")}%`) : undefined,
  ].filter((c) => c !== undefined);
  const rows = await db
    .select({
      id: problems.id,
      slug: problems.slug,
      title: problems.title,
      difficulty: problems.difficulty,
      status: problems.status,
      version: problems.currentVersion,
      createdBy: problems.createdBy,
      updatedAt: problems.updatedAt,
      // NOTE: raw qualified names on purpose. In a single-table SELECT list drizzle renders `${problems.id}`
      // unqualified, which a correlated subquery would bind to its own `tc.id`.
      tests: sql<number>`(select count(*)::int from test_cases tc where tc.problem_id = problems.id and tc.version = problems.current_version)`,
    })
    .from(problems)
    .where(and(...conds))
    .orderBy(desc(problems.updatedAt), asc(problems.slug))
    .limit(query.limit);
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function getAdminProblem(
  ctx: AdminContext,
  actor: Actor,
  id: string,
): Promise<AdminProblemDetail> {
  const p = await loadProblem(ctx.db, id);
  const tagRows = await ctx.db
    .select({ slug: tags.slug, kind: tags.kind })
    .from(problemTags)
    .innerJoin(tags, eq(tags.id, problemTags.tagId))
    .where(eq(problemTags.problemId, id))
    .orderBy(asc(tags.slug));
  const langs = await ctx.db
    .select()
    .from(problemLanguages)
    .where(eq(problemLanguages.problemId, id));
  const hintRows = await ctx.db
    .select()
    .from(hints)
    .where(eq(hints.problemId, id))
    .orderBy(asc(hints.tier));
  const cases = await ctx.db
    .select()
    .from(testCases)
    .where(and(eq(testCases.problemId, id), eq(testCases.version, p.currentVersion)))
    .orderBy(asc(testCases.ordinal));

  const lang = (l: Language) => langs.find((x) => x.language === l);
  const cpp = lang("cpp");
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    status: p.status,
    version: p.currentVersion,
    tests: cases.length,
    createdBy: p.createdBy,
    updatedAt: p.updatedAt.toISOString(),
    statementMd: p.statementMd,
    constraintsMd: p.constraintsMd,
    examples: p.examples,
    topics: tagRows.filter((t) => t.kind === "topic").map((t) => t.slug),
    patterns: tagRows.filter((t) => t.kind === "pattern").map((t) => t.slug),
    estMinutes: p.estMinutes,
    signature: p.signature as Signature | null,
    limits: { timeLimitMs: cpp?.timeLimitMs ?? 1000, memoryLimitKb: cpp?.memoryLimitKb ?? 262_144 },
    starters: {
      cpp: lang("cpp")?.starterCode ?? "",
      java: lang("java")?.starterCode ?? "",
      python: lang("python")?.starterCode ?? "",
    },
    hints: hintRows.map((h) => ({ tier: h.tier as 1 | 2 | 3, bodyMd: h.bodyMd })),
    testCases: cases.map((c) => ({
      ordinal: c.ordinal,
      kind: c.kind as AdminProblemDetail["testCases"][number]["kind"],
      label: c.label,
      weight: c.weight,
      inputBytes: c.inputBytes,
    })),
    permissions: permissionsFor(ctx, actor, p),
  };
}

// ---------------------------------------------------------------- create and edit

async function assertTagsExist(db: Db, slugs: string[]): Promise<void> {
  if (slugs.length === 0) return;
  const found = await db.select({ slug: tags.slug }).from(tags).where(inArray(tags.slug, slugs));
  const missing = slugs.filter((s) => !found.some((f) => f.slug === s));
  if (missing.length) {
    throw new AppError("VALIDATION_FAILED", 422, "Invalid input", {
      fields: { topics: `Unknown tag(s): ${missing.join(", ")}` },
    });
  }
}

export async function createProblem(
  ctx: AdminContext,
  actor: Actor,
  input: CreateProblem,
): Promise<AdminProblemDetail> {
  await assertTagsExist(ctx.db, [...input.topics, ...input.patterns]);
  const id = newId();
  try {
    await withTransaction(ctx.db, async (tx) => {
      await tx.insert(problems).values({
        id,
        slug: input.slug,
        title: input.title,
        statementMd: input.statementMd,
        constraintsMd: input.constraintsMd || null,
        difficulty: input.difficulty,
        examples: [],
        signature: input.signature,
        estMinutes: input.estMinutes,
        source: "Created in the admin panel",
        license: "unspecified",
        status: "draft",
        currentVersion: 1,
        createdBy: actor.id,
      });
      await tx.insert(problemVersions).values({
        problemId: id,
        version: 1,
        snapshot: { title: input.title, tests: 0, created: true },
        changedBy: actor.id,
        changeNote: "created",
      });
      const bundleLike = {
        meta: { limits: { timeLimitMs: 1000, memoryLimitKb: 262_144 } },
        signature: input.signature,
      } as unknown as ProblemBundle;
      const starters = Object.fromEntries(
        LANGUAGES.map((l) => [l, generateStarter(l, input.signature)]),
      ) as Record<Language, string>;
      await upsertLanguages(tx, id, bundleLike, starters);
      await syncTags(tx, id, [...input.topics, ...input.patterns]);
      await audit(tx, actor, {
        action: "problem.create",
        entityId: id,
        after: { slug: input.slug, title: input.title },
      });
    });
  } catch (err) {
    const cause = ((err as { cause?: unknown }).cause ?? err) as { code?: string };
    if (cause.code === "23505")
      throw new AppError("CONFLICT", 409, "That slug is already taken", { field: "slug" });
    throw err;
  }
  return getAdminProblem(ctx, actor, id);
}

const VERSIONED = ["statementMd", "constraintsMd", "examples", "limits", "starters"] as const;

/**
 * Edits a problem. Changes to the statement, examples, limits or starters create a new version (old
 * versions keep their tests for old submissions); title, tags and estimates don't. Test rows are copied
 * forward so the new version keeps its tests.
 */
export async function updateProblem(
  ctx: AdminContext,
  actor: Actor,
  id: string,
  input: UpdateProblem,
): Promise<AdminProblemDetail> {
  const before = await loadProblem(ctx.db, id);
  requireAllowed(permissionsFor(ctx, actor, before).edit, "edit");
  const nextTags = [...(input.topics ?? []), ...(input.patterns ?? [])];
  await assertTagsExist(ctx.db, nextTags);

  const current = await getAdminProblem(ctx, actor, id);
  const bump = VERSIONED.some(
    (k) =>
      input[k] !== undefined &&
      JSON.stringify(input[k]) !== JSON.stringify(current[k as keyof AdminProblemDetail]),
  );

  await withTransaction(ctx.db, async (tx) => {
    const set: Partial<typeof problems.$inferInsert> = {};
    if (input.title !== undefined) set.title = input.title;
    if (input.difficulty !== undefined) set.difficulty = input.difficulty;
    if (input.statementMd !== undefined) set.statementMd = input.statementMd;
    if (input.constraintsMd !== undefined) set.constraintsMd = input.constraintsMd || null;
    if (input.examples !== undefined) set.examples = input.examples;
    if (input.estMinutes !== undefined) set.estMinutes = input.estMinutes;

    let version = before.currentVersion;
    if (bump) {
      version = before.currentVersion + 1;
      set.currentVersion = version;
      const rows = await tx
        .select()
        .from(testCases)
        .where(and(eq(testCases.problemId, id), eq(testCases.version, before.currentVersion)));
      if (rows.length) {
        await tx.insert(testCases).values(
          rows.map((r) => ({
            ...r,
            id: newId(),
            version,
            createdAt: undefined,
            updatedAt: undefined,
          })),
        );
      }
      await tx.insert(problemVersions).values({
        problemId: id,
        version,
        snapshot: { title: input.title ?? before.title, tests: rows.length, edited: true },
        changedBy: actor.id,
        changeNote: "edited in admin",
      });
    }
    if (Object.keys(set).length) await tx.update(problems).set(set).where(eq(problems.id, id));
    if (input.topics !== undefined || input.patterns !== undefined) {
      const topics = input.topics ?? current.topics;
      const patterns = input.patterns ?? current.patterns;
      await syncTags(tx, id, [...topics, ...patterns]);
    }
    if (input.limits !== undefined || input.starters !== undefined) {
      const limits = input.limits ?? current.limits;
      const starters = { ...current.starters, ...input.starters };
      for (const language of LANGUAGES) {
        await tx
          .update(problemLanguages)
          .set({
            ...languageLimits(language, limits.timeLimitMs, limits.memoryLimitKb),
            starterCode: starters[language],
          })
          .where(and(eq(problemLanguages.problemId, id), eq(problemLanguages.language, language)));
      }
    }
    const changed = Object.keys(input);
    await audit(tx, actor, {
      action: "problem.update",
      entityId: id,
      before: Object.fromEntries(
        changed.map((k) => [k, current[k as keyof AdminProblemDetail] ?? null]),
      ) as Record<string, unknown>,
      after: Object.fromEntries(
        changed.map((k) => [k, input[k as keyof UpdateProblem] ?? null]),
      ) as Record<string, unknown>,
    });
  });
  return getAdminProblem(ctx, actor, id);
}

// ---------------------------------------------------------------- tests: upload and validation

async function storedTests(
  ctx: AdminContext,
  p: ProblemRow,
): Promise<{ tests: TestFile[]; issues: Issue[] }> {
  const rows = await ctx.db
    .select()
    .from(testCases)
    .where(and(eq(testCases.problemId, p.id), eq(testCases.version, p.currentVersion)))
    .orderBy(asc(testCases.ordinal));
  const issues: Issue[] = [];
  const tests: TestFile[] = [];
  for (const r of rows) {
    try {
      const [input, output] = await Promise.all([
        ctx.store.get(r.inputKey),
        ctx.store.get(r.outputKey),
      ]);
      tests.push({
        ordinal: r.ordinal,
        kind: r.kind as TestFile["kind"],
        label: r.label ?? undefined,
        weight: r.weight,
        input: input.toString("utf8"),
        output: output.toString("utf8"),
      });
    } catch {
      issues.push({
        level: "error",
        problem: p.slug,
        message: `test ${r.ordinal}: data missing from storage`,
      });
    }
  }
  return { tests, issues };
}

/** The pre-publish checklist (doc 17 §3). Reference-solution and mutation checks aren't available yet. */
export async function validateProblem(ctx: AdminContext, id: string): Promise<ValidationReport> {
  const p = await loadProblem(ctx.db, id);
  const checks: ValidationCheck[] = [];
  const add = (
    id: string,
    label: string,
    ok: boolean,
    detail?: string,
    level: "fail" | "warn" = "fail",
  ) => checks.push({ id, label, status: ok ? "pass" : level, ...(detail ? { detail } : {}) });

  const tagCount =
    (
      await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(problemTags)
        .where(eq(problemTags.problemId, id))
    )[0]?.n ?? 0;
  add("tags", "Has at least one topic tag", tagCount > 0);
  add("statement", "Statement is written (60+ characters)", p.statementMd.trim().length >= 60);
  add("constraints", "Constraints are written", (p.constraintsMd ?? "").trim().length >= 10);
  add("examples", "Has at least one example", p.examples.length > 0);
  add(
    "signature",
    "Has a function signature",
    p.signature !== null,
    "needed to validate tests and generate drivers",
  );

  const langs = await ctx.db
    .select()
    .from(problemLanguages)
    .where(eq(problemLanguages.problemId, id));
  const missingStarters = LANGUAGES.filter(
    (l) => !langs.find((x) => x.language === l)?.starterCode.trim(),
  );
  add(
    "starters",
    "Starter code for C++, Java and Python",
    missingStarters.length === 0,
    missingStarters.length ? `missing: ${missingStarters.join(", ")}` : undefined,
  );

  if (!p.signature) {
    checks.push({
      id: "tests",
      label: "Tests are valid",
      status: "skip",
      detail: "needs a signature",
    });
  } else {
    const { tests, issues } = await storedTests(ctx, p);
    const all = [
      ...issues,
      ...validateTests(p.slug, p.signature as Signature, p.difficulty, p.examples.length, tests),
    ];
    const errors = all.filter((i) => i.level === "error");
    const warnings = all.filter((i) => i.level === "warning");
    checks.push({
      id: "tests",
      label: `Tests are valid (${tests.length} found)`,
      status: errors.length ? "fail" : warnings.length ? "warn" : "pass",
      ...(errors.length || warnings.length
        ? {
            detail: [...errors, ...warnings]
              .slice(0, 5)
              .map((i) => i.message)
              .join("; "),
          }
        : {}),
    });
  }

  const hintCount =
    (
      await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(hints)
        .where(eq(hints.problemId, id))
    )[0]?.n ?? 0;
  add("hints", "Three hint tiers", hintCount >= 3, `${hintCount} of 3 written`, "warn");
  checks.push({
    id: "reference",
    label: "Reference solution passes all tests",
    status: "skip",
    detail: "runs once the judge exists",
  });
  checks.push({
    id: "mutants",
    label: "Mutant solutions fail as expected",
    status: "skip",
    detail: "runs once the judge exists",
  });
  return { ok: !checks.some((c) => c.status === "fail"), checks };
}

export async function uploadTests(
  ctx: AdminContext,
  actor: Actor,
  id: string,
  zip: Buffer,
): Promise<{ version: number; tests: number; warnings: string[] }> {
  const p = await loadProblem(ctx.db, id);
  requireAllowed(permissionsFor(ctx, actor, p).uploadTests, "upload tests for");
  if (!p.signature)
    throw new AppError(
      "CONFLICT",
      409,
      "Give the problem a function signature before uploading tests",
    );

  const { tests, issues } = readTestZip(zip, p.slug);
  const all = [
    ...issues,
    ...validateTests(p.slug, p.signature as Signature, p.difficulty, p.examples.length, tests),
  ];
  if (hasErrors(all)) {
    throw new AppError("VALIDATION_FAILED", 422, "The test zip has problems", {
      issues: all.map((i) => ({ level: i.level, message: i.message })).slice(0, 50),
    });
  }

  const version = p.currentVersion + 1;
  for (const t of tests) {
    await ctx.store.put(testKey(p.slug, version, t.ordinal, "in"), t.input, "text/plain");
    await ctx.store.put(testKey(p.slug, version, t.ordinal, "out"), t.output, "text/plain");
  }
  await withTransaction(ctx.db, async (tx) => {
    await tx.insert(testCases).values(
      tests.map((t) => ({
        id: newId(),
        problemId: id,
        version,
        ordinal: t.ordinal,
        kind: t.kind,
        label: t.label ?? null,
        inputKey: testKey(p.slug, version, t.ordinal, "in"),
        outputKey: testKey(p.slug, version, t.ordinal, "out"),
        inputBytes: Buffer.byteLength(t.input),
        weight: t.weight,
      })),
    );
    await tx.update(problems).set({ currentVersion: version }).where(eq(problems.id, id));
    await tx.insert(problemVersions).values({
      problemId: id,
      version,
      snapshot: { title: p.title, tests: tests.length, testsUploaded: true },
      changedBy: actor.id,
      changeNote: `tests uploaded (${tests.length})`,
    });
    await audit(tx, actor, {
      action: "problem.tests.upload",
      entityId: id,
      before: { version: p.currentVersion },
      after: { version, tests: tests.length },
    });
  });
  return {
    version,
    tests: tests.length,
    warnings: all.filter((i) => i.level === "warning").map((i) => i.message),
  };
}

// ---------------------------------------------------------------- workflow

async function transition(
  ctx: AdminContext,
  actor: Actor,
  id: string,
  action: "submit-review" | "publish" | "archive",
  reason?: string,
): Promise<AdminProblemDetail> {
  const p = await loadProblem(ctx.db, id);
  const perms = permissionsFor(ctx, actor, p);

  if (action === "submit-review") {
    requireAllowed(perms.submitReview, "submit for review");
  } else if (action === "publish") {
    if (p.createdBy === actor.id && !ctx.allowSelfPublish && REVIEW_ROLES.includes(actor.role)) {
      throw new AppError(
        "FORBIDDEN",
        403,
        "You can't publish your own problem. Ask another reviewer.",
      );
    }
    requireAllowed(perms.publish, "publish");
  } else {
    requireAllowed(perms.archive, "archive");
  }
  if (action !== "archive") {
    const report = await validateProblem(ctx, id);
    if (!report.ok) {
      const failing = report.checks.filter((c) => c.status === "fail").map((c) => c.label);
      throw new AppError("VALIDATION_FAILED", 422, `Fix these first: ${failing.join("; ")}`, {
        checks: report.checks,
      });
    }
  }

  const status: ProblemStatusValue =
    action === "submit-review" ? "in_review" : action === "publish" ? "published" : "archived";
  await withTransaction(ctx.db, async (tx) => {
    await tx.update(problems).set({ status }).where(eq(problems.id, id));
    await audit(tx, actor, {
      action: `problem.${action}`,
      entityId: id,
      before: { status: p.status },
      after: { status },
      reason,
    });
  });
  return getAdminProblem(ctx, actor, id);
}

export const submitForReview = (ctx: AdminContext, actor: Actor, id: string) =>
  transition(ctx, actor, id, "submit-review");
export const publishProblem = (ctx: AdminContext, actor: Actor, id: string) =>
  transition(ctx, actor, id, "publish");
export const archiveProblem = (ctx: AdminContext, actor: Actor, id: string, reason: string) =>
  transition(ctx, actor, id, "archive", reason);

// ---------------------------------------------------------------- versions

export async function listVersions(db: Db, id: string): Promise<VersionInfo[]> {
  const p = await loadProblem(db, id);
  const rows = await db
    .select()
    .from(problemVersions)
    .where(eq(problemVersions.problemId, id))
    .orderBy(desc(problemVersions.version));
  return rows.map((r) => ({
    version: r.version,
    changedBy: r.changedBy,
    changeNote: r.changeNote,
    createdAt: r.createdAt.toISOString(),
    tests: typeof r.snapshot.tests === "number" ? r.snapshot.tests : null,
    current: r.version === p.currentVersion,
  }));
}

/** Display name for actors in audit/version lists. */
export async function actorNames(db: Db, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => x !== null))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.email]));
}
