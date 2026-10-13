import { and, eq, inArray } from "drizzle-orm";
import {
  companies,
  editorials,
  hints,
  newId,
  problemCompanies,
  problemLanguages,
  problems,
  problemTags,
  problemVersions,
  sheetProblems,
  sheets,
  tags,
  testCases,
  withTransaction,
  type Database,
  type Db,
} from "@prepquest/db";
import type { ObjectStore } from "@prepquest/storage";
import { formatExample } from "./format.js";
import { contentHash } from "./hash.js";
import { loadProblem, testFileName } from "./loader.js";
import { generateStarter } from "./starter.js";
import { LANGUAGES, type Language, type ProblemBundle, type SheetFile } from "./types.js";

export type ImportAction = "created" | "updated" | "unchanged";

export interface ImportResult {
  slug: string;
  action: ImportAction;
  version: number;
}

/** Per-language limits from the C++ base (doc 12 §3: Java 2x + 0.3 s and 2x memory, Python 5x). */
export function languageLimits(language: Language, baseMs: number, baseKb: number) {
  switch (language) {
    case "cpp":
      return { timeLimitMs: baseMs, memoryLimitKb: baseKb };
    case "java":
      return { timeLimitMs: baseMs * 2 + 300, memoryLimitKb: baseKb * 2 };
    case "python":
      return { timeLimitMs: baseMs * 5, memoryLimitKb: baseKb };
  }
}

/** Starters the problem will ship with: author files win, the rest are generated from the signature. */
export function resolveStarters(bundle: ProblemBundle): Record<Language, string> {
  return Object.fromEntries(
    LANGUAGES.map((l) => [l, bundle.starters[l] ?? generateStarter(l, bundle.signature)]),
  ) as Record<Language, string>;
}

export const testKey = (slug: string, version: number, ordinal: number, ext: "in" | "out") =>
  `problems/${slug}/v${version}/${testFileName(ordinal, ext)}`;

const titleCase = (slug: string) =>
  slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * Idempotent upsert of one problem. If the content hash matches the current version nothing changes;
 * otherwise a new version is written (old versions and their test rows stay for old submissions).
 */
export async function importProblem(
  db: Database,
  store: ObjectStore,
  bundle: ProblemBundle,
  options: { publish?: boolean; changedBy?: string | null; changeNote?: string } = {},
): Promise<ImportResult> {
  const { meta } = bundle;
  const starters = resolveStarters(bundle);
  const hash = contentHash(bundle, starters);

  const [existing] = await db.select().from(problems).where(eq(problems.slug, meta.slug)).limit(1);

  if (existing) {
    const [current] = await db
      .select({ snapshot: problemVersions.snapshot })
      .from(problemVersions)
      .where(
        and(
          eq(problemVersions.problemId, existing.id),
          eq(problemVersions.version, existing.currentVersion),
        ),
      )
      .limit(1);
    if (current?.snapshot.contentHash === hash) {
      const patch = {
        // older imports predate the signature column: backfill without creating a new version
        ...(existing.signature ? {} : { signature: bundle.signature }),
        ...(options.publish && existing.status === "draft" ? { status: "published" as const } : {}),
      };
      if (Object.keys(patch).length > 0)
        await db.update(problems).set(patch).where(eq(problems.id, existing.id));
      await syncLearningContent(db, existing.id, bundle);
      return { slug: meta.slug, action: "unchanged", version: existing.currentVersion };
    }
  }

  const version = existing ? existing.currentVersion + 1 : 1;
  const problemId = existing?.id ?? newId();

  // test data goes to object storage first; rows reference it by key
  for (const t of bundle.tests) {
    await store.put(testKey(meta.slug, version, t.ordinal, "in"), t.input, "text/plain");
    await store.put(testKey(meta.slug, version, t.ordinal, "out"), t.output, "text/plain");
  }

  await withTransaction(db, async (tx) => {
    const fields = {
      title: meta.title,
      statementMd: bundle.statementMd,
      constraintsMd: bundle.constraintsMd,
      difficulty: meta.difficulty,
      examples: bundle.examples.map((e) => formatExample(bundle.signature, e)),
      signature: bundle.signature,
      checker: meta.checker,
      estMinutes: meta.estMinutes,
      source: meta.source,
      license: meta.license,
      currentVersion: version,
    };
    if (existing) {
      await tx
        .update(problems)
        .set({
          ...fields,
          ...(options.publish && existing.status === "draft"
            ? { status: "published" as const }
            : {}),
        })
        .where(eq(problems.id, problemId));
    } else {
      await tx.insert(problems).values({
        id: problemId,
        slug: meta.slug,
        ...fields,
        status: options.publish ? "published" : "draft",
      });
    }

    await tx.insert(problemVersions).values({
      problemId,
      version,
      snapshot: {
        contentHash: hash,
        title: meta.title,
        tests: bundle.tests.length,
        difficulty: meta.difficulty,
      },
      changedBy: options.changedBy ?? null,
      changeNote: options.changeNote ?? "content import",
    });

    await upsertLanguages(tx, problemId, bundle, starters);
    await tx.insert(testCases).values(
      bundle.tests.map((t) => ({
        id: newId(),
        problemId,
        version,
        ordinal: t.ordinal,
        kind: t.kind,
        label: t.label ?? null,
        inputKey: testKey(meta.slug, version, t.ordinal, "in"),
        outputKey: testKey(meta.slug, version, t.ordinal, "out"),
        inputBytes: Buffer.byteLength(t.input),
        weight: t.weight,
      })),
    );
    await syncTags(tx, problemId, [...meta.topics, ...meta.patterns]);
    await syncCompanies(tx, problemId, meta.companies);
    await syncLearningContent(tx, problemId, bundle);
  });

  return { slug: meta.slug, action: existing ? "updated" : "created", version };
}

