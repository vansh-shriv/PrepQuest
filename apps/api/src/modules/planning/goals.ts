import { and, desc, eq, gte, sql } from "drizzle-orm";
import { dailyGoals, goalTemplates, newId, profiles, xpEvents, type Database } from "@prepquest/db";
import {
  addDays,
  evaluateGoals,
  GOAL_COMPLETION_XP,
  GOAL_LABEL,
  GOAL_PRESETS,
  goalsComplete,
  levelFor,
  localDay,
  normalizeGoals,
  suggestGoalChange,
  type GoalItem,
  type GoalPreset,
} from "@prepquest/analytics-core";
import {
  AppError,
  type GoalProgressDto,
  type GoalsTodayResponse,
  type GoalTemplateInput,
  type GoalTemplateResponse,
  type NextActionDto,
  type QuestBoardResponse,
} from "@prepquest/shared";
import type { AiContext } from "../ai-context.js";
import { getReadiness, nextActions } from "../analytics/service.js";
import { importanceFor, loadLearner, masteriesFor } from "../analytics/learner.js";
import { getReviews } from "../reviews/service.js";
import { todaysTasks } from "./plan-service.js";

const DEFAULT_PRESET: GoalPreset = "standard";

export function presetCatalog(): GoalTemplateResponse["presets"] {
  return (Object.keys(GOAL_PRESETS) as GoalPreset[]).map((key) => ({
    key,
    label: GOAL_PRESETS[key].label,
    minutes: GOAL_PRESETS[key].minutes,
    items: GOAL_PRESETS[key].items,
  }));
}

export async function getTemplate(db: Database, userId: string): Promise<GoalTemplateResponse> {
  const [row] = await db.select().from(goalTemplates).where(eq(goalTemplates.userId, userId));
  return {
    preset: row?.preset ?? DEFAULT_PRESET,
    items: (row?.items as GoalItem[] | undefined) ?? GOAL_PRESETS[DEFAULT_PRESET].items,
    presets: presetCatalog(),
  };
}

export async function putTemplate(
  db: Database,
  userId: string,
  input: GoalTemplateInput,
): Promise<GoalTemplateResponse> {
  const preset = input.preset ?? "custom";
  const items =
    input.items && (preset === "custom" || input.items.length > 0)
      ? normalizeGoals(input.items)
      : normalizeGoals(
          GOAL_PRESETS[preset as GoalPreset]?.items ?? GOAL_PRESETS[DEFAULT_PRESET].items,
        );
  // choosing a preset by name uses its items; sending items makes it custom
  const effective = input.items ? "custom" : preset;
  await db
    .insert(goalTemplates)
    .values({ userId, preset: effective, items })
    .onConflictDoUpdate({ target: goalTemplates.userId, set: { preset: effective, items } });
  return getTemplate(db, userId);
}

async function facts(
  ai: AiContext,
  userId: string,
  tz: string,
  today: string,
  planTasks: { done: number; total: number },
) {
  const db = ai.db;
  const weekStartDay = addDays(
    today,
    -((new Date(Date.parse(`${today}T00:00:00Z`)).getUTCDay() + 6) % 7),
  );
  const row = (
    await db.execute(sql`
      SELECT
        (SELECT count(*) FROM user_problem_state ups
          WHERE ups.user_id = ${userId} AND ups.status = 'solved'
            AND (ups.first_ac_at AT TIME ZONE ${tz})::date = ${today}::date)::int AS problems,
        (SELECT COALESCE(sum(delta), 0) FROM xp_events
          WHERE user_id = ${userId} AND reason <> 'daily_goal'
            AND (at AT TIME ZONE ${tz})::date = ${today}::date)::int AS xp,
        (SELECT count(*) FROM interview_sessions
          WHERE user_id = ${userId} AND ended_at IS NOT NULL AND COALESCE(end_reason, '') <> 'abandoned'
            AND (ended_at AT TIME ZONE ${tz})::date >= ${weekStartDay}::date)::int AS interviews`)
  ).rows[0] as { problems: number; xp: number; interviews: number };
  return {
    problemsToday: row.problems,
    xpToday: row.xp,
    interviewsThisWeek: row.interviews,
    planTasksDone: planTasks.done,
    planTasksTotal: planTasks.total,
  };
}

async function todayRow(ai: AiContext, userId: string, today: string) {
  const [row] = await ai.db
    .select()
    .from(dailyGoals)
    .where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.goalDate, today)));
  if (row) return row;
  const tpl = await getTemplate(ai.db, userId);
  const [created] = await ai.db
    .insert(dailyGoals)
    .values({ id: newId(), userId, goalDate: today, items: tpl.items })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await ai.db
    .select()
    .from(dailyGoals)
    .where(and(eq(dailyGoals.userId, userId), eq(dailyGoals.goalDate, today)));
  return again!;
}

