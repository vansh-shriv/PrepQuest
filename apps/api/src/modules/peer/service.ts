import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  editorials,
  newId,
  peerAvailability,
  peerBlocks,
  peerFeedback,
  peerInvites,
  peerReports,
  peerSessions,
  problems,
  profiles,
  questionBank,
  withTransaction,
  type Database,
  type Db,
  type PeerQuestionRef,
} from "@prepquest/db";
import {
  bestMatch,
  buildIcs,
  canOpen,
  feedbackNudges,
  leftover,
  noShowDue,
  cleanSuggestions,
  peerClock,
  suggestionAllowed,
  reputation,
  type PeerOffer,
  type PeerSide,
  type PeerStats,
  type PeerTopic,
} from "@prepquest/analytics-core";
import {
  AppError,
  PEER_LIMITS,
  type CreateAvailabilityInput,
  type CreatePeerInviteInput,
  type CreatedPeerInviteDto,
  type PeerAvailabilityDto,
  type PeerFeedbackInput,
  type PeerFeedbackResult,
  type PeerInviteDto,
  type PeerInvitePreviewDto,
  type PeerPartnerDto,
  type PeerQuestionView,
  type PeerReportInput,
  type PeerReputationDto,
  type PeerSessionDetail,
  type PeerSessionItem,
  type PeerSessionState,
  type PeerSuggestionsDto,
  peerSuggestionsSchema,
  type PeerTopicValue,
} from "@prepquest/shared";

import {
  PEER_SUGGEST_SYSTEM,
  PEER_SUGGEST_PROMPT_VERSION,
  buildPeerSuggestPrompt,
} from "@prepquest/prompts";
import type { AiContext } from "../ai-context.js";

// Peer mock interviews (X1): availability, matching, invites, the session lifecycle with its two halves,
// feedback, reputation and safety. Rules are in analytics-core/peer.ts; this module loads and stores.
// A live room with audio and a shared editor is not part of this phase: the session is the schedule, the
// roles, the question card, the interviewer's panel and the clock. The live room (socket channel, shared
// editor and drawing, audio signalling) is in gateway.ts and room.ts; this module answers who may enter.

const MIN = 60_000;
const DAY = 86_400_000;
const MAX_UPCOMING = 5;
const INVITE_MAX_AHEAD_MS = 30 * DAY;
const INVITE_MIN_LEAD_MS = 30 * MIN;
const LATE_COMPLETE_MS = 15 * MIN;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type SessionRow = typeof peerSessions.$inferSelect;
const iso = (d: Date) => d.toISOString();
const dto1to3 = (n: number) => Math.min(3, Math.max(1, Math.round(n))) as 1 | 2 | 3;

const notFound = (what = "Session") => new AppError("NOT_FOUND", 404, `${what} not found`);

// ---------------------------------------------------------------- people

const sideOf = (s: SessionRow, userId: string): PeerSide => (s.aUser === userId ? "a" : "b");
const partnerId = (s: SessionRow, userId: string) => (s.aUser === userId ? s.bUser : s.aUser);

/** Everything the reputation rules need, for several people at once. */
export async function reputations(
  db: Database | Db,
  userIds: readonly string[],
): Promise<Map<string, PeerReputationDto>> {
  const ids = [...new Set(userIds)];
  const stats = new Map<string, PeerStats>(
    ids.map((id) => [id, { sessions: 0, noShows: 0, helpfulness: [], punctuality: [] }]),
  );
  if (ids.length === 0) return new Map();
  const done = await db
    .select({ a: peerSessions.aUser, b: peerSessions.bUser })
    .from(peerSessions)
    .where(
      and(
        eq(peerSessions.state, "completed"),
        or(inArray(peerSessions.aUser, ids), inArray(peerSessions.bUser, ids)),
      ),
    );
  for (const r of done) {
    for (const id of [r.a, r.b]) if (stats.has(id)) stats.get(id)!.sessions += 1;
  }
  const missed = await db
    .select({ id: peerSessions.noShowUser })
    .from(peerSessions)
    .where(and(eq(peerSessions.state, "no_show"), inArray(peerSessions.noShowUser, ids)));
  for (const r of missed) if (r.id && stats.has(r.id)) stats.get(r.id)!.noShows += 1;
  const fb = await db
    .select({ to: peerFeedback.toUser, ratings: peerFeedback.ratings })
    .from(peerFeedback)
    .where(inArray(peerFeedback.toUser, ids));
  for (const r of fb) {
    const st = stats.get(r.to);
    if (!st) continue;
    if (typeof r.ratings.helpfulness === "number") st.helpfulness.push(r.ratings.helpfulness);
    if (typeof r.ratings.punctuality === "number") st.punctuality.push(r.ratings.punctuality);
  }
  return new Map(ids.map((id) => [id, reputation(stats.get(id)!)]));
}

async function handles(db: Database | Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: profiles.userId, handle: profiles.handle })
    .from(profiles)
    .where(inArray(profiles.userId, [...ids]));
  return new Map(rows.map((r) => [r.id, r.handle]));
}

