import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  editorials,
  hints,
  hintUsage,
  problems,
  userProblemState,
  userSettings,
  type Db,
} from "@prepquest/db";
import { canGiveUp, editorialAccess, hintDecision, type HintMode } from "@prepquest/analytics-core";
import {
  AppError,
  type EditorialDto,
  type EditorialLockedDetails,
  type HintsResponse,
  type HintTierView,
  type HintUnlocked,
  type SolveRating,
} from "@prepquest/shared";
import { findVisibleProblem } from "../problems/service.js";

/** What the unlock rules need to know about this user and problem. */
async function context(db: Db, userId: string, problemId: string) {
  const [state] = await db
    .select()
    .from(userProblemState)
    .where(and(eq(userProblemState.userId, userId), eq(userProblemState.problemId, problemId)));
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  const used = await db
    .select({ tier: hintUsage.tier, usedAt: hintUsage.usedAt })
    .from(hintUsage)
    .where(and(eq(hintUsage.userId, userId), eq(hintUsage.problemId, problemId)))
    .orderBy(asc(hintUsage.tier));
  const mode: HintMode = settings?.hintMode === "relaxed" ? "relaxed" : "strict";
  return {
    state,
    mode,
    openEditorials: settings?.openEditorials ?? false,
    usedTiers: used.map((u) => u.tier),
    lastHintAt: used.reduce<Date | null>(
      (latest, u) => (!latest || u.usedAt > latest ? u.usedAt : latest),
      null,
    ),
    solved: state?.status === "solved",
    firstSeenAt: state?.firstSeenAt ?? null,
  };
}

// ---------------------------------------------------------------- hints (D4)

export async function getHints(db: Db, userId: string, slug: string): Promise<HintsResponse> {
  const problem = await findVisibleProblem(db, slug);
  const ctx = await context(db, userId, problem.id);
  const rows = await db
    .select({ tier: hints.tier, bodyMd: hints.bodyMd })
    .from(hints)
    .where(eq(hints.problemId, problem.id))
    .orderBy(asc(hints.tier));
  const now = new Date();
  const tiers: HintTierView[] = rows.map((h) => {
    if (ctx.usedTiers.includes(h.tier)) return { tier: h.tier, viewed: true, bodyMd: h.bodyMd };
    // once a problem is solved, hints are free to read: only the order matters
    const decision = hintDecision({
      tier: h.tier,
      usedTiers: ctx.usedTiers,
      firstSeenAt: ctx.solved ? null : ctx.firstSeenAt,
      lastHintAt: ctx.solved ? null : ctx.lastHintAt,
      now,
      mode: ctx.mode,
    });
    if (decision.allowed) return { tier: h.tier, viewed: false };
    return {
      tier: h.tier,
      viewed: false,
      locked:
        decision.reason === "cooldown"
          ? { reason: "cooldown", unlockAt: decision.unlockAt.toISOString() }
          : { reason: "previous_tier", missingTier: decision.missingTier },
    };
  });
  return { mode: ctx.mode, tiers, hintsUsed: Math.max(0, ...ctx.usedTiers) };
}

export async function unlockHint(
  db: Db,
  userId: string,
  slug: string,
  tier: number,
): Promise<HintUnlocked> {
  const problem = await findVisibleProblem(db, slug);
  const [hint] = await db
    .select({ bodyMd: hints.bodyMd })
    .from(hints)
    .where(and(eq(hints.problemId, problem.id), eq(hints.tier, tier)));
  if (!hint) throw new AppError("NOT_FOUND", 404, "This problem has no hint at that level.");

  const ctx = await context(db, userId, problem.id);
  const decision = hintDecision({
    tier,
    usedTiers: ctx.usedTiers,
    firstSeenAt: ctx.solved ? null : ctx.firstSeenAt,
    lastHintAt: ctx.solved ? null : ctx.lastHintAt,
    now: new Date(),
    mode: ctx.mode,
  });
  if (!decision.allowed) {
    throw new AppError(
      "HINT_LOCKED",
      403,
      decision.reason === "cooldown"
        ? "That hint isn't available yet. Give the problem a little more thought first."
        : `View hint ${decision.missingTier} first.`,
      decision.reason === "cooldown"
        ? { reason: "cooldown", unlockAt: decision.unlockAt.toISOString() }
        : { reason: "previous_tier", missingTier: decision.missingTier },
    );
  }

  if (!decision.alreadyUsed) {
    await db
      .insert(hintUsage)
      .values({ userId, problemId: problem.id, tier })
      .onConflictDoNothing();
    // the problem's hint count is the highest tier viewed (it feeds XP and "clean solve")
    await db
      .insert(userProblemState)
      .values({ userId, problemId: problem.id, hintsUsed: tier, firstSeenAt: new Date() })
      .onConflictDoUpdate({
        target: [userProblemState.userId, userProblemState.problemId],
        set: { hintsUsed: sql`greatest(${userProblemState.hintsUsed}, ${tier})` },
      });
  }
  return { tier, bodyMd: hint.bodyMd, hintsUsed: Math.max(tier, ...ctx.usedTiers) };
}

