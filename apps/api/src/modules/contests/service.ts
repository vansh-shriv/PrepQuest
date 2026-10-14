import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  contestParticipants,
  contestProblems,
  contests,
  newId,
  problems,
  profiles,
  submissions,
  type Database,
  type Db,
} from "@prepquest/db";
import {
  computeStandings,
  contestPhase,
  freezeFromMs,
  placeAmong,
  type ContestAttempt,
  type ContestProblemSpec,
  type StandingRow,
} from "@prepquest/analytics-core";
import {
  AppError,
  type ContestDetailDto,
  type ContestListItem,
  type ContestListResponse,
  type ContestMeDto,
  type CreateContestInput,
  type StandingRowDto,
  type StandingsResponse,
  type UserRole,
} from "@prepquest/shared";

// Contests (D7). The window, the registration and the scoring are decided here; the browser only shows them.
// Standings are computed from the contest-mode submissions, so they update the moment a verdict is stored
// and the final table never needs a separate copy.

type ContestRow = typeof contests.$inferSelect;
const PAGE_SIZE = 50;
const PUBLIC_ROLES: readonly UserRole[] = ["reviewer", "admin"];

const isCreator = (c: ContestRow, userId: string) => c.createdBy === userId;
const durationMs = (c: ContestRow) => c.endsAt.getTime() - c.startsAt.getTime();

async function loadBySlug(db: Db, slug: string): Promise<ContestRow> {
  const [c] = await db.select().from(contests).where(eq(contests.slug, slug));
  if (!c) throw new AppError("NOT_FOUND", 404, "That contest does not exist.");
  return c;
}

async function registeredLive(db: Db, contestId: string, userId: string): Promise<boolean> {
  const [r] = await db
    .select({ id: contestParticipants.id })
    .from(contestParticipants)
    .where(
      and(
        eq(contestParticipants.contestId, contestId),
        eq(contestParticipants.userId, userId),
        eq(contestParticipants.kind, "live"),
      ),
    );
  return Boolean(r);
}

/** A private contest is invisible to anyone without the code, registration or authorship. */
async function assertVisible(db: Db, c: ContestRow, userId: string, code?: string) {
  if (c.visibility === "public" || isCreator(c, userId)) return;
  if (code && c.inviteCode && code.toUpperCase() === c.inviteCode) return;
  if (await registeredLive(db, c.id, userId)) return;
  throw new AppError("NOT_FOUND", 404, "That contest does not exist.");
}

const slugBase = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "contest";

const inviteCode = () =>
  Array.from(randomBytes(8), (b) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 31]).join("");

// ------------------------------------------------------------------------------------------------ create