/** People who blocked `userId` or whom `userId` blocked: never matched, never invited. */
async function blockedWith(db: Database | Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ u: peerBlocks.userId, b: peerBlocks.blockedUserId })
    .from(peerBlocks)
    .where(or(eq(peerBlocks.userId, userId), eq(peerBlocks.blockedUserId, userId)));
  return new Set(rows.map((r) => (r.u === userId ? r.b : r.u)));
}

// ---------------------------------------------------------------- availability

const toAvailability = (r: typeof peerAvailability.$inferSelect): PeerAvailabilityDto => ({
  id: r.id,
  startsAt: iso(r.startsAt),
  endsAt: iso(r.endsAt),
  topics: r.prefs.topics as PeerTopicValue[],
  difficulty: dto1to3(r.prefs.difficulty),
  language: r.prefs.language,
});

export async function listAvailability(db: Database, userId: string, now: Date) {
  const rows = await db
    .select()
    .from(peerAvailability)
    .where(and(eq(peerAvailability.userId, userId), gt(peerAvailability.endsAt, now)))
    .orderBy(asc(peerAvailability.startsAt), asc(peerAvailability.id));
  return rows.map(toAvailability);
}

export async function addAvailability(
  db: Database,
  userId: string,
  input: CreateAvailabilityInput,
  now: Date,
): Promise<PeerAvailabilityDto> {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const usable = endsAt.getTime() - Math.max(startsAt.getTime(), now.getTime() + 0);
  if (usable < PEER_LIMITS.minWindowMinutes * MIN)
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      `A window needs at least ${PEER_LIMITS.minWindowMinutes} minutes still ahead of you.`,
    );
  if (endsAt.getTime() - startsAt.getTime() > PEER_LIMITS.maxWindowHours * 60 * MIN)
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      `A window can be at most ${PEER_LIMITS.maxWindowHours} hours long.`,
    );
  const open = await listAvailability(db, userId, now);
  if (open.length >= PEER_LIMITS.openWindows)
    throw new AppError("LIMIT_REACHED", 409, "Remove a window before adding another one.");
  const [row] = await db
    .insert(peerAvailability)
    .values({
      id: newId(),
      userId,
      startsAt,
      endsAt,
      prefs: {
        topics: [...new Set(input.topics)],
        difficulty: input.difficulty,
        language: input.language ?? null,
      },
    })
    .returning();
  return toAvailability(row!);
}

export async function removeAvailability(db: Database, userId: string, id: string) {
  const res = await db
    .delete(peerAvailability)
    .where(and(eq(peerAvailability.id, id), eq(peerAvailability.userId, userId)))
    .returning({ id: peerAvailability.id });
  if (res.length === 0) throw notFound("Window");
  return { ok: true as const };
}

// ---------------------------------------------------------------- questions

const DSA_RUBRIC = [
  "Asks about constraints and edge cases before coding",
  "States a brute-force approach and its cost",
  "Reaches the better approach, with a reason",
  "Writes clean code and walks through an example",
  "States time and space complexity correctly",
];
const DIFFICULTY_NAME = { 1: "easy", 2: "medium", 3: "hard" } as const;

const seedOf = (id: string) => parseInt(id.replace(/-/g, "").slice(-8), 16);

/** Two questions for a session, chosen from the session id so a retry picks the same ones. */
async function pickQuestions(
  db: Database | Db,
  topic: PeerTopic,
  difficulty: number,
  seed: number,
): Promise<PeerQuestionRef[]> {
  if (topic === "dsa") {
    const rows = await db
      .select({ slug: problems.slug, difficulty: problems.difficulty })
      .from(problems)
      .where(eq(problems.status, "published"))
      .orderBy(asc(problems.slug));
    const near = rows.filter((r) => r.difficulty === DIFFICULTY_NAME[dto1to3(difficulty)]);
    const pool = near.length >= 2 ? near : rows;
    return choose(pool, seed).map((r) => ({ kind: "problem" as const, slug: r.slug }));
  }
  const rows = await db
    .select({ slug: questionBank.slug, difficulty: questionBank.difficulty })
    .from(questionBank)
    .where(and(eq(questionBank.category, topic), eq(questionBank.status, "published")))
    .orderBy(asc(questionBank.slug));
  return choose(rows, seed).map((r) => ({ kind: "bank" as const, slug: r.slug }));
}

function choose<T>(pool: readonly T[], seed: number): T[] {
  if (pool.length < 2)
    throw new AppError("NO_QUESTIONS", 409, "There are not enough questions for that topic yet.");
  const first = seed % pool.length;
  const second = (first + 1 + (Math.floor(seed / pool.length) % (pool.length - 1))) % pool.length;
  return [pool[first]!, pool[second]!];
}

interface QuestionContent {
  view: PeerQuestionView;
  panel: { reference: string[]; followups: string[]; rubric: string[] };
}

