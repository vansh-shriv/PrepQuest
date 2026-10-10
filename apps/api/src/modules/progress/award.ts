import { eq, sql } from "drizzle-orm";
import { activityDays, badges, badgesEarned, profiles, xpEvents, type Db } from "@prepquest/db";
import {
  advanceStreak,
  BADGES,
  levelFor,
  localDay,
  newBadges,
  problemXp,
  STREAK_MILESTONE_XP,
  type DifficultyName,
} from "@prepquest/analytics-core";
import type { SolveRewards } from "@prepquest/shared";

/** Makes sure every badge the code knows about has a catalog row (badges_earned references it). */
export async function ensureBadgeCatalog(db: Db): Promise<void> {
  await db
    .insert(badges)
    .values(
      BADGES.map((b) => ({ id: b.id, name: b.name, description: b.description, sprite: b.sprite })),
    )
    .onConflictDoUpdate({
      target: badges.id,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        sprite: sql`excluded.sprite`,
      },
    });
}

export interface AcceptedSolve {
  userId: string;
  problemId: string;
  submissionId: string;
  difficulty: DifficultyName;
  /** This is the first time the user solved the problem (only then is XP earned). */
  firstSolve: boolean;
  firstTry: boolean;
  /** Highest hint tier viewed (an editorial given up on counts as 3). */
  hintTiers: number;
  now: Date;
}

/**
 * Applies everything an accepted submission earns: XP and level, the streak (and its milestone bonus),
 * the day's activity row and any new badges. Runs inside the judge-result transaction, so a redelivered
 * event can never award twice (the caller only gets here once per submission).
 */
export async function awardAccepted(tx: Db, a: AcceptedSolve): Promise<SolveRewards> {
  const [profile] = await tx
    .select()
    .from(profiles)
    .where(eq(profiles.userId, a.userId))
    .for("update");
  if (!profile) {
    return emptyRewards(a.firstSolve);
  }

  const today = localDay(a.now, profile.timezone);
  const streak = advanceStreak(
    {
      current: profile.streakCurrent,
      best: profile.streakBest,
      lastActive: profile.streakLastActive,
      freezes: profile.streakFreezes,
    },
    today,
  );

  const events: Array<{ delta: number; reason: string; refType: string; refId: string }> = [];
  const problemPoints = a.firstSolve
    ? problemXp({ difficulty: a.difficulty, firstTry: a.firstTry, hintTiers: a.hintTiers })
    : 0;
  if (problemPoints > 0) {
    events.push({
      delta: problemPoints,
      reason: "problem_ac",
      refType: "submission",
      refId: a.submissionId,
    });
  }
  const milestoneXp = streak.milestone ? (STREAK_MILESTONE_XP[streak.milestone] ?? 0) : 0;
  if (milestoneXp > 0) {
    events.push({
      delta: milestoneXp,
      reason: "streak_milestone",
      refType: "submission",
      refId: a.submissionId,
    });
  }

  const xpGained = problemPoints + milestoneXp;
  const xpAfter = profile.xp + xpGained;
  const levelBefore = profile.level;
  const levelAfter = levelFor(xpAfter).level;

  await tx
    .update(profiles)
    .set({
      xp: xpAfter,
      level: Math.max(levelBefore, levelAfter),
      streakCurrent: streak.state.current,
      streakBest: streak.state.best,
      streakLastActive: streak.state.lastActive,
      streakFreezes: streak.state.freezes,
    })
    .where(eq(profiles.userId, a.userId));

  if (events.length > 0) {
    await tx.insert(xpEvents).values(events.map((e) => ({ ...e, userId: a.userId, at: a.now })));
  }

  await tx
    .insert(activityDays)
    .values({ userId: a.userId, day: today, problems: 1 })
    .onConflictDoUpdate({
      target: [activityDays.userId, activityDays.day],
      set: { problems: sql`${activityDays.problems} + 1` },
    });

  // badges, judged on the numbers after this solve
  const [stats] = (
    await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE ups.status = 'solved')::int AS solved_total,
        count(*) FILTER (WHERE ups.status = 'solved' AND p.difficulty = 'hard')::int AS solved_hard,
        count(*) FILTER (WHERE ups.status = 'solved' AND ups.first_try_ac AND ups.hints_used = 0
                          AND ups.gave_up_at IS NULL)::int AS clean_solves,
        (SELECT count(DISTINCT s.language) FROM submissions s
          WHERE s.user_id = ${a.userId} AND s.kind = 'submit' AND s.verdict = 'AC')::int AS languages
      FROM user_problem_state ups
      JOIN problems p ON p.id = ups.problem_id
      WHERE ups.user_id = ${a.userId}`)
  ).rows as Array<{
    solved_total: number;
    solved_hard: number;
    clean_solves: number;
    languages: number;
  }>;
  const earned = new Set(
    (
      await tx
        .select({ id: badgesEarned.badgeId })
        .from(badgesEarned)
        .where(eq(badgesEarned.userId, a.userId))
    ).map((r) => r.id),
  );
  const fresh = newBadges(
    {
      solvedTotal: stats?.solved_total ?? 0,
      solvedHard: stats?.solved_hard ?? 0,
      cleanSolves: stats?.clean_solves ?? 0,
      bestStreak: streak.state.best,
      languagesAccepted: stats?.languages ?? 0,
    },
    earned,
  );
  if (fresh.length > 0) {
    await tx
      .insert(badgesEarned)
      .values(fresh.map((badgeId) => ({ userId: a.userId, badgeId, earnedAt: a.now })))
      .onConflictDoNothing();
  }

  return {
    firstSolve: a.firstSolve,
    xp: xpGained,
    problemXp: problemPoints,
    streakBonusXp: milestoneXp,
    levelBefore,
    levelAfter: Math.max(levelBefore, levelAfter),
    streak: {
      current: streak.state.current,
      best: streak.state.best,
      usedFreeze: streak.usedFreeze,
      milestone: streak.milestone,
    },
    badges: fresh,
  };
}

const emptyRewards = (firstSolve: boolean): SolveRewards => ({
  firstSolve,
  xp: 0,
  problemXp: 0,
  streakBonusXp: 0,
  levelBefore: 1,
  levelAfter: 1,
  streak: { current: 0, best: 0, usedFreeze: false, milestone: null },
  badges: [],
});
