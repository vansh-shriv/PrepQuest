import { and, desc, eq, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { bookmarks, newId, notes, problems, type Database } from "@prepquest/db";
import { AppError, type BookmarkItem, type NoteDto, type NoteHubItem } from "@prepquest/shared";
import { findVisibleProblem } from "../problems/service.js";

// Personal library (U3): bookmarks and per-problem notes.

export async function putBookmark(
  db: Database,
  userId: string,
  slug: string,
  folder: string,
): Promise<{ bookmarked: true; folder: string }> {
  const problem = await findVisibleProblem(db, slug);
  await db
    .insert(bookmarks)
    .values({ userId, problemId: problem.id, folder })
    .onConflictDoUpdate({ target: [bookmarks.userId, bookmarks.problemId], set: { folder } });
  return { bookmarked: true, folder };
}

export async function removeBookmark(db: Database, userId: string, slug: string): Promise<void> {
  const problem = await findVisibleProblem(db, slug);
  await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.problemId, problem.id)));
}

export async function listBookmarks(db: Database, userId: string): Promise<BookmarkItem[]> {
  const rows = await db
    .select({
      slug: problems.slug,
      title: problems.title,
      difficulty: problems.difficulty,
      folder: bookmarks.folder,
      createdAt: bookmarks.createdAt,
    })
    .from(bookmarks)
    .innerJoin(problems, eq(problems.id, bookmarks.problemId))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt));
  return rows.map((r) => ({
    problem: { slug: r.slug, title: r.title, difficulty: r.difficulty },
    folder: r.folder,
    createdAt: r.createdAt.toISOString(),
  }));
}

const toNote = (row: typeof notes.$inferSelect): NoteDto => ({
  bodyMd: row.bodyMd,
  version: row.version,
  updatedAt: row.updatedAt.toISOString(),
});

async function findNote(db: Database, userId: string, problemId: string) {
  const [row] = await db
    .select()
    .from(notes)
    .where(
      and(eq(notes.userId, userId), eq(notes.entityType, "problem"), eq(notes.entityId, problemId)),
    );
  return row;
}

export async function getNote(db: Database, userId: string, slug: string): Promise<NoteDto | null> {
  const problem = await findVisibleProblem(db, slug);
  const row = await findNote(db, userId, problem.id);
  return row ? toNote(row) : null;
}

/**
 * Saves a note. The caller states which version it started from; a stale version is a 409 carrying the
 * newer note, so two tabs never silently overwrite each other (U3 acceptance). An empty body deletes.
 */
export async function saveNote(
  db: Database,
  userId: string,
  slug: string,
  bodyMd: string,
  baseVersion: number,
): Promise<{ note: NoteDto | null }> {
  const problem = await findVisibleProblem(db, slug);
  const existing = await findNote(db, userId, problem.id);
  const conflict = (current: typeof existing) =>
    new AppError("CONFLICT", 409, "This note was changed somewhere else.", {
      current: current ? toNote(current) : null,
    });

  if (!existing) {
    if (baseVersion !== 0) throw conflict(existing);
    if (bodyMd.trim() === "") return { note: null };
    const inserted = await db
      .insert(notes)
      .values({ id: newId(), userId, entityType: "problem", entityId: problem.id, bodyMd })
      .onConflictDoNothing()
      .returning();
    if (!inserted[0]) throw conflict(await findNote(db, userId, problem.id));
    return { note: toNote(inserted[0]) };
  }

  if (existing.version !== baseVersion) throw conflict(existing);
  if (bodyMd.trim() === "") {
    const removed = await db
      .delete(notes)
      .where(and(eq(notes.id, existing.id), eq(notes.version, baseVersion)))
      .returning({ id: notes.id });
    if (removed.length === 0) throw conflict(await findNote(db, userId, problem.id));
    return { note: null };
  }
  const updated = await db
    .update(notes)
    .set({ bodyMd, version: baseVersion + 1 })
    .where(and(eq(notes.id, existing.id), eq(notes.version, baseVersion)))
    .returning();
  if (!updated[0]) throw conflict(await findNote(db, userId, problem.id));
  return { note: toNote(updated[0]) };
}

export async function searchNotes(
  db: Database,
  userId: string,
  opts: { q?: string | undefined; limit: number; cursor?: string | undefined },
): Promise<{ items: NoteHubItem[]; nextCursor: string | null }> {
  const where: SQL[] = [eq(notes.userId, userId), eq(notes.entityType, "problem")];
  if (opts.q) {
    const like = `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(
      or(
        sql`to_tsvector('english', ${notes.bodyMd}) @@ websearch_to_tsquery('english', ${opts.q})`,
        ilike(notes.bodyMd, like),
        ilike(problems.title, like),
      ) as SQL,
    );
  }
  if (opts.cursor) {
    try {
      const [at, id] = Buffer.from(opts.cursor, "base64url").toString("utf8").split("|");
      const date = new Date(at ?? "");
      if (!id || Number.isNaN(date.getTime())) throw new Error("bad");
      where.push(
        or(lt(notes.updatedAt, date), and(eq(notes.updatedAt, date), lt(notes.id, id))) as SQL,
      );
    } catch {
      throw new AppError("VALIDATION_ERROR", 422, "Invalid cursor");
    }
  }
  const rows = await db
    .select({
      id: notes.id,
      bodyMd: notes.bodyMd,
      updatedAt: notes.updatedAt,
      slug: problems.slug,
      title: problems.title,
      status: problems.status,
    })
    .from(notes)
    .leftJoin(problems, eq(problems.id, notes.entityId))
    .where(and(...where))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .limit(opts.limit + 1);

  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      problem: r.slug
        ? { slug: r.slug, title: r.title ?? r.slug, archived: r.status === "archived" }
        : null,
      bodyMd: r.bodyMd,
      updatedAt: r.updatedAt.toISOString(),
    })),
    nextCursor:
      rows.length > opts.limit && last
        ? Buffer.from(`${last.updatedAt.toISOString()}|${last.id}`).toString("base64url")
        : null,
  };
}
