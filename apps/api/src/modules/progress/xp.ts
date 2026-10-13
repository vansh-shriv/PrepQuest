import { eq, sql } from "drizzle-orm";
import { activityDays, profiles, xpEvents, type Db } from "@prepquest/db";
import { levelFor, localDay } from "@prepquest/analytics-core";

/**
 * Pays XP and records a day of activity, inside the caller's transaction. Used by the SQL runner and the
 * assessments; problems and quizzes keep their own paths. Does nothing for a user without a profile.
 */
export async function grantXp(
  tx: Db,
  userId: string,
  opts: {
    xp: number;
    reason: string;
    refType: string;
    refId: string;
    now: Date;
    activity: "problems" | "quizzes";
  },
): Promise<void> {
  const [p] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).for("update");
  if (!p) return;
  if (opts.xp > 0) {
    const total = p.xp + opts.xp;
    await tx
      .update(profiles)
      .set({ xp: total, level: Math.max(p.level, levelFor(total).level) })
      .where(eq(profiles.userId, userId));
    await tx.insert(xpEvents).values({
      userId,
      delta: opts.xp,
      reason: opts.reason,
      refType: opts.refType,
      refId: opts.refId,
      at: opts.now,
    });
  }
  const day = localDay(opts.now, p.timezone);
  const col = opts.activity === "problems" ? activityDays.problems : activityDays.quizzes;
  await tx
    .insert(activityDays)
    .values({ userId, day, [opts.activity]: 1 })
    .onConflictDoUpdate({
      target: [activityDays.userId, activityDays.day],
      set: { [opts.activity]: sql`${col} + 1` },
    });
}