export async function upsertLanguages(
  tx: Db,
  problemId: string,
  bundle: ProblemBundle,
  starters: Record<Language, string>,
) {
  for (const language of LANGUAGES) {
    const limits = languageLimits(
      language,
      bundle.meta.limits.timeLimitMs,
      bundle.meta.limits.memoryLimitKb,
    );
    await tx
      .insert(problemLanguages)
      .values({ problemId, language, ...limits, starterCode: starters[language], driverCode: null })
      .onConflictDoUpdate({
        target: [problemLanguages.problemId, problemLanguages.language],
        set: { ...limits, starterCode: starters[language] },
      });
  }
}

export async function syncTags(tx: Db, problemId: string, slugs: string[]) {
  const found = slugs.length
    ? await tx.select({ id: tags.id, slug: tags.slug }).from(tags).where(inArray(tags.slug, slugs))
    : [];
  const missing = slugs.filter((s) => !found.some((f) => f.slug === s));
  if (missing.length)
    throw new Error(`Unknown tag(s): ${missing.join(", ")} (run \`pnpm db:seed\` first)`);
  await tx.delete(problemTags).where(eq(problemTags.problemId, problemId));
  if (found.length)
    await tx.insert(problemTags).values(found.map((f) => ({ problemId, tagId: f.id })));
}

async function syncCompanies(tx: Db, problemId: string, list: ProblemBundle["meta"]["companies"]) {
  await tx.delete(problemCompanies).where(eq(problemCompanies.problemId, problemId));
  for (const c of list) {
    const [row] = await tx
      .insert(companies)
      .values({ id: newId(), slug: c.slug, name: titleCase(c.slug) })
      .onConflictDoUpdate({ target: companies.slug, set: { slug: c.slug } })
      .returning({ id: companies.id });
    await tx.insert(problemCompanies).values({
      problemId,
      companyId: (row as { id: string }).id,
      frequency: c.frequency,
      lastSeenYear: c.lastSeenYear ?? null,
    });
  }
}

/** Hints and the editorial are replaced from the files on every import, without creating a version. */
export async function syncLearningContent(db: Db, problemId: string, bundle: ProblemBundle) {
  await syncHints(db, problemId, bundle.hints);
  await syncEditorial(db, problemId, bundle);
  // generators for the complexity analyzer: replaced on every import, never a new version
  await db
    .update(problems)
    .set({ scale: bundle.scale ?? null })
    .where(eq(problems.id, problemId));
}