export async function createContest(
  db: Database,
  userId: string,
  auth: { role: UserRole; mfa: boolean },
  input: CreateContestInput,
  now: Date,
): Promise<ContestDetailDto> {
  if (input.kind !== "private") {
    if (!PUBLIC_ROLES.includes(auth.role))
      throw new AppError("FORBIDDEN", 403, "Only reviewers and admins can run public contests.");
    if (auth.role === "admin" && !auth.mfa)
      throw new AppError("MFA_REQUIRED", 403, "Sign in with two-factor authentication to continue");
  }
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() < now.getTime() - 2 * 60_000)
    throw new AppError("VALIDATION_ERROR", 422, "A contest cannot start in the past.");
  const slugs = input.problems.map((p) => p.slug);
  if (new Set(slugs).size !== slugs.length)
    throw new AppError("VALIDATION_ERROR", 422, "A problem can only appear once.");
  const found = await db
    .select({ id: problems.id, slug: problems.slug, signature: problems.signature })
    .from(problems)
    .where(and(inArray(problems.slug, slugs), eq(problems.status, "published")));
  const bySlug = new Map(found.map((p) => [p.slug, p]));
  for (const s of slugs) {
    const p = bySlug.get(s);
    if (!p) throw new AppError("VALIDATION_ERROR", 422, `Unknown problem "${s}".`);
    if (!p.signature) throw new AppError("VALIDATION_ERROR", 422, `"${s}" cannot be run yet.`);
  }

  const id = newId();
  const slug = `${slugBase(input.title)}-${randomBytes(2).toString("hex")}`;
  const isPrivate = input.kind === "private";
  await db.transaction(async (tx) => {
    await tx.insert(contests).values({
      id,
      slug,
      title: input.title,
      description: input.description ?? null,
      kind: input.kind,
      scoring: input.scoring,
      startsAt,
      endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000),
      freezeMinutes: input.freezeMinutes,
      visibility: isPrivate ? "private" : "public",
      inviteCode: isPrivate ? inviteCode() : null,
      createdBy: userId,
    });
    await tx.insert(contestProblems).values(
      input.problems.map((p, i) => ({
        contestId: id,
        problemId: bySlug.get(p.slug)!.id,
        label: String.fromCharCode(65 + i),
        points: p.points,
        ordinal: i,
      })),
    );
    // the creator is registered in their own contest, so it never disappears from their list
    if (isPrivate) {
      await tx.insert(contestParticipants).values({
        id: newId(),
        contestId: id,
        userId,
        kind: "live",
        startedAt: startsAt,
        endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000),
      });
    }
  });
  return getContest(db, userId, slug, now);
}

// ------------------------------------------------------------------------------------------------ read

async function problemRows(db: Db, contestId: string) {
  return db
    .select({
      id: problems.id,
      slug: problems.slug,
      title: problems.title,
      difficulty: problems.difficulty,
      label: contestProblems.label,
      points: contestProblems.points,
      ordinal: contestProblems.ordinal,
    })
    .from(contestProblems)
    .innerJoin(problems, eq(problems.id, contestProblems.problemId))
    .where(eq(contestProblems.contestId, contestId))
    .orderBy(asc(contestProblems.ordinal));
}

async function counts(db: Db, ids: string[]) {
  if (ids.length === 0) return new Map<string, { participants: number; problems: number }>();
  const rows = (
    await db.execute(sql`
      SELECT c.id,
        (SELECT count(*)::int FROM contest_participants p WHERE p.contest_id = c.id AND p.kind = 'live') AS participants,
        (SELECT count(*)::int FROM contest_problems q WHERE q.contest_id = c.id) AS problems
      FROM contests c WHERE c.id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`)
  ).rows as unknown as Array<{ id: string; participants: number; problems: number }>;
  return new Map(rows.map((r) => [r.id, r]));
}

const toItem = (
  c: ContestRow,
  now: Date,
  n: { participants: number; problems: number } | undefined,
  registered: boolean,
): ContestListItem => ({
  slug: c.slug,
  title: c.title,
  kind: c.kind as ContestListItem["kind"],
  scoring: c.scoring as ContestListItem["scoring"],
  startsAt: c.startsAt.toISOString(),
  endsAt: c.endsAt.toISOString(),
  durationMinutes: Math.round(durationMs(c) / 60_000),
  phase: contestPhase(c.startsAt, c.endsAt, now),
  problemCount: n?.problems ?? 0,
  participants: n?.participants ?? 0,
  registered,
});

export async function listContests(
  db: Database,
  userId: string,
  status: "upcoming" | "running" | "past" | undefined,
  now: Date,
): Promise<ContestListResponse> {
  const mine = new Set(
    (
      await db
        .select({ id: contestParticipants.contestId })
        .from(contestParticipants)
        .where(and(eq(contestParticipants.userId, userId), eq(contestParticipants.kind, "live")))
    ).map((r) => r.id),
  );
  const rows = (
    await db
      .select()
      .from(contests)
      .where(eq(contests.cancelled, false))
      .orderBy(desc(contests.startsAt))
  ).filter((c) => c.visibility === "public" || mine.has(c.id) || isCreator(c, userId));
  const n = await counts(
    db,
    rows.map((r) => r.id),
  );
  const items = rows
    .map((c) => toItem(c, now, n.get(c.id), mine.has(c.id)))
    .filter((c) => !status || c.phase === status);
  // soonest first for what is ahead, most recent first for what is over
  if (status !== "past") items.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { contests: items };
}

