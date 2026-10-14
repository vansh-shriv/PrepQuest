import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  adminAuditLog,
  contestParticipants,
  contests,
  integrityFlags,
  newId,
  problemLanguages,
  problems,
  profiles,
  submissions,
  type Database,
  type IntegrityEvidence,
  type IntegrityMatch,
} from "@prepquest/db";
import {
  aiStyleMarker,
  behaviorSignals,
  fingerprint,
  hashSet,
  linesOfRanges,
  raise,
  similarity,
  similaritySeverity,
  type CodeLanguage,
  type FlagSeverity,
  type Fingerprint,
} from "@prepquest/analytics-core";
import {
  AppError,
  type FlagCodeSide,
  type FlagDecision,
  type FlagDetail,
  type FlagKind,
  type FlagListItem,
  type FlagListResponse,
  type FlagStatus,
  type MyIntegrityNotice,
  type ScanResult,
} from "@prepquest/shared";

// Integrity review (X2). Detection produces flags with evidence; a person decides. Only a confirmed flag has
// any effect (the participant leaves the standings), and the learner can appeal once.

export interface Actor {
  id: string;
  role: string;
  ip: string | undefined;
}

type FlagRow = typeof integrityFlags.$inferSelect;

// ---------------------------------------------------------------- scan

interface Entry {
  userId: string;
  submissionId: string;
  problemId: string;
  problemSlug: string;
  language: CodeLanguage;
  code: string;
  fp: Fingerprint;
}