export async function syncEditorial(db: Db, problemId: string, bundle: ProblemBundle) {
  const doc = bundle.editorial;
  if (!doc) return; // no file: leave anything an admin wrote in the editor alone
  const slugs = doc.relatedSlugs ?? [];
  const related = slugs.length
    ? await db.select({ id: problems.id }).from(problems).where(inArray(problems.slug, slugs))
    : [];
  const values = {
    approaches: doc.approaches,
    talkTrackMd: doc.talkTrackMd || null,
    relatedProblemIds: related.map((r) => r.id),
  };
  await db
    .insert(editorials)
    .values({ id: newId(), problemId, ...values })
    .onConflictDoUpdate({ target: editorials.problemId, set: values });
}

async function syncHints(tx: Db, problemId: string, bundleHints: ProblemBundle["hints"]) {
  for (const tier of [1, 2, 3] as const) {
    const body = bundleHints[tier];
    if (!body) continue;
    await tx
      .insert(hints)
      .values({ id: newId(), problemId, tier, bodyMd: body })
      .onConflictDoUpdate({ target: [hints.problemId, hints.tier], set: { bodyMd: body } });
  }
}

// ---------------------------------------------------------------- sheets

/** Upserts a sheet and replaces its problem list. Throws if it references a problem that isn't imported. */
export async function importSheet(
  db: Database,
  sheet: SheetFile,
): Promise<{ slug: string; problems: number }> {
  const slugs = sheet.sections.flatMap((s) => s.problems);
  if (new Set(slugs).size !== slugs.length)
    throw new Error(`Sheet ${sheet.slug}: a problem appears twice`);
  const rows = await db
    .select({ id: problems.id, slug: problems.slug })
    .from(problems)
    .where(inArray(problems.slug, slugs));
  const missing = slugs.filter((s) => !rows.some((r) => r.slug === s));
  if (missing.length)
    throw new Error(`Sheet ${sheet.slug}: unknown problem(s): ${missing.join(", ")}`);
  const idOf = new Map(rows.map((r) => [r.slug, r.id]));

  await withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(sheets)
      .values({
        id: newId(),
        slug: sheet.slug,
        title: sheet.title,
        description: sheet.description ?? null,
      })
      .onConflictDoUpdate({
        target: sheets.slug,
        set: { title: sheet.title, description: sheet.description ?? null },
      })
      .returning({ id: sheets.id });
    const sheetId = (row as { id: string }).id;
    await tx.delete(sheetProblems).where(eq(sheetProblems.sheetId, sheetId));
    let ordinal = 1;
    await tx.insert(sheetProblems).values(
      sheet.sections.flatMap((section) =>
        section.problems.map((slug) => ({
          sheetId,
          problemId: idOf.get(slug) as string,
          section: section.name,
          ordinal: ordinal++,
        })),
      ),
    );
  });
  return { slug: sheet.slug, problems: slugs.length };
}

/** Loads a folder and imports it; handy for tests and the CLI. */
export async function importFolder(
  db: Database,
  store: ObjectStore,
  contentRoot: string,
  slug: string,
  options: { publish?: boolean } = {},
): Promise<ImportResult> {
  const { bundle, issues } = await loadProblem(contentRoot, slug);
  if (!bundle) throw new Error(issues.map((i) => i.message).join("; "));
  const result = await importProblem(db, store, bundle, options);
  return result;
}

/**
 * Re-links editorials to their related problems once every problem exists (a related problem imported
 * later in the same run wasn't there yet when the first editorial was written).
 */
export async function linkRelatedEditorials(
  db: Database,
  contentRoot: string,
  slugs: string[],
): Promise<void> {
  for (const slug of slugs) {
    const { bundle } = await loadProblem(contentRoot, slug);
    if (!bundle?.editorial) continue;
    const [row] = await db
      .select({ id: problems.id })
      .from(problems)
      .where(eq(problems.slug, slug));
    if (row) await syncEditorial(db, row.id, bundle);
  }
}