export async function getContest(
  db: Database,
  userId: string,
  slug: string,
  now: Date,
  code?: string,
): Promise<ContestDetailDto> {
  const c = await loadBySlug(db, slug);
  await assertVisible(db, c, userId, code);
  const n = await counts(db, [c.id]);
  const registered = await registeredLive(db, c.id, userId);
  const phase = contestPhase(c.startsAt, c.endsAt, now);
  const creator = isCreator(c, userId);

  let list: ContestDetailDto["problems"] = null;
  if (phase !== "upcoming" || creator) {
    const rows = await problemRows(db, c.id);
    const solved = new Set(
      (
        await db
          .select({ id: submissions.problemId })
          .from(submissions)
          .where(
            and(
              eq(submissions.contestId, c.id),
              eq(submissions.userId, userId),
              eq(submissions.kind, "submit"),
              eq(submissions.verdict, "AC"),
            ),
          )
      ).map((r) => r.id),
    );
    list = rows.map((p) => ({
      slug: p.slug,
      title: p.title,
      label: p.label,
      points: p.points,
      difficulty: p.difficulty,
      solved: solved.has(p.id),
    }));
  }
  const target = phase === "upcoming" ? c.startsAt : c.endsAt;
  return {
    ...toItem(c, now, n.get(c.id), registered),
    description: c.description,
    freezeMinutes: c.freezeMinutes,
    problems: list,
    inviteCode: creator ? c.inviteCode : null,
    isCreator: creator,
    canRegister: !c.cancelled && phase !== "past" && !registered,
    secondsLeft:
      phase === "past" ? 0 : Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 1000)),
  };
}

// ------------------------------------------------------------------------------------------ participate

export async function register(
  db: Database,
  userId: string,
  slug: string,
  code: string | undefined,
  now: Date,
): Promise<ContestDetailDto> {
  const c = await loadBySlug(db, slug);
  await assertVisible(db, c, userId, code);
  if (c.cancelled) throw new AppError("CONTEST_CANCELLED", 409, "This contest was cancelled.");
  if (contestPhase(c.startsAt, c.endsAt, now) === "past")
    throw new AppError("CONTEST_ENDED", 409, "This contest has ended. Try a virtual run instead.");
  await db
    .insert(contestParticipants)
    .values({
      id: newId(),
      contestId: c.id,
      userId,
      kind: "live",
      startedAt: c.startsAt,
      endsAt: c.endsAt,
    })
    .onConflictDoNothing();
  return getContest(db, userId, slug, now, code);
}

export async function startVirtual(
  db: Database,
  userId: string,
  slug: string,
  now: Date,
): Promise<ContestMeDto> {
  const c = await loadBySlug(db, slug);
  await assertVisible(db, c, userId);
  if (contestPhase(c.startsAt, c.endsAt, now) !== "past")
    throw new AppError("CONTEST_NOT_OVER", 409, "A virtual run replays a contest that has ended.");
  const [running] = await db
    .select({ id: contestParticipants.id })
    .from(contestParticipants)
    .where(
      and(
        eq(contestParticipants.contestId, c.id),
        eq(contestParticipants.userId, userId),
        eq(contestParticipants.kind, "virtual"),
        gte(contestParticipants.endsAt, now),
      ),
    );
  if (running) throw new AppError("VIRTUAL_RUNNING", 409, "You already have a virtual run going.");
  await db.insert(contestParticipants).values({
    id: newId(),
    contestId: c.id,
    userId,
    kind: "virtual",
    startedAt: now,
    endsAt: new Date(now.getTime() + durationMs(c)),
  });
  return me(db, userId, slug, now);
}

