import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import {
  contests,
  interviewSessions,
  newId,
  profiles,
  sharedReports,
  type Database,
} from "@prepquest/db";
import {
  AppError,
  type CreatedShareDto,
  type CreateShareInput,
  type PublicReportDto,
  type ReportPayload,
  type ScorecardDto,
  type ShareDto,
  type ShareEntity,
  type ShareOptions,
} from "@prepquest/shared";
import { getReadiness } from "../analytics/service.js";
import { standings } from "../contests/service.js";
import { getReview, toSessionDto } from "../interviews/service.js";
import {
  ANONYMOUS_OWNER,
  buildContestReport,
  buildReadinessReport,
  buildScorecardReport,
  nameTerms,
  type Privacy,
} from "./report.js";
import { renderOgPng, type OgCard } from "./og-image.js";

// Shareable reports (U5). A link is `/r/<token>`: the token is random and only its hash is stored, the payload
// is a filtered snapshot made when the link was created, and a revoked, expired or unknown token is the same
// 404. Views are counted when the report is opened, not when its preview image is fetched.

const MAX_ACTIVE_LINKS = 50;
const DAY_MS = 86_400_000;
const EXPIRY_DAYS = { "7d": 7, "30d": 30 } as const;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const missing = () => new AppError("NOT_FOUND", 404, "This report is not available.");

type Row = typeof sharedReports.$inferSelect;