async function questionContent(
  db: Database | Db,
  refs: readonly PeerQuestionRef[],
): Promise<QuestionContent[]> {
  const out: QuestionContent[] = [];
  for (const ref of refs) {
    if (ref.kind === "problem") {
      const [p] = await db
        .select({
          title: problems.title,
          statement: problems.statementMd,
          constraints: problems.constraintsMd,
          approaches: editorials.approaches,
        })
        .from(problems)
        .leftJoin(editorials, eq(editorials.problemId, problems.id))
        .where(eq(problems.slug, ref.slug));
      if (!p) continue;
      out.push({
        view: {
          title: p.title,
          statementMd: [p.statement, p.constraints ?? ""].filter(Boolean).join("\n\n"),
        },
        panel: {
          reference: (p.approaches ?? []).map(
            (a) =>
              `${a.name}: ${a.intuition} Steps: ${a.steps.join("; ")}. Time ${a.time}, space ${a.space}.`,
          ),
          followups: (p.approaches ?? []).flatMap((a) => a.pitfalls ?? []).slice(0, 4),
          rubric: DSA_RUBRIC,
        },
      });
    } else {
      const [q] = await db.select().from(questionBank).where(eq(questionBank.slug, ref.slug));
      if (!q) continue;
      out.push({
        view: { title: q.topic, statementMd: q.text },
        panel: {
          reference: q.referenceAnswer ? [q.referenceAnswer] : [],
          followups: q.followups,
          rubric: q.rubricPoints,
        },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- sessions: creation

async function assertFree(
  db: Database | Db,
  userId: string,
  startsAt: Date,
  minutes: number,
): Promise<void> {
  const rows = await db
    .select({ at: peerSessions.scheduledAt, minutes: peerSessions.minutes })
    .from(peerSessions)
    .where(
      and(
        or(eq(peerSessions.aUser, userId), eq(peerSessions.bUser, userId)),
        inArray(peerSessions.state, ["scheduled", "live"]),
      ),
    );
  const s = startsAt.getTime();
  const e = s + minutes * MIN;
  if (rows.length >= MAX_UPCOMING)
    throw new AppError("LIMIT_REACHED", 409, "You already have several sessions booked.");
  for (const r of rows) {
    const rs = r.at.getTime();
    if (s < rs + r.minutes * MIN && rs < e)
      throw new AppError("SESSION_CONFLICT", 409, "That time overlaps another session.");
  }
}

interface NewSession {
  aUser: string;
  bUser: string;
  scheduledAt: Date;
  minutes: number;
  topic: PeerTopic;
  difficulty: number;
  source: "match" | "invite";
}

async function insertSession(tx: Db, s: NewSession): Promise<SessionRow> {
  await assertFree(tx, s.aUser, s.scheduledAt, s.minutes);
  await assertFree(tx, s.bUser, s.scheduledAt, s.minutes);
  const id = newId();
  const seed = seedOf(id);
  const questions = await pickQuestions(tx, s.topic, s.difficulty, seed);
  const [row] = await tx
    .insert(peerSessions)
    .values({
      id,
      ...s,
      difficulty: dto1to3(s.difficulty),
      firstCandidate: seed % 2 === 0 ? "a" : "b",
      questions,
    })
    .returning();
  return row!;
}

/** Finds the best partner among the open windows of other people and books the session. */
export async function match(
  db: Database,
  userId: string,
  input: { minutes: number },
  now: Date,
): Promise<PeerSessionDetail> {
  return withTransaction(db, async (tx) => {
    const mine = await tx
      .select()
      .from(peerAvailability)
      .where(and(eq(peerAvailability.userId, userId), gt(peerAvailability.endsAt, now)));
    if (mine.length === 0)
      throw new AppError(
        "NO_AVAILABILITY",
        409,
        "Add a time window first, then look for a partner.",
      );
    const blocked = await blockedWith(tx, userId);
    const others = await tx
      .select()
      .from(peerAvailability)
      .where(and(gt(peerAvailability.endsAt, now), sql`${peerAvailability.userId} <> ${userId}`));
    const open = others.filter((o) => !blocked.has(o.userId));
    const reps = await reputations(tx, [...new Set(open.map((o) => o.userId))]);

    const toOffer = (r: typeof peerAvailability.$inferSelect): PeerOffer => {
      const rep = reps.get(r.userId);
      return {
        userId: r.userId,
        window: { startsAt: r.startsAt.getTime(), endsAt: r.endsAt.getTime() },
        prefs: {
          topics: r.prefs.topics as PeerTopic[],
          difficulty: dto1to3(r.prefs.difficulty),
          language: r.prefs.language,
        },
        rating: rep && rep.label !== "new" ? rep.rating : null,
        noShowRate: rep?.noShowRate ?? 0,
      };
    };
    const pool = open.map(toOffer);
    const rowOf = new Map<PeerOffer, (typeof open)[number]>(pool.map((o, i) => [o, open[i]!]));
    let best: {
      mine: (typeof mine)[number];
      m: NonNullable<ReturnType<typeof bestMatch>>;
      me: PeerOffer;
    } | null = null;
    for (const w of mine) {
      const me = toOffer(w);
      const m = bestMatch(me, pool, { minutes: input.minutes, now: now.getTime(), blocked });
      if (
        m &&
        (!best ||
          m.score > best.m.score ||
          (m.score === best.m.score && m.startsAt < best.m.startsAt))
      )
        best = { mine: w, m, me };
    }
    if (!best)
      throw new AppError(
        "NO_MATCH",
        404,
        "Nobody is free at a matching time yet. Your windows stay open: try again later or invite a friend.",
      );

    const theirs = rowOf.get(best.m.offer)!;
    const startsAt = new Date(best.m.startsAt);
    const session = await insertSession(tx, {
      aUser: userId,
      bUser: best.m.userId,
      scheduledAt: startsAt,
      minutes: input.minutes,
      topic: best.m.topic,
      difficulty: (best.me.prefs.difficulty + best.m.offer.prefs.difficulty) / 2,
      source: "match",
    });

    // use up both windows atomically: whoever loses a race gets a retry, never a double booking
    for (const row of [best.mine, theirs]) {
      const gone = await tx
        .delete(peerAvailability)
        .where(eq(peerAvailability.id, row.id))
        .returning({ id: peerAvailability.id });
      if (gone.length === 0)
        throw new AppError("CONFLICT", 409, "That window was just taken. Try again.");
      for (const rest of leftover(
        { startsAt: row.startsAt.getTime(), endsAt: row.endsAt.getTime() },
        startsAt.getTime(),
        input.minutes,
      )) {
        await tx.insert(peerAvailability).values({
          id: newId(),
          userId: row.userId,
          startsAt: new Date(rest.startsAt),
          endsAt: new Date(rest.endsAt),
          prefs: row.prefs,
        });
      }
    }
    return detail(tx, session, userId, now);
  });
}

// ---------------------------------------------------------------- invites

const toInvite = (r: typeof peerInvites.$inferSelect, now: Date): PeerInviteDto => ({
  id: r.id,
  topic: r.topic as PeerTopicValue,
  difficulty: dto1to3(r.difficulty),
  minutes: r.minutes,
  scheduledAt: iso(r.scheduledAt),
  expiresAt: iso(r.expiresAt),
  status: r.revokedAt
    ? "revoked"
    : r.sessionId
      ? "accepted"
      : r.expiresAt.getTime() <= now.getTime()
        ? "expired"
        : "open",
  sessionId: r.sessionId,
});

export async function createInvite(
  db: Database,
  userId: string,
  input: CreatePeerInviteInput,
  now: Date,
): Promise<CreatedPeerInviteDto> {
  const scheduledAt = new Date(input.scheduledAt);
  const lead = scheduledAt.getTime() - now.getTime();
  if (lead < INVITE_MIN_LEAD_MS || lead > INVITE_MAX_AHEAD_MS)
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      "Pick a time between 30 minutes and 30 days from now.",
    );
  const open = await db
    .select({ id: peerInvites.id })
    .from(peerInvites)
    .where(
      and(
        eq(peerInvites.ownerId, userId),
        isNull(peerInvites.revokedAt),
        isNull(peerInvites.sessionId),
        gt(peerInvites.expiresAt, now),
      ),
    );
  if (open.length >= PEER_LIMITS.openInvites)
    throw new AppError("LIMIT_REACHED", 409, "Revoke an invite before making another one.");
  const token = randomBytes(24).toString("base64url");
  const [row] = await db
    .insert(peerInvites)
    .values({
      id: newId(),
      ownerId: userId,
      tokenHash: hashToken(token),
      topic: input.topic,
      difficulty: input.difficulty,
      minutes: input.minutes,
      scheduledAt,
      // the link stops working when the session would start
      expiresAt: scheduledAt,
    })
    .returning();
  return { ...toInvite(row!, now), token };
}

export async function listInvites(db: Database, userId: string, now: Date) {
  const rows = await db
    .select()
    .from(peerInvites)
    .where(eq(peerInvites.ownerId, userId))
    .orderBy(desc(peerInvites.createdAt), desc(peerInvites.id))
    .limit(50);
  return rows.map((r) => toInvite(r, now));
}

export async function revokeInvite(db: Database, userId: string, id: string, now: Date) {
  const [row] = await db
    .update(peerInvites)
    .set({ revokedAt: now })
    .where(
      and(eq(peerInvites.id, id), eq(peerInvites.ownerId, userId), isNull(peerInvites.sessionId)),
    )
    .returning();
  if (!row) throw notFound("Invite");
  return toInvite(row, now);
}

async function openInvite(db: Database | Db, token: string, now: Date) {
  const [inv] = await db
    .select()
    .from(peerInvites)
    .where(eq(peerInvites.tokenHash, hashToken(token)));
  // unknown, revoked, used and expired links all look the same
  if (!inv || inv.revokedAt || inv.sessionId || inv.expiresAt.getTime() <= now.getTime())
    throw new AppError("NOT_FOUND", 404, "This invite is not available.");
  return inv;
}

export async function previewInvite(
  db: Database,
  userId: string,
  token: string,
  now: Date,
): Promise<PeerInvitePreviewDto> {
  const inv = await openInvite(db, token, now);
  if ((await blockedWith(db, userId)).has(inv.ownerId))
    throw new AppError("NOT_FOUND", 404, "This invite is not available.");
  const owner = (await handles(db, [inv.ownerId])).get(inv.ownerId) ?? "someone";
  return {
    owner,
    topic: inv.topic as PeerTopicValue,
    difficulty: dto1to3(inv.difficulty),
    minutes: inv.minutes,
    scheduledAt: iso(inv.scheduledAt),
  };
}

export async function acceptInvite(
  db: Database,
  userId: string,
  token: string,
  now: Date,
): Promise<PeerSessionDetail> {
  return withTransaction(db, async (tx) => {
    const inv = await openInvite(tx, token, now);
    if (inv.ownerId === userId)
      throw new AppError("VALIDATION_FAILED", 422, "That is your own invite.");
    if ((await blockedWith(tx, userId)).has(inv.ownerId))
      throw new AppError("NOT_FOUND", 404, "This invite is not available.");
    const session = await insertSession(tx, {
      aUser: inv.ownerId,
      bUser: userId,
      scheduledAt: inv.scheduledAt,
      minutes: inv.minutes,
      topic: inv.topic as PeerTopic,
      difficulty: inv.difficulty,
      source: "invite",
    });
    // the claim: only the first person to get here wins
    const claimed = await tx
      .update(peerInvites)
      .set({ sessionId: session.id })
      .where(and(eq(peerInvites.id, inv.id), isNull(peerInvites.sessionId)))
      .returning({ id: peerInvites.id });
    if (claimed.length === 0) throw new AppError("NOT_FOUND", 404, "This invite is not available.");
    return detail(tx, session, userId, now);
  });
}

// ---------------------------------------------------------------- sessions: reading

async function feedbackFor(db: Database | Db, sessionIds: readonly string[]) {
  if (sessionIds.length === 0) return [];
  return db
    .select()
    .from(peerFeedback)
    .where(inArray(peerFeedback.sessionId, [...sessionIds]));
}

async function items(
  db: Database | Db,
  rows: readonly SessionRow[],
  userId: string,
): Promise<PeerSessionItem[]> {
  const partners = rows.map((r) => partnerId(r, userId));
  const [names, reps, fb] = await Promise.all([
    handles(db, partners),
    reputations(db, partners),
    feedbackFor(
      db,
      rows.map((r) => r.id),
    ),
  ]);
  return rows.map((r) => {
    const pid = partnerId(r, userId);
    const partner: PeerPartnerDto = {
      userId: pid,
      handle: names.get(pid) ?? "former user",
      reputation: reps.get(pid)!,
    };
    return {
      id: r.id,
      scheduledAt: iso(r.scheduledAt),
      minutes: r.minutes,
      topic: r.topic as PeerTopicValue,
      difficulty: dto1to3(r.difficulty),
      state: r.state as PeerSessionState,
      source: r.source as "match" | "invite",
      partner,
      youAreFirstCandidate: r.firstCandidate === sideOf(r, userId),
      feedbackGiven: fb.some((f) => f.sessionId === r.id && f.fromUser === userId),
    };
  });
}

export async function listSessions(db: Database, userId: string, now: Date) {
  await closeOverdue(db, userId, now);
  const rows = await db
    .select()
    .from(peerSessions)
    .where(or(eq(peerSessions.aUser, userId), eq(peerSessions.bUser, userId)))
    .orderBy(desc(peerSessions.scheduledAt), desc(peerSessions.id))
    .limit(50);
  return items(db, rows, userId);
}

/** A live session nobody ended is closed once its time and a grace period are over. */
async function closeOverdue(db: Database | Db, userId: string, now: Date) {
  const live = await db
    .select()
    .from(peerSessions)
    .where(
      and(
        or(eq(peerSessions.aUser, userId), eq(peerSessions.bUser, userId)),
        eq(peerSessions.state, "live"),
      ),
    );
  for (const s of live) {
    const start = (s.startedAt ?? s.scheduledAt).getTime();
    if (now.getTime() >= start + s.minutes * MIN + LATE_COMPLETE_MS)
      await db
        .update(peerSessions)
        .set({ state: "completed", endedAt: new Date(start + s.minutes * MIN) })
        .where(and(eq(peerSessions.id, s.id), eq(peerSessions.state, "live")));
  }
}

async function load(db: Database | Db, userId: string, id: string): Promise<SessionRow> {
  const [row] = await db
    .select()
    .from(peerSessions)
    .where(
      and(
        eq(peerSessions.id, id),
        or(eq(peerSessions.aUser, userId), eq(peerSessions.bUser, userId)),
      ),
    );
  if (!row) throw notFound();
  return row;
}

async function detail(
  db: Database | Db,
  s: SessionRow,
  userId: string,
  now: Date,
): Promise<PeerSessionDetail> {
  const [item] = await items(db, [s], userId);
  const side = sideOf(s, userId);
  const state = s.state as PeerSessionState;
  const fb = await feedbackFor(db, [s.id]);
  const mine = fb.find((f) => f.fromUser === userId);
  const theirs = fb.find((f) => f.fromUser !== userId);
  const partnerConsent = partnerId(s, userId) === s.aUser ? s.aConsentAi : s.bConsentAi;
  const youConsent = side === "a" ? s.aConsentAi : s.bConsentAi;

  let clock: PeerSessionDetail["clock"] = null;
  let question: PeerQuestionView | null = null;
  let panel: PeerSessionDetail["panel"] = null;
  let questions: PeerQuestionView[] | null = null;
  if (state === "live" && s.startedAt) {
    const c = peerClock({
      startedAt: s.startedAt.getTime(),
      now: now.getTime(),
      minutes: s.minutes,
      firstCandidate: s.firstCandidate as PeerSide,
    });
    const you = c.candidate === side ? "candidate" : "interviewer";
    clock = {
      half: c.half,
      you,
      halfRemainingMs: c.halfRemainingMs,
      remainingMs: c.remainingMs,
    };
    // before the start time nobody sees a question; after it, only the current half's
    if (now.getTime() >= s.startedAt.getTime()) {
      const content = await questionContent(db, s.questions);
      const q = content[c.questionIndex];
      if (q) {
        question = q.view;
        if (you === "interviewer") panel = q.panel;
      }
    }
  }
  if (state === "completed") {
    questions = (await questionContent(db, s.questions)).map((q) => q.view);
  }
  const joined = side === "a" ? s.aJoinedAt : s.bJoinedAt;
  const partnerJoined = side === "a" ? s.bJoinedAt : s.aJoinedAt;
  return {
    ...item!,
    startedAt: s.startedAt ? iso(s.startedAt) : null,
    endedAt: s.endedAt ? iso(s.endedAt) : null,
    clock,
    question,
    panel,
    questions,
    consent: { you: youConsent, partner: partnerConsent, both: youConsent && partnerConsent },
    youJoined: joined !== null,
    canOpen:
      (state === "scheduled" || state === "live") &&
      canOpen(s.scheduledAt.getTime(), s.minutes, now.getTime()),
    canReportNoShow:
      (state === "scheduled" || state === "live") &&
      joined !== null &&
      partnerJoined === null &&
      noShowDue(s.scheduledAt.getTime(), now.getTime()),
    canCancel: state === "scheduled",
    // the partner's feedback is revealed once you have written yours
    feedbackFromPartner:
      mine && theirs ? { ratings: theirs.ratings, comments: theirs.comments } : null,
  };
}

export async function getSession(db: Database, userId: string, id: string, now: Date) {
  await closeOverdue(db, userId, now);
  return detail(db, await load(db, userId, id), userId, now);
}

// ---------------------------------------------------------------- sessions: lifecycle

export async function setConsent(db: Database, userId: string, id: string, ai: boolean, now: Date) {
  const s = await load(db, userId, id);
  if (s.state === "cancelled" || s.state === "no_show")
    throw new AppError("CONFLICT", 409, "This session is over.");
  const col = sideOf(s, userId) === "a" ? { aConsentAi: ai } : { bConsentAi: ai };
  const [row] = await db.update(peerSessions).set(col).where(eq(peerSessions.id, id)).returning();
  return detail(db, row!, userId, now);
}

/** Opens the room: records that this person is here, and starts the clock at the scheduled time. */
export async function open(db: Database, userId: string, id: string, now: Date) {
  const s = await load(db, userId, id);
  if (s.state !== "scheduled" && s.state !== "live")
    throw new AppError("CONFLICT", 409, "This session is not open.");
  if (!canOpen(s.scheduledAt.getTime(), s.minutes, now.getTime()))
    throw new AppError(
      "TOO_EARLY",
      409,
      now.getTime() < s.scheduledAt.getTime()
        ? "The room opens 10 minutes before the start."
        : "The session time is over.",
    );
  const side = sideOf(s, userId);
  const patch: Partial<typeof peerSessions.$inferInsert> = {
    state: "live",
    startedAt: s.startedAt ?? new Date(Math.max(now.getTime(), s.scheduledAt.getTime())),
  };
  if (side === "a") patch.aJoinedAt = s.aJoinedAt ?? now;
  else patch.bJoinedAt = s.bJoinedAt ?? now;
  const [row] = await db.update(peerSessions).set(patch).where(eq(peerSessions.id, id)).returning();
  return detail(db, row!, userId, now);
}

export async function complete(db: Database, userId: string, id: string, now: Date) {
  const s = await load(db, userId, id);
  if (s.state !== "live")
    throw new AppError("CONFLICT", 409, "Only a running session can be ended.");
  const [row] = await db
    .update(peerSessions)
    .set({ state: "completed", endedAt: now })
    .where(and(eq(peerSessions.id, id), eq(peerSessions.state, "live")))
    .returning();
  return detail(db, row ?? (await load(db, userId, id)), userId, now);
}

export async function cancel(db: Database, userId: string, id: string, now: Date) {
  const s = await load(db, userId, id);
  if (s.state !== "scheduled")
    throw new AppError("CONFLICT", 409, "Only a session that has not started can be cancelled.");
  const [row] = await db
    .update(peerSessions)
    .set({ state: "cancelled", cancelledBy: userId, endedAt: now })
    .where(and(eq(peerSessions.id, id), eq(peerSessions.state, "scheduled")))
    .returning();
  return detail(db, row ?? (await load(db, userId, id)), userId, now);
}

/** The partner never showed up: possible once the caller is in the room and 15 minutes have passed. */
export async function reportNoShow(db: Database, userId: string, id: string, now: Date) {
  const s = await load(db, userId, id);
  const side = sideOf(s, userId);
  const here = side === "a" ? s.aJoinedAt : s.bJoinedAt;
  const there = side === "a" ? s.bJoinedAt : s.aJoinedAt;
  if (
    (s.state !== "scheduled" && s.state !== "live") ||
    !here ||
    there ||
    !noShowDue(s.scheduledAt.getTime(), now.getTime())
  )
    throw new AppError(
      "CONFLICT",
      409,
      "You can report a no-show 15 minutes after the start, from inside the room.",
    );
  const [row] = await db
    .update(peerSessions)
    .set({ state: "no_show", noShowUser: partnerId(s, userId), endedAt: now })
    .where(and(eq(peerSessions.id, id), inArray(peerSessions.state, ["scheduled", "live"])))
    .returning();
  return detail(db, row ?? (await load(db, userId, id)), userId, now);
}

// ---------------------------------------------------------------- feedback, reputation, safety

export async function giveFeedback(
  db: Database,
  userId: string,
  id: string,
  input: PeerFeedbackInput,
): Promise<PeerFeedbackResult> {
  const s = await load(db, userId, id);
  if (s.state !== "completed")
    throw new AppError("CONFLICT", 409, "Feedback opens when the session is over.");
  const nudges = feedbackNudges({ ratings: input.ratings, comments: input.comments });
  if (nudges.length > 0 && !input.confirmed) return { saved: false, nudges };
  const inserted = await db
    .insert(peerFeedback)
    .values({
      id: newId(),
      sessionId: id,
      fromUser: userId,
      toUser: partnerId(s, userId),
      ratings: input.ratings,
      comments: input.comments,
      nudges: nudges.length,
    })
    .onConflictDoNothing()
    .returning({ id: peerFeedback.id });
  if (inserted.length === 0)
    throw new AppError("CONFLICT", 409, "You already gave feedback for this session.");
  return { saved: true, nudges };
}

export async function myReputation(db: Database, userId: string): Promise<PeerReputationDto> {
  return (await reputations(db, [userId])).get(userId)!;
}

async function sharedSession(db: Database | Db, a: string, b: string, sessionId?: string | null) {
  const rows = await db
    .select({ id: peerSessions.id })
    .from(peerSessions)
    .where(
      and(
        or(
          and(eq(peerSessions.aUser, a), eq(peerSessions.bUser, b)),
          and(eq(peerSessions.aUser, b), eq(peerSessions.bUser, a)),
        ),
        sessionId ? eq(peerSessions.id, sessionId) : sql`true`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** A report goes to people who review it; nothing happens to the reported person automatically. */
export async function report(db: Database, userId: string, input: PeerReportInput) {
  if (input.userId === userId)
    throw new AppError("VALIDATION_FAILED", 422, "You cannot report yourself.");
  if (!(await sharedSession(db, userId, input.userId, input.sessionId))) throw notFound("Person");
  await db.insert(peerReports).values({
    id: newId(),
    reporterId: userId,
    reportedId: input.userId,
    sessionId: input.sessionId ?? null,
    reason: input.reason,
    details: input.details,
  });
  return { ok: true as const };
}

export async function block(db: Database, userId: string, other: string, now: Date) {
  if (other === userId) throw new AppError("VALIDATION_FAILED", 422, "You cannot block yourself.");
  if (!(await sharedSession(db, userId, other))) throw notFound("Person");
  return withTransaction(db, async (tx) => {
    await tx
      .insert(peerBlocks)
      .values({ id: newId(), userId, blockedUserId: other })
      .onConflictDoNothing();
    // sessions that have not started are cancelled; nobody is made to meet a blocked person
    await tx
      .update(peerSessions)
      .set({ state: "cancelled", cancelledBy: userId, endedAt: now })
      .where(
        and(
          eq(peerSessions.state, "scheduled"),
          or(
            and(eq(peerSessions.aUser, userId), eq(peerSessions.bUser, other)),
            and(eq(peerSessions.aUser, other), eq(peerSessions.bUser, userId)),
          ),
        ),
      );
    return { ok: true as const };
  });
}

export async function unblock(db: Database, userId: string, other: string) {
  await db
    .delete(peerBlocks)
    .where(and(eq(peerBlocks.userId, userId), eq(peerBlocks.blockedUserId, other)));
  return { ok: true as const };
}

export async function listBlocks(db: Database, userId: string) {
  const rows = await db
    .select({ id: peerBlocks.blockedUserId })
    .from(peerBlocks)
    .where(eq(peerBlocks.userId, userId));
  const names = await handles(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ userId: r.id, handle: names.get(r.id) ?? "former user" }));
}

// ---------------------------------------------------------------- calendar

export async function calendar(
  db: Database,
  userId: string,
  id: string,
  now: Date,
  baseUrl: string,
): Promise<string> {
  const s = await load(db, userId, id);
  if (s.state !== "scheduled" && s.state !== "live")
    throw new AppError("CONFLICT", 409, "Only an upcoming session has a calendar file.");
  const partner =
    (await handles(db, [partnerId(s, userId)])).get(partnerId(s, userId)) ?? "a partner";
  const topic = s.topic as PeerTopic;
  return buildIcs({
    uid: s.id,
    startsAt: s.scheduledAt.getTime(),
    minutes: s.minutes,
    title: `PrepQuest peer mock with ${partner}`,
    description: `${s.minutes} minute ${topic.toUpperCase()} mock interview. You take turns: one half each.`,
    url: `${baseUrl}/peer/${s.id}`,
    stampedAt: now.getTime(),
  });
}

// ---------------------------------------------------------------- the live room

/** Whether this person may be in the room right now: a member of a live session. Returns the side. */
export async function roomAccess(
  db: Database,
  userId: string,
  id: string,
  now: Date,
): Promise<{ side: PeerSide; partnerId: string }> {
  await closeOverdue(db, userId, now);
  const s = await load(db, userId, id);
  if (s.state !== "live")
    throw new AppError("CONFLICT", 409, "The room is open only while the session is running.");
  const side = sideOf(s, userId);
  if (!(side === "a" ? s.aJoinedAt : s.bJoinedAt))
    throw new AppError("CONFLICT", 409, "Open the room first.");
  return { side, partnerId: partnerId(s, userId) };
}

/** The state of a session, for the room's sweep; null when it does not exist. */
export async function sessionState(
  db: Database,
  id: string,
  now: Date,
): Promise<PeerSessionState | null> {
  const [row] = await db.select().from(peerSessions).where(eq(peerSessions.id, id));
  if (!row) return null;
  if (
    row.state === "live" &&
    now.getTime() >=
      (row.startedAt ?? row.scheduledAt).getTime() + row.minutes * MIN + LATE_COMPLETE_MS
  ) {
    await closeOverdue(db, row.aUser, now);
    return "completed";
  }
  return row.state as PeerSessionState;
}

/**
 * Follow-up prompts for the interviewer, written from the question and the code on the shared editor.
 * Only the current half's interviewer may ask, at most once every 20 seconds and 12 times a session;
 * the model never sees audio or a transcript, and what comes back is cleaned in code.
 */
export async function suggest(
  ctx: AiContext,
  userId: string,
  id: string,
  code: { text: string; language: string | null },
  now: Date,
): Promise<PeerSuggestionsDto> {
  const { db } = ctx;
  const s = await load(db, userId, id);
  if (s.state !== "live" || !s.startedAt)
    throw new AppError("CONFLICT", 409, "Suggestions are available while the session is running.");
  const c = peerClock({
    startedAt: s.startedAt.getTime(),
    now: now.getTime(),
    minutes: s.minutes,
    firstCandidate: s.firstCandidate as PeerSide,
  });
  if (c.candidate === sideOf(s, userId))
    throw new AppError("FORBIDDEN", 403, "Suggestions are only for the interviewer.");
  const verdict = suggestionAllowed(
    { count: s.suggestCount, lastAt: s.suggestAt?.getTime() ?? null },
    now.getTime(),
  );
  if (!verdict.ok)
    throw new AppError(
      "RATE_LIMITED",
      429,
      verdict.reason === "cap"
        ? "You have used all the suggestions for this session."
        : `Give it a moment: another suggestion in ${Math.ceil(verdict.waitMs / 1000)} seconds.`,
    );
  // claim the slot atomically so two quick clicks cannot both go through
  const [claimed] = await db
    .update(peerSessions)
    .set({ suggestCount: s.suggestCount + 1, suggestAt: now })
    .where(and(eq(peerSessions.id, id), eq(peerSessions.suggestCount, s.suggestCount)))
    .returning();
  if (!claimed) throw new AppError("CONFLICT", 409, "Another request was just made. Try again.");

  const q = (await questionContent(db, s.questions))[c.questionIndex];
  if (!q) throw new AppError("CONFLICT", 409, "There is no question for this half.");
  const shown = [...q.panel.followups, ...s.suggested];
  try {
    const { value } = await ctx.llm.json(
      {
        task: "peer_suggest",
        modelClass: "light",
        system: PEER_SUGGEST_SYSTEM,
        messages: [
          {
            role: "user",
            content: buildPeerSuggestPrompt({
              title: q.view.title,
              statement: q.view.statementMd,
              language: code.language,
              code: code.text.slice(0, 6000),
              alreadyAsked: shown.slice(-12),
            }),
          },
        ],
        maxTokens: 700,
        effort: "low",
        userId,
        sessionId: id,
        promptVersion: PEER_SUGGEST_PROMPT_VERSION,
      },
      peerSuggestionsSchema,
    );
    const items = cleanSuggestions(value.items, shown);
    await db
      .update(peerSessions)
      .set({ suggested: [...s.suggested, ...items.map((i) => i.text)].slice(-40) })
      .where(eq(peerSessions.id, id));
    return { items, remaining: Math.max(0, 12 - claimed.suggestCount) };
  } catch (err) {
    // the model failed: give the slot back so a failure costs nothing
    await db
      .update(peerSessions)
      .set({ suggestCount: s.suggestCount, suggestAt: s.suggestAt })
      .where(eq(peerSessions.id, id));
    ctx.log.warn({ err: String(err), sessionId: id }, "peer suggestions failed");
    throw new AppError("AI_UNAVAILABLE", 503, "Suggestions are not available right now.");
  }
}