// ---------------------------------------------------------------- editorial (D5)

function lockedDetails(
  access: ReturnType<typeof editorialAccess>,
  gaveUpPossible: boolean,
): EditorialLockedDetails {
  return {
    reasons: access.reasons,
    giveUpAt: access.giveUpAt?.toISOString() ?? null,
    canGiveUp: gaveUpPossible,
  };
}

async function access(db: Db, userId: string, problemId: string) {
  const ctx = await context(db, userId, problemId);
  const now = new Date();
  const result = editorialAccess({
    solved: ctx.solved,
    usedTiers: ctx.usedTiers,
    openEditorials: ctx.openEditorials,
    gaveUp: ctx.state?.gaveUpAt != null,
    firstSeenAt: ctx.firstSeenAt,
    now,
    mode: ctx.mode,
  });
  return {
    ctx,
    result,
    canGiveUp: canGiveUp({ firstSeenAt: ctx.firstSeenAt, now, mode: ctx.mode }),
  };
}

export async function getEditorial(db: Db, userId: string, slug: string): Promise<EditorialDto> {
  const problem = await findVisibleProblem(db, slug);
  const [row] = await db.select().from(editorials).where(eq(editorials.problemId, problem.id));
  if (!row) throw new AppError("NOT_FOUND", 404, "This problem has no editorial yet.");
  const { result, canGiveUp: can } = await access(db, userId, problem.id);
  if (!result.unlocked || !result.via) {
    throw new AppError(
      "EDITORIAL_LOCKED",
      403,
      "The editorial is locked for now.",
      lockedDetails(result, can),
    );
  }
  const relatedIds = row.relatedProblemIds ?? [];
  const related = relatedIds.length
    ? await db
        .select({ slug: problems.slug, title: problems.title })
        .from(problems)
        .where(and(inArray(problems.id, relatedIds), eq(problems.status, "published")))
    : [];
  return {
    approaches: row.approaches,
    talkTrackMd: row.talkTrackMd,
    related,
    via: result.via,
  };
}

/** Whether an editorial exists, and whether the user could read it right now (no content leaked). */
export async function editorialStatus(
  db: Db,
  userId: string,
  slug: string,
): Promise<{ exists: boolean; unlocked: boolean } & Partial<EditorialLockedDetails>> {
  const problem = await findVisibleProblem(db, slug);
  const [row] = await db
    .select({ id: editorials.id })
    .from(editorials)
    .where(eq(editorials.problemId, problem.id));
  if (!row) return { exists: false, unlocked: false };
  const { result, canGiveUp: can } = await access(db, userId, problem.id);
  return result.unlocked
    ? { exists: true, unlocked: true }
    : { exists: true, unlocked: false, ...lockedDetails(result, can) };
}

export async function giveUp(db: Db, userId: string, slug: string): Promise<EditorialDto> {
  const problem = await findVisibleProblem(db, slug);
  const [row] = await db.select().from(editorials).where(eq(editorials.problemId, problem.id));
  if (!row) throw new AppError("NOT_FOUND", 404, "This problem has no editorial yet.");
  const { ctx, result, canGiveUp: can } = await access(db, userId, problem.id);
  if (!result.unlocked) {
    if (!can) {
      throw new AppError(
        "GIVE_UP_TOO_EARLY",
        403,
        "Take a little longer with the problem before giving up.",
        { availableAt: result.giveUpAt?.toISOString() ?? null },
      );
    }
    await db
      .insert(userProblemState)
      .values({
        userId,
        problemId: problem.id,
        gaveUpAt: new Date(),
        firstSeenAt: ctx.firstSeenAt ?? new Date(),
      })
      .onConflictDoUpdate({
        target: [userProblemState.userId, userProblemState.problemId],
        set: { gaveUpAt: sql`coalesce(${userProblemState.gaveUpAt}, now())` },
      });
  }
  return getEditorial(db, userId, slug);
}

// ---------------------------------------------------------------- self-rating

export async function rateSolve(
  db: Db,
  userId: string,
  slug: string,
  rating: SolveRating,
): Promise<{ rating: SolveRating }> {
  const problem = await findVisibleProblem(db, slug);
  const updated = await db
    .update(userProblemState)
    .set({ solveRating: rating })
    .where(
      and(
        eq(userProblemState.userId, userId),
        eq(userProblemState.problemId, problem.id),
        eq(userProblemState.status, "solved"),
      ),
    )
    .returning({ id: userProblemState.problemId });
  if (updated.length === 0) {
    throw new AppError("NOT_SOLVED", 403, "Solve the problem before rating it.");
  }
  return { rating };
}

/** Records the moment a problem was first opened: hint and give-up cooldowns count from here. */
export async function markSeen(db: Db, userId: string, problemId: string): Promise<void> {
  await db
    .insert(userProblemState)
    .values({ userId, problemId, firstSeenAt: new Date() })
    .onConflictDoUpdate({
      target: [userProblemState.userId, userProblemState.problemId],
      set: { firstSeenAt: new Date() },
      setWhere: sql`${userProblemState.firstSeenAt} IS NULL`,
    });
}