/** Compares every pair of accepted contest solutions and checks each participant's paste and focus counts. */
export async function scanContest(db: Database, slug: string): Promise<ScanResult> {
  const [contest] = await db.select().from(contests).where(eq(contests.slug, slug));
  if (!contest) throw new AppError("NOT_FOUND", 404, "Contest not found");

  const participantRows = await db
    .select()
    .from(contestParticipants)
    .where(eq(contestParticipants.contestId, contest.id))
    .orderBy(asc(contestParticipants.joinedAt));
  // one row per learner: the live entry if there is one
  const participantOf = new Map<string, (typeof participantRows)[number]>();
  for (const p of participantRows) {
    const have = participantOf.get(p.userId);
    if (!have || (have.kind !== "live" && p.kind === "live")) participantOf.set(p.userId, p);
  }

  // each learner's latest accepted submission per problem
  const accepted = await db
    .select({
      id: submissions.id,
      userId: submissions.userId,
      problemId: submissions.problemId,
      slug: problems.slug,
      language: submissions.language,
      code: submissions.code,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .innerJoin(problems, eq(problems.id, submissions.problemId))
    .where(
      and(
        eq(submissions.contestId, contest.id),
        eq(submissions.kind, "submit"),
        eq(submissions.verdict, "AC"),
      ),
    )
    .orderBy(asc(submissions.createdAt));
  const latest = new Map<string, (typeof accepted)[number]>();
  for (const s of accepted) latest.set(`${s.userId}|${s.problemId}`, s);

  // the starter code everyone began from is not evidence
  const starters = await db
    .select({
      problemId: problemLanguages.problemId,
      language: problemLanguages.language,
      code: problemLanguages.starterCode,
    })
    .from(problemLanguages)
    .where(inArray(problemLanguages.problemId, [...new Set(accepted.map((a) => a.problemId))]));
  const boiler = new Map(
    starters.map((s) => [
      `${s.problemId}|${s.language}`,
      hashSet(s.language as CodeLanguage, s.code),
    ]),
  );

  const groups = new Map<string, Entry[]>();
  for (const s of latest.values()) {
    const language = s.language as CodeLanguage;
    const entry: Entry = {
      userId: s.userId,
      submissionId: s.id,
      problemId: s.problemId,
      problemSlug: s.slug,
      language,
      code: s.code,
      fp: fingerprint(language, s.code),
    };
    const key = `${s.problemId}|${s.language}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const matches = new Map<string, IntegrityMatch[]>();
  let compared = 0;
  for (const [key, list] of groups) {
    const skip = boiler.get(key) ?? new Set<number>();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.userId === b.userId) continue;
        const sim = similarity(a.fp, b.fp, skip);
        if (sim.trivial) continue;
        compared++;
        if (!similaritySeverity(sim.score)) continue;
        const back = similarity(b.fp, a.fp, skip);
        const push = (me: Entry, other: Entry, ranges: IntegrityMatch["ranges"]) =>
          matches.set(me.userId, [
            ...(matches.get(me.userId) ?? []),
            {
              problemSlug: me.problemSlug,
              submissionId: me.submissionId,
              otherSubmissionId: other.submissionId,
              otherUserId: other.userId,
              similarity: Math.round(sim.score * 10_000) / 10_000,
              ranges,
            },
          ]);
        push(a, b, sim.ranges);
        push(b, a, back.ranges);
      }
    }
  }

  let created = 0;
  let updated = 0;
  const store = async (
    userId: string,
    kind: FlagKind,
    severity: FlagSeverity,
    score: number | null,
    evidence: IntegrityEvidence,
  ) => {
    const participant = participantOf.get(userId);
    if (!participant) return;
    const [existing] = await db
      .select()
      .from(integrityFlags)
      .where(
        and(
          eq(integrityFlags.subjectType, "contest_participant"),
          eq(integrityFlags.subjectId, participant.id),
          eq(integrityFlags.kind, kind),
        ),
      );
    if (!existing) {
      await db.insert(integrityFlags).values({
        id: newId(),
        subjectType: "contest_participant",
        subjectId: participant.id,
        userId,
        contestId: contest.id,
        kind,
        severity,
        score: score === null ? null : score.toFixed(4),
        evidence,
      });
      created++;
    } else if (existing.status === "open") {
      // a rescan refreshes what is still waiting for a person; a reviewed flag is left as decided
      await db
        .update(integrityFlags)
        .set({ severity, score: score === null ? null : score.toFixed(4), evidence })
        .where(eq(integrityFlags.id, existing.id));
      updated++;
    }
  };

  for (const [userId, list] of matches) {
    const best = Math.max(...list.map((m) => m.similarity));
    let severity = similaritySeverity(best)!;
    const counts = participantOf.get(userId)?.integrity ?? { paste: 0, blur: 0 };
    const behavior = behaviorSignals(counts);
    const aggravating: string[] = [];
    if (behavior.paste) aggravating.push(`${counts.paste} paste events during the contest`);
    if (behavior.focus) aggravating.push(`${counts.blur} times the window lost focus`);
    if (aggravating.length > 0) severity = raise(severity);
    await store(userId, "similarity", severity, best, { matches: list, counts, aggravating });
  }

  const styleMarks = new Map<string, Array<{ submissionId: string; comments: number }>>();
  for (const e of [...groups.values()].flat()) {
    const mark = aiStyleMarker(e.language, e.code);
    if (mark.marked) {
      styleMarks.set(e.userId, [
        ...(styleMarks.get(e.userId) ?? []),
        { submissionId: e.submissionId, comments: mark.comments },
      ]);
    }
  }
  for (const [userId, p] of participantOf) {
    const behavior = behaviorSignals(p.integrity);
    if (behavior.paste) {
      await store(userId, "paste", behavior.paste, null, {
        counts: p.integrity,
        // a weak marker, shown only next to a stronger signal
        aiStyle: styleMarks.get(userId) ?? [],
      });
    }
    if (behavior.focus) await store(userId, "focus", behavior.focus, null, { counts: p.integrity });
  }

  return {
    contest: contest.slug,
    participants: participantOf.size,
    compared,
    flagsCreated: created,
    flagsUpdated: updated,
  };
}

// ---------------------------------------------------------------- queue

const RANK = sql`CASE ${integrityFlags.severity} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`;
const WAITING = sql`CASE WHEN ${integrityFlags.status} IN ('open','appealed','escalated') THEN 0 ELSE 1 END`;

async function listItems(db: Database, where: ReturnType<typeof and>): Promise<FlagListItem[]> {
  const rows = await db
    .select({
      f: integrityFlags,
      handle: profiles.handle,
      displayName: profiles.displayName,
      slug: contests.slug,
      title: contests.title,
    })
    .from(integrityFlags)
    .innerJoin(profiles, eq(profiles.userId, integrityFlags.userId))
    .leftJoin(contests, eq(contests.id, integrityFlags.contestId))
    .where(where)
    .orderBy(WAITING, RANK, desc(integrityFlags.createdAt))
    .limit(200);
  return rows.map((r) => toItem(r.f, r));
}

function toItem(
  f: FlagRow,
  x: { handle: string; displayName: string; slug: string | null; title: string | null },
): FlagListItem {
  return {
    id: f.id,
    kind: f.kind as FlagKind,
    severity: f.severity as FlagListItem["severity"],
    score: f.score === null ? null : Number(f.score),
    status: f.status as FlagStatus,
    contest: x.slug && x.title ? { slug: x.slug, title: x.title } : null,
    user: { handle: x.handle, displayName: x.displayName },
    createdAt: f.createdAt.toISOString(),
  };
}

export async function listFlags(
  db: Database,
  query: { status?: FlagStatus | undefined; contest?: string | undefined },
): Promise<FlagListResponse> {
  const where = and(
    query.status ? eq(integrityFlags.status, query.status) : undefined,
    query.contest ? eq(contests.slug, query.contest) : undefined,
  );
  const items = await listItems(db, where);
  const [counted] = (
    await db.execute(
      sql`SELECT count(*)::int AS n FROM integrity_flags WHERE status IN ('open','appealed','escalated')`,
    )
  ).rows as unknown as Array<{ n: number }>;
  return { items, open: counted?.n ?? 0 };
}

async function sideOf(
  db: Database,
  submissionId: string,
  ranges: Array<{ from: number; to: number }>,
): Promise<FlagCodeSide | null> {
  const [row] = await db
    .select({
      id: submissions.id,
      code: submissions.code,
      language: submissions.language,
      slug: problems.slug,
      handle: profiles.handle,
    })
    .from(submissions)
    .innerJoin(problems, eq(problems.id, submissions.problemId))
    .innerJoin(profiles, eq(profiles.userId, submissions.userId))
    .where(eq(submissions.id, submissionId));
  if (!row) return null;
  return {
    submissionId: row.id,
    problemSlug: row.slug,
    language: row.language,
    handle: row.handle,
    code: row.code,
    matchedLines: linesOfRanges(row.language as CodeLanguage, row.code, ranges),
  };
}

export async function getFlag(db: Database, id: string): Promise<FlagDetail> {
  const [row] = await db
    .select({
      f: integrityFlags,
      handle: profiles.handle,
      displayName: profiles.displayName,
      slug: contests.slug,
      title: contests.title,
    })
    .from(integrityFlags)
    .innerJoin(profiles, eq(profiles.userId, integrityFlags.userId))
    .leftJoin(contests, eq(contests.id, integrityFlags.contestId))
    .where(eq(integrityFlags.id, id));
  if (!row) throw new AppError("NOT_FOUND", 404, "Flag not found");
  const f = row.f;

  const pairs: FlagDetail["pairs"] = [];
  for (const m of f.evidence.matches ?? []) {
    const mine = await sideOf(db, m.submissionId, m.ranges);
    if (!mine) continue;
    // the other side's matching stretches are found by comparing the other way round
    const otherRow = await db
      .select({
        code: submissions.code,
        language: submissions.language,
        problemId: submissions.problemId,
      })
      .from(submissions)
      .where(eq(submissions.id, m.otherSubmissionId));
    const o = otherRow[0];
    let ranges: Array<{ from: number; to: number }> = [];
    if (o) {
      const [starter] = await db
        .select({ code: problemLanguages.starterCode })
        .from(problemLanguages)
        .where(
          and(
            eq(problemLanguages.problemId, o.problemId),
            eq(problemLanguages.language, o.language),
          ),
        );
      const lang = o.language as CodeLanguage;
      const mineRow = await db
        .select({ code: submissions.code })
        .from(submissions)
        .where(eq(submissions.id, m.submissionId));
      ranges = similarity(
        fingerprint(lang, o.code),
        fingerprint(lang, mineRow[0]?.code ?? ""),
        starter ? hashSet(lang, starter.code) : new Set(),
      ).ranges;
    }
    const other = await sideOf(db, m.otherSubmissionId, ranges);
    if (other) pairs.push({ similarity: m.similarity, mine, other });
  }

  const reviewer = f.reviewedBy
    ? (
        await db
          .select({ h: profiles.handle })
          .from(profiles)
          .where(eq(profiles.userId, f.reviewedBy))
      )[0]
    : undefined;
  const style = f.evidence.aiStyle ?? [];
  return {
    ...toItem(f, row),
    counts: f.evidence.counts ?? null,
    aggravating: f.evidence.aggravating ?? [],
    aiStyle: style.map(
      (s) =>
        `${s.comments} long explanatory comments in one answer (a weak marker, not evidence on its own)`,
    ),
    pairs,
    decisionNote: f.decisionNote,
    reviewedBy: reviewer?.h ?? null,
    reviewedAt: f.reviewedAt?.toISOString() ?? null,
    appealText: f.appealText,
    appealedAt: f.appealedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------- decisions

/** A participant is out of the standings exactly while a confirmed flag stands. */
async function syncDisqualification(db: Database, flag: FlagRow) {
  if (flag.subjectType !== "contest_participant") return;
  const [counted] = (
    await db.execute(
      sql`SELECT count(*)::int AS n FROM integrity_flags WHERE subject_id = ${flag.subjectId} AND status = 'confirmed'`,
    )
  ).rows as unknown as Array<{ n: number }>;
  await db
    .update(contestParticipants)
    .set({ disqualifiedAt: (counted?.n ?? 0) > 0 ? new Date() : null })
    .where(eq(contestParticipants.id, flag.subjectId));
}

export async function decide(
  db: Database,
  actor: Actor,
  id: string,
  input: FlagDecision,
  now: Date,
): Promise<FlagDetail> {
  const [flag] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, id));
  if (!flag) throw new AppError("NOT_FOUND", 404, "Flag not found");
  if (flag.status === "escalated" && actor.role !== "admin") {
    throw new AppError("FORBIDDEN", 403, "An escalated flag is decided by an admin.");
  }
  if (input.decision === "escalate" && !["open", "appealed"].includes(flag.status)) {
    throw new AppError("CONFLICT", 409, "Only a flag that is waiting can be escalated.");
  }
  const status: FlagStatus =
    input.decision === "confirm"
      ? "confirmed"
      : input.decision === "dismiss"
        ? "dismissed"
        : "escalated";
  const [updated] = await db
    .update(integrityFlags)
    .set({ status, reviewedBy: actor.id, reviewedAt: now, decisionNote: input.note })
    .where(eq(integrityFlags.id, id))
    .returning();
  await syncDisqualification(db, updated ?? flag);
  await db.insert(adminAuditLog).values({
    id: newId(),
    actorId: actor.id,
    actorRole: actor.role,
    action: `integrity.${input.decision}`,
    entityType: "integrity_flag",
    entityId: id,
    before: { status: flag.status },
    after: { status },
    reason: input.note,
    ip: actor.ip ?? null,
  });
  return getFlag(db, id);
}

// ---------------------------------------------------------------- the learner's side

export async function myNotices(db: Database, userId: string): Promise<MyIntegrityNotice[]> {
  const rows = await db
    .select({ f: integrityFlags, slug: contests.slug, title: contests.title })
    .from(integrityFlags)
    .leftJoin(contests, eq(contests.id, integrityFlags.contestId))
    .where(eq(integrityFlags.userId, userId))
    .orderBy(desc(integrityFlags.updatedAt));
  const out: MyIntegrityNotice[] = [];
  for (const { f, slug, title } of rows) {
    // a learner hears about a flag only once a person has decided; a dismissed one only if they appealed
    const status = f.status as FlagStatus;
    const shown =
      status === "confirmed" ||
      status === "appealed" ||
      (status === "dismissed" && f.appealedAt !== null);
    if (!shown) continue;
    out.push({
      id: f.id,
      contest: slug && title ? { slug, title } : null,
      kind: f.kind as FlagKind,
      status: status as MyIntegrityNotice["status"],
      decisionNote: f.decisionNote,
      decidedAt: f.reviewedAt?.toISOString() ?? null,
      appealText: f.appealText,
      canAppeal: status === "confirmed" && f.appealedAt === null,
    });
  }
  return out;
}

export async function appeal(
  db: Database,
  userId: string,
  id: string,
  text: string,
  now: Date,
): Promise<MyIntegrityNotice> {
  const [flag] = await db
    .select()
    .from(integrityFlags)
    .where(and(eq(integrityFlags.id, id), eq(integrityFlags.userId, userId)));
  // someone else's flag looks like no flag
  if (!flag) throw new AppError("NOT_FOUND", 404, "Not found");
  if (flag.status !== "confirmed" || flag.appealedAt !== null) {
    throw new AppError("CONFLICT", 409, "This decision cannot be appealed (again).");
  }
  await db
    .update(integrityFlags)
    .set({ status: "appealed", appealText: text, appealedAt: now })
    .where(eq(integrityFlags.id, id));
  const notice = (await myNotices(db, userId)).find((n) => n.id === id);
  if (!notice) throw new AppError("INTERNAL", 500, "Could not record the appeal");
  return notice;
}