/** Pays the daily-goal bonus once, atomically. Returns the XP paid (0 if it was paid before). */
async function reward(ai: AiContext, userId: string, goalId: string): Promise<number> {
  return ai.db.transaction(async (tx) => {
    const claimed = await tx
      .update(dailyGoals)
      .set({ rewarded: true, completed: true })
      .where(and(eq(dailyGoals.id, goalId), eq(dailyGoals.rewarded, false)))
      .returning({ id: dailyGoals.id });
    if (claimed.length === 0) return 0;
    const [p] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).for("update");
    if (!p) return 0;
    const xp = p.xp + GOAL_COMPLETION_XP;
    await tx
      .update(profiles)
      .set({ xp, level: Math.max(p.level, levelFor(xp).level) })
      .where(eq(profiles.userId, userId));
    await tx.insert(xpEvents).values({
      userId,
      delta: GOAL_COMPLETION_XP,
      reason: "daily_goal",
      refType: "daily_goal",
      refId: goalId,
      at: ai.now(),
    });
    return GOAL_COMPLETION_XP;
  });
}

export async function getToday(ai: AiContext, userId: string): Promise<GoalsTodayResponse> {
  const [p] = await ai.db
    .select({ tz: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  const tz = p?.tz ?? "UTC";
  const today = localDay(ai.now(), tz);
  const row = await todayRow(ai, userId, today);
  const plan = await todaysTasks(ai, userId);
  const done = plan.tasks.filter((t) => t.status === "done").length;
  const progress = evaluateGoals(
    row.items as GoalItem[],
    await facts(ai, userId, tz, today, { done, total: plan.tasks.length }),
  );
  const completed = goalsComplete(progress);
  let paid = 0;
  if (completed && !row.rewarded) paid = await reward(ai, userId, row.id);
  const since = addDays(today, -14);
  const past = await ai.db
    .select({ date: dailyGoals.goalDate, completed: dailyGoals.completed })
    .from(dailyGoals)
    .where(and(eq(dailyGoals.userId, userId), gte(dailyGoals.goalDate, since)))
    .orderBy(desc(dailyGoals.goalDate));
  return {
    date: today,
    preset: (await getTemplate(ai.db, userId)).preset,
    items: progress.map((g): GoalProgressDto => ({
      type: g.type,
      label: GOAL_LABEL[g.type],
      target: g.target,
      progress: g.progress,
      done: g.done,
    })),
    completed: completed || row.completed,
    rewardXp: paid || (row.rewarded ? GOAL_COMPLETION_XP : 0),
    suggestion: suggestGoalChange(
      past.filter((d) => d.date < today).map((d) => ({ date: d.date, completed: d.completed })),
    ),
  };
}

export async function patchToday(
  ai: AiContext,
  userId: string,
  items: GoalItem[],
): Promise<GoalsTodayResponse> {
  const [p] = await ai.db
    .select({ tz: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  const today = localDay(ai.now(), p?.tz ?? "UTC");
  const row = await todayRow(ai, userId, today);
  if (row.rewarded) {
    throw new AppError(
      "CONFLICT",
      409,
      "You already completed today's goal. Changes apply from tomorrow.",
    );
  }
  await ai.db
    .update(dailyGoals)
    .set({ items: normalizeGoals(items) })
    .where(eq(dailyGoals.id, row.id));
  return getToday(ai, userId);
}

/** The dashboard's "today's quest board": goals, today's plan tasks, readiness and one next action. */
export async function questBoard(ai: AiContext, userId: string): Promise<QuestBoardResponse> {
  const goals = await getToday(ai, userId);
  const plan = await todaysTasks(ai, userId);
  const readiness = await getReadiness(ai.db, userId, undefined, ai.now());
  const l = await loadLearner(ai.db, userId, ai.now());
  const masteries = masteriesFor(l, importanceFor(null));
  const open = plan.tasks.find((t) => t.status === "todo");
  const rev = await getReviews(ai.db, userId, ai.now());
  const next: NextActionDto | null =
    rev.due.length > 0
      ? {
          kind: "review",
          title: `Review ${rev.due.length} problem${rev.due.length === 1 ? "" : "s"}`,
          href: "/reviews",
          why: "Spaced reviews keep what you solved from fading. It takes a few minutes.",
        }
      : open
        ? {
            kind: (open.kind === "mock" ? "interview" : "problem") as "interview" | "problem",
            title: open.title,
            href: open.href ?? "/plan",
            why: open.why,
          }
        : (nextActions(l, masteries, 1)[0] ?? null);
  return {
    goals,
    tasks: plan.tasks,
    hasPlan: plan.hasPlan,
    readiness: {
      score: readiness.score,
      band: readiness.band,
      label: readiness.label,
      needsDiagnostic: readiness.needsDiagnostic,
    },
    reviews: { due: rev.due.length, waiting: rev.waiting, cap: rev.cap, doneToday: rev.doneToday },
    next,
  };
}