/**
 * The participation a submission or a lock should be judged against right now. A live participation follows
 * the contest's own window (so moving the contest moves everyone); a virtual one has its own clock.
 */
async function activeParticipation(db: Db, c: ContestRow, userId: string, now: Date) {
  const rows = await db
    .select()
    .from(contestParticipants)
    .where(and(eq(contestParticipants.contestId, c.id), eq(contestParticipants.userId, userId)));
  const window = (r: (typeof rows)[number]) =>
    r.kind === "live" ? { from: c.startsAt, to: c.endsAt } : { from: r.startedAt, to: r.endsAt };
  const active = rows.filter((r) => {
    const w = window(r);
    return w.from <= now && now <= w.to;
  });
  // a live run wins over a virtual one (they cannot overlap anyway: virtual runs start after the end)
  const pick = active.find((r) => r.kind === "live") ?? active[0] ?? null;
  return pick ? { ...pick, startedAt: window(pick).from, endsAt: window(pick).to } : null;
}

export async function recordEvent(
  db: Database,
  userId: string,
  slug: string,
  type: "blur" | "paste",
  now: Date,
): Promise<{ ok: true }> {
  const c = await loadBySlug(db, slug);
  const p = await activeParticipation(db, c, userId, now);
  if (!p) return { ok: true };
  await db
    .update(contestParticipants)
    .set({
      integrity: sql`jsonb_set(${contestParticipants.integrity}, ${`{${type}}`}::text[],
        to_jsonb(coalesce((${contestParticipants.integrity}->>${type})::int, 0) + 1))`,
    })
    .where(eq(contestParticipants.id, p.id));
  return { ok: true };
}

// ---------------------------------------------------------------------------- submissions and locks

/** Used by the submission service: the attempt must be inside the learner's own running window. */
export async function assertContestSubmissionAllowed(
  db: Database,
  userId: string,
  slug: string,
  problemId: string,
  now: Date,
): Promise<{ contestId: string }> {
  const c = await loadBySlug(db, slug);
  if (c.cancelled) throw new AppError("CONTEST_CANCELLED", 409, "This contest was cancelled.");
  const p = await activeParticipation(db, c, userId, now);
  if (!p) {
    const anyone = await registeredLive(db, c.id, userId);
    throw anyone || contestPhase(c.startsAt, c.endsAt, now) !== "running"
      ? new AppError("CONTEST_NOT_RUNNING", 409, "This contest is not running for you right now.")
      : new AppError("CONTEST_NOT_REGISTERED", 403, "Register for the contest first.");
  }
  const [inContest] = await db
    .select({ id: contestProblems.problemId })
    .from(contestProblems)
    .where(and(eq(contestProblems.contestId, c.id), eq(contestProblems.problemId, problemId)));
  if (!inContest)
    throw new AppError("VALIDATION_ERROR", 422, "That problem is not part of this contest.");
  return { contestId: c.id };
}

/** Hints and editorials are off for a problem while the learner is inside a contest that includes it. */
export async function assertNoContestLock(
  db: Database,
  userId: string,
  problemId: string,
  now: Date,
): Promise<void> {
  const rows = await db
    .select({ id: contestParticipants.id })
    .from(contestParticipants)
    .innerJoin(contests, eq(contests.id, contestParticipants.contestId))
    .innerJoin(contestProblems, eq(contestProblems.contestId, contests.id))
    .where(
      and(
        eq(contestParticipants.userId, userId),
        sql`(
          (${contestParticipants.kind} = 'live' AND ${contests.startsAt} <= ${now} AND ${contests.endsAt} >= ${now})
          OR (${contestParticipants.kind} = 'virtual' AND ${contestParticipants.startedAt} <= ${now} AND ${contestParticipants.endsAt} >= ${now})
        )`,
        eq(contests.cancelled, false),
        eq(contestProblems.problemId, problemId),
      ),
    )
    .limit(1);
  if (rows.length > 0) {
    throw new AppError(
      "HINT_LOCKED",
      403,
      "Hints and editorials are disabled while this problem is part of a contest you are in.",
    );
  }
}