function statusOf(r: Pick<Row, "revokedAt" | "expiresAt">, now: Date): ShareDto["status"] {
  if (r.revokedAt) return "revoked";
  if (r.expiresAt && r.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

function toDto(r: Row, now: Date): ShareDto {
  return {
    id: r.id,
    entityType: r.entityType as ShareEntity,
    title: (r.payload as ReportPayload).title,
    visibility: r.visibility as ShareDto["visibility"],
    options: r.options as ShareOptions,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    views: r.views,
    createdAt: r.createdAt.toISOString(),
    status: statusOf(r, now),
  };
}

async function ownerProfile(db: Database, userId: string) {
  const [p] = await db
    .select({ displayName: profiles.displayName, handle: profiles.handle })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  return p ?? { displayName: "", handle: "" };
}

/** Build the filtered payload for the thing being shared. */
async function snapshot(
  db: Database,
  userId: string,
  input: CreateShareInput,
  now: Date,
): Promise<{ entityId: string | null; payload: ReportPayload }> {
  const owner = await ownerProfile(db, userId);
  const base = {
    options: input.options,
    nameTerms: nameTerms(owner.displayName, owner.handle),
  };
  if (input.entityType === "scorecard") {
    const [s] = await db
      .select()
      .from(interviewSessions)
      .where(and(eq(interviewSessions.id, input.ref!), eq(interviewSessions.userId, userId)));
    if (!s) throw new AppError("NOT_FOUND", 404, "Interview not found");
    if (!s.endedAt)
      throw new AppError("INTERVIEW_NOT_ACTIVE", 409, "Finish the interview before sharing it.");
    const review = await getReview(db, s, now);
    if (review.status !== "ready" || !review.scorecard)
      throw new AppError("SCORECARD_NOT_READY", 409, "The scorecard is not ready yet.");
    const session = toSessionDto(s, now);
    const privacy: Privacy = {
      ...base,
      companyTerms: [session.company ?? "", s.companyName ?? ""],
    };
    return {
      entityId: s.id,
      payload: buildScorecardReport(review.scorecard as ScorecardDto, session, privacy),
    };
  }
  if (input.entityType === "contest") {
    const [c] = await db.select().from(contests).where(eq(contests.slug, input.ref!));
    if (!c) throw new AppError("NOT_FOUND", 404, "That contest does not exist.");
    if (c.endsAt.getTime() > now.getTime())
      throw new AppError("CONTEST_NOT_OVER", 409, "Share your result once the contest has ended.");
    const table = await standings(db, userId, c.slug, 1, now);
    if (!table.me)
      throw new AppError("NOT_A_PARTICIPANT", 409, "You did not take part in this contest.");
    return { entityId: c.id, payload: buildContestReport(c.title, table, table.me) };
  }
  const readiness = await getReadiness(db, userId, input.ref, now);
  if (readiness.score === null)
    throw new AppError(
      "NOT_ENOUGH_DATA",
      409,
      "There is not enough data for a readiness report yet.",
    );
  return {
    entityId: null,
    payload: buildReadinessReport(readiness, { ...base, companyTerms: [] }),
  };
}

export async function createShare(
  db: Database,
  userId: string,
  input: CreateShareInput,
  now: Date,
): Promise<CreatedShareDto> {
  const [{ n }] = (await db
    .select({ n: count() })
    .from(sharedReports)
    .where(and(eq(sharedReports.ownerId, userId), isNull(sharedReports.revokedAt)))) as [
    { n: number },
  ];
  if (n >= MAX_ACTIVE_LINKS)
    throw new AppError("LIMIT_REACHED", 409, "Revoke a link before making another one.");
  const { entityId, payload } = await snapshot(db, userId, input, now);
  const token = randomBytes(24).toString("base64url");
  const [row] = await db
    .insert(sharedReports)
    .values({
      id: newId(),
      ownerId: userId,
      entityType: input.entityType,
      entityId,
      tokenHash: hashToken(token),
      visibility: input.visibility,
      options: input.options,
      payload,
      expiresAt:
        input.expiresIn === "never"
          ? null
          : new Date(now.getTime() + EXPIRY_DAYS[input.expiresIn] * DAY_MS),
    })
    .returning();
  return { ...toDto(row!, now), token, path: `/r/${token}` };
}

export async function listShares(db: Database, userId: string, now: Date): Promise<ShareDto[]> {
  const rows = await db
    .select()
    .from(sharedReports)
    .where(eq(sharedReports.ownerId, userId))
    .orderBy(desc(sharedReports.createdAt), desc(sharedReports.id));
  return rows.map((r) => toDto(r, now));
}

export async function revokeShare(db: Database, userId: string, id: string, now: Date) {
  const [row] = await db
    .update(sharedReports)
    .set({ revokedAt: now })
    .where(
      and(
        eq(sharedReports.id, id),
        eq(sharedReports.ownerId, userId),
        isNull(sharedReports.revokedAt),
      ),
    )
    .returning();
  if (row) return toDto(row, now);
  // already revoked: report it as it is. Someone else's link or an unknown id is a 404.
  const [existing] = await db
    .select()
    .from(sharedReports)
    .where(and(eq(sharedReports.id, id), eq(sharedReports.ownerId, userId)));
  if (!existing) throw new AppError("NOT_FOUND", 404, "That link does not exist.");
  return toDto(existing, now);
}

async function liveRow(db: Database, token: string, now: Date): Promise<Row> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw missing();
  const [row] = await db
    .select()
    .from(sharedReports)
    .where(eq(sharedReports.tokenHash, hashToken(token)));
  if (!row || statusOf(row, now) !== "active") throw missing();
  return row;
}

/** The public view of a report. Counts a view. */
export async function openReport(db: Database, token: string, now: Date): Promise<PublicReportDto> {
  const row = await liveRow(db, token, now);
  await db
    .update(sharedReports)
    .set({ views: sql`${sharedReports.views} + 1`, lastViewedAt: now })
    .where(eq(sharedReports.id, row.id));
  const options = row.options as ShareOptions;
  const owner = options.hideName ? null : await ownerProfile(db, row.ownerId);
  const payload = row.payload as ReportPayload;
  return {
    entityType: row.entityType as ShareEntity,
    title: payload.title,
    owner: owner?.displayName || owner?.handle || ANONYMOUS_OWNER,
    createdAt: row.createdAt.toISOString(),
    visibility: row.visibility as PublicReportDto["visibility"],
    payload,
  };
}

function ogCard(payload: ReportPayload, owner: string): OgCard {
  if (payload.kind === "scorecard") {
    const overall = payload.overall;
    return {
      heading: "MOCK INTERVIEW SCORECARD",
      title: payload.company ? `${payload.title} at ${payload.company}` : payload.title,
      big: overall === null ? "-" : String(overall),
      unit: "/100",
      sub: payload.band ?? "",
      tone: overall === null ? "plain" : overall >= 70 ? "good" : overall < 40 ? "weak" : "plain",
      lines: payload.scores
        .filter((s) => s.score !== null)
        .slice(0, 4)
        .map((s) => `${s.name} ${s.score}/5`),
      footer: owner,
    };
  }
  if (payload.kind === "contest") {
    const solved = payload.problems.filter((p) => p.solved).length;
    return {
      heading: "CONTEST RESULT",
      title: payload.title,
      big: `#${payload.rank}`,
      sub: `${solved} of ${payload.problems.length} solved`,
      tone: payload.rank <= 3 ? "good" : "plain",
      lines: payload.problems
        .slice(0, 4)
        .map((p) => `${p.label} ${p.solved ? `solved ${p.minute ?? ""}`.trim() : "not solved"}`),
      footer: `${owner} - ${payload.of} players`,
    };
  }
  const score = payload.score;
  return {
    heading: "PLACEMENT READINESS",
    title: payload.label,
    big: score === null ? "-" : String(score),
    unit: "/100",
    sub: payload.band === null ? "" : `plus or minus ${payload.band}`,
    tone: score === null ? "plain" : score >= 70 ? "good" : score < 40 ? "weak" : "plain",
    lines: payload.components
      .filter((c) => c.score !== null)
      .slice(0, 4)
      .map((c) => `${c.label} ${Math.round((c.score ?? 0) * 100)}`),
    footer: owner,
  };
}

/** The preview image for a link; the same checks as the page, no view counted. */
export async function reportImage(db: Database, token: string, now: Date): Promise<Buffer> {
  const row = await liveRow(db, token, now);
  const options = row.options as ShareOptions;
  const owner = options.hideName ? null : await ownerProfile(db, row.ownerId);
  return renderOgPng(ogCard(row.payload as ReportPayload, owner?.displayName || ANONYMOUS_OWNER));
}