// -------------------------------------------------------------------------------------------- standings

async function attemptsOf(
  db: Db,
  c: ContestRow,
  window: { from: Date; to: Date },
  userIds: string[] | null,
  specs: Map<string, string>,
): Promise<Array<ContestAttempt & { at: Date }>> {
  const where = [
    eq(submissions.contestId, c.id),
    eq(submissions.kind, "submit"),
    gte(submissions.createdAt, window.from),
    lte(submissions.createdAt, window.to),
  ];
  if (userIds) {
    if (userIds.length === 0) return [];
    where.push(inArray(submissions.userId, userIds));
  }
  const rows = await db
    .select({
      userId: submissions.userId,
      problemId: submissions.problemId,
      verdict: submissions.verdict,
      at: submissions.createdAt,
    })
    .from(submissions)
    .where(and(...where));
  return rows
    .filter((r) => specs.has(r.problemId))
    .map((r) => ({
      userId: r.userId,
      problemId: r.problemId,
      verdict: r.verdict,
      at: r.at,
      elapsedMs: r.at.getTime() - window.from.getTime(),
    }));
}

async function specsOf(db: Db, contestId: string): Promise<ContestProblemSpec[]> {
  return (await problemRows(db, contestId)).map((p) => ({
    id: p.id,
    label: p.label,
    points: p.points,
  }));
}

/** The live standings table, with the freeze applied while the contest is running. */
export async function standings(
  db: Database,
  userId: string,
  slug: string,
  page: number,
  now: Date,
  code?: string,
): Promise<StandingsResponse> {
  const c = await loadBySlug(db, slug);
  await assertVisible(db, c, userId, code);
  const phase = contestPhase(c.startsAt, c.endsAt, now);
  const rows = await problemRows(db, c.id);
  const specs = rows.map((p) => ({ id: p.id, label: p.label, points: p.points }));
  const participants = await db
    .select({
      userId: contestParticipants.userId,
      handle: profiles.handle,
      displayName: profiles.displayName,
    })
    .from(contestParticipants)
    .innerJoin(profiles, eq(profiles.userId, contestParticipants.userId))
    .where(
      and(
        eq(contestParticipants.contestId, c.id),
        eq(contestParticipants.kind, "live"),
        // a confirmed integrity flag takes a participant out of the table (X2)
        isNull(contestParticipants.disqualifiedAt),
      ),
    );
  const ids = participants.map((p) => p.userId);
  const attempts =
    phase === "upcoming"
      ? []
      : await attemptsOf(
          db,
          c,
          { from: c.startsAt, to: c.endsAt },
          ids,
          new Map(specs.map((s) => [s.id, s.label])),
        );
  const frozen = phase === "running" && c.freezeMinutes > 0 && !isCreator(c, userId);
  const table = computeStandings(
    ids,
    specs,
    attempts,
    { scoring: c.scoring as "icpc" | "points", durationMs: durationMs(c) },
    { freezeFromMs: frozen ? freezeFromMs(durationMs(c), c.freezeMinutes) : null },
  );
  const who = new Map(participants.map((p) => [p.userId, p]));
  const label = new Map(specs.map((s) => [s.id, s.label]));
  const dto = (r: StandingRow): StandingRowDto => ({
    rank: r.rank,
    handle: who.get(r.userId)!.handle,
    displayName: who.get(r.userId)!.displayName,
    solved: r.solved,
    penalty: r.penalty,
    score: r.score,
    isMe: r.userId === userId,
    cells: r.cells.map((cell) => ({
      label: label.get(cell.problemId) ?? "?",
      solved: cell.solved,
      wrong: cell.wrong,
      minute: cell.minute,
      score: cell.score,
      pending: cell.pending,
    })),
  });
  const start = (page - 1) * PAGE_SIZE;
  const mine = table.find((r) => r.userId === userId);
  return {
    phase,
    scoring: c.scoring as "icpc" | "points",
    frozen,
    problems: rows.map((p) => ({ label: p.label, slug: p.slug, points: p.points })),
    rows: table.slice(start, start + PAGE_SIZE).map(dto),
    me: mine ? dto(mine) : null,
    total: table.length,
    page,
    pageSize: PAGE_SIZE,
  };
}

// ------------------------------------------------------------------------------------------------- me

export async function me(
  db: Database,
  userId: string,
  slug: string,
  now: Date,
): Promise<ContestMeDto> {
  const c = await loadBySlug(db, slug);
  await assertVisible(db, c, userId);
  const registered = await registeredLive(db, c.id, userId);
  const active = await activeParticipation(db, c, userId, now);
  const specs = await specsOf(db, c.id);
  const labels = new Map(specs.map((s) => [s.id, s.label]));

  const mine = (
    await db
      .select({
        id: submissions.id,
        problemId: submissions.problemId,
        language: submissions.language,
        verdict: submissions.verdict,
        at: submissions.createdAt,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.contestId, c.id),
          eq(submissions.userId, userId),
          eq(submissions.kind, "submit"),
        ),
      )
      .orderBy(desc(submissions.createdAt))
      .limit(50)
  ).filter((r) => labels.has(r.problemId));

  // the best finished (or running) virtual run, placed among the real standings
  let virtual: ContestMeDto["virtual"] = null;
  const runs = await db
    .select()
    .from(contestParticipants)
    .where(
      and(
        eq(contestParticipants.contestId, c.id),
        eq(contestParticipants.userId, userId),
        eq(contestParticipants.kind, "virtual"),
      ),
    );
  if (runs.length > 0) {
    const rules = { scoring: c.scoring as "icpc" | "points", durationMs: durationMs(c) };
    const specMap = new Map(specs.map((s) => [s.id, s.label]));
    let best: StandingRow | null = null;
    for (const r of runs) {
      const a = await attemptsOf(db, c, { from: r.startedAt, to: r.endsAt }, [userId], specMap);
      const row = computeStandings([userId], specs, a, rules)[0]!;
      const better =
        !best ||
        (rules.scoring === "icpc"
          ? row.solved > best.solved || (row.solved === best.solved && row.penalty < best.penalty)
          : row.score > best.score);
      if (better) best = row;
    }
    const liveIds = (
      await db
        .select({ userId: contestParticipants.userId })
        .from(contestParticipants)
        .where(and(eq(contestParticipants.contestId, c.id), eq(contestParticipants.kind, "live")))
    ).map((r) => r.userId);
    const field = computeStandings(
      liveIds,
      specs,
      await attemptsOf(db, c, { from: c.startsAt, to: c.endsAt }, liveIds, specMap),
      rules,
    );
    virtual = {
      solved: best!.solved,
      penalty: best!.penalty,
      score: best!.score,
      wouldRank: placeAmong(best!, field, rules.scoring),
      of: field.length + 1,
    };
  }

  return {
    registered,
    participation: active
      ? {
          kind: active.kind as "live" | "virtual",
          startedAt: active.startedAt.toISOString(),
          endsAt: active.endsAt.toISOString(),
          secondsLeft: Math.max(0, Math.ceil((active.endsAt.getTime() - now.getTime()) / 1000)),
        }
      : null,
    submissions: mine.map((r) => ({
      id: r.id,
      label: labels.get(r.problemId)!,
      language: r.language,
      verdict: r.verdict,
      at: r.at.toISOString(),
    })),
    virtual,
  };
}
