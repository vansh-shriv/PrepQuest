import { and, asc, desc, eq, sql } from "drizzle-orm";
import { newId, planDiffs, planTasks, profiles, studyPlans, type Database } from "@prepquest/db";
import {
  addDays,
  adaptEfficiency,
  DEFAULT_INPUTS,
  generatePlan,
  localDay,
  weakAreas,
  WEEKDAYS,
  type GeneratedPlan,
  type PhaseName,
  type PlanContext,
  type PlanInputs,
  type PlanProblem,
  type PlanTask,
  type TaskKind,
  type WeekdayKey,
} from "@prepquest/analytics-core";
import type { PackStyle } from "@prepquest/interview-core";
import {
  AppError,
  type CustomTaskInput,
  type GeneratePlanInput,
  type PatchPlanTaskInput,
  type PlanDiffDto,
  type PlanDto,
  type PlanTaskDto,
} from "@prepquest/shared";
import type { AiContext } from "../ai-context.js";
import {
  importanceFor,
  loadLearner,
  loadPack,
  masteriesFor,
  topicName,
  type Learner,
} from "../analytics/learner.js";

type PlanRow = typeof studyPlans.$inferSelect;
type TaskRow = typeof planTasks.$inferSelect;

// --- stored shape <-> planner shape ---------------------------------------------------------------

type StoredInputs = Omit<PlanInputs, "startDate">;

export function toCoreTask(r: TaskRow): PlanTask {
  return {
    id: r.id,
    key: r.key,
    kind: r.kind as TaskKind,
    refType: (r.refType as PlanTask["refType"]) ?? null,
    ref: r.ref,
    title: r.title,
    estMinutes: r.estMinutes,
    date: r.plannedDate,
    why: r.why,
    status: r.status as PlanTask["status"],
    // the planner never drops or moves what the user added themselves
    locked: r.locked || r.custom,
    phase: r.phase as PhaseName,
    topic: r.topic,
  };
}

const hrefFor = (kind: string, ref: string | null): string | null =>
  !ref
    ? null
    : kind === "problem" || kind === "review"
      ? `/problems/${ref}`
      : kind === "mock"
        ? `/interview/new?type=${ref}`
        : null;

function taskDto(r: TaskRow): PlanTaskDto {
  return {
    id: r.id,
    date: r.plannedDate,
    kind: r.kind,
    refType: r.refType,
    ref: r.ref,
    title: r.title,
    estMinutes: r.estMinutes,
    status: r.status as PlanTaskDto["status"],
    locked: r.locked,
    custom: r.custom,
    why: r.why,
    phase: r.phase,
    topic: r.topic,
    href: hrefFor(r.kind, r.ref),
  };
}

async function activePlan(db: Database, userId: string) {
  const [plan] = await db
    .select()
    .from(studyPlans)
    .where(and(eq(studyPlans.userId, userId), eq(studyPlans.active, true)));
  if (!plan) return null;
  const tasks = await db
    .select()
    .from(planTasks)
    .where(eq(planTasks.planId, plan.id))
    .orderBy(asc(planTasks.plannedDate), asc(planTasks.createdAt), asc(planTasks.key));
  return { plan, tasks };
}

async function lastDiff(db: Database, planId: string) {
  const [d] = await db
    .select()
    .from(planDiffs)
    .where(eq(planDiffs.planId, planId))
    .orderBy(desc(planDiffs.toVersion))
    .limit(1);
  return d ?? null;
}

async function toPlanDto(
  db: Database,
  plan: PlanRow,
  tasks: TaskRow[],
  today: string,
): Promise<PlanDto> {
  const inputs = plan.inputs as StoredInputs;
  tasks = tasks.filter((t) => t.status !== "moved");
  const minutesPerDay: Record<string, number> = {};
  for (const t of tasks) {
    if (t.status !== "skipped")
      minutesPerDay[t.plannedDate] = (minutesPerDay[t.plannedDate] ?? 0) + t.estMinutes;
  }
  const d = await lastDiff(db, plan.id);
  return {
    id: plan.id,
    version: plan.version,
    target: plan.targetKey,
    placementDate: plan.placementDate,
    inputs: {
      hoursPerDay: inputs.hoursPerDay as Record<string, number>,
      defaultHours: inputs.defaultHours,
      restDays: inputs.restDays,
      mockPerWeek: inputs.mockPerWeek,
      efficiency: inputs.efficiency,
      mockTypes: inputs.mockTypes,
    },
    phases: plan.phases as PlanDto["phases"],
    warnings: plan.warnings as string[],
    narrativeMd: plan.narrativeMd,
    tasks: tasks.map(taskDto),
    minutesPerDay,
    today,
    lastDiff: d
      ? {
          ...(d.diff as PlanDiffDto),
          reason: d.reason,
          fromVersion: d.fromVersion,
          toVersion: d.toVersion,
          at: d.createdAt.toISOString(),
        }
      : null,
  };
}

// --- inputs -----------------------------------------------------------------------------------------

async function hasReadyResume(db: Database, userId: string): Promise<boolean> {
  const r = await db.execute(
    sql`SELECT 1 FROM resumes WHERE user_id = ${userId} AND status = 'ready' LIMIT 1`,
  );
  return r.rows.length > 0;
}

function profileHours(hours: Record<string, number> | null): Partial<Record<WeekdayKey, number>> {
  const out: Partial<Record<WeekdayKey, number>> = {};
  for (const [k, v] of Object.entries(hours ?? {})) {
    if ((WEEKDAYS as readonly string[]).includes(k) && typeof v === "number")
      out[k as WeekdayKey] = v;
  }
  return out;
}

export async function buildInputs(
  db: Database,
  l: Learner,
  stored: StoredInputs | null,
  body: GeneratePlanInput | undefined,
  packSlug: string | null,
): Promise<StoredInputs> {
  const fromProfile = profileHours(l.profile.hoursPerDay);
  const hasProfileHours = Object.keys(fromProfile).length > 0;
  const mockTypes = new Set(body?.mockTypes ?? stored?.mockTypes ?? DEFAULT_INPUTS.mockTypes);
  // resume-based rounds need a confirmed resume
  if (!(await hasReadyResume(db, l.userId))) {
    mockTypes.delete("project");
    mockTypes.delete("resume");
  } else if (!body?.mockTypes && !stored) {
    mockTypes.add("project");
  }
  return {
    placementDate:
      body?.placementDate !== undefined
        ? body.placementDate
        : (l.profile.placementDate ?? stored?.placementDate ?? null),
    // precedence: this request, then the saved plan, then the profile
    hoursPerDay: body?.hoursPerDay ?? stored?.hoursPerDay ?? fromProfile,
    defaultHours:
      body?.defaultHours ??
      (body?.hoursPerDay && Object.keys(body.hoursPerDay).length > 0
        ? 0
        : stored
          ? stored.defaultHours
          : hasProfileHours
            ? 0
            : DEFAULT_INPUTS.defaultHours),
    restDays: (body?.restDays ?? stored?.restDays ?? []) as WeekdayKey[],
    efficiency: stored?.efficiency ?? DEFAULT_INPUTS.efficiency,
    mockPerWeek: body?.mockPerWeek ?? stored?.mockPerWeek ?? DEFAULT_INPUTS.mockPerWeek,
    mockTypes: [...mockTypes],
    packSlug,
  };
}

export function buildContext(l: Learner, pack: PackStyle | null): PlanContext {
  const importance = importanceFor(pack);
  const masteries = masteriesFor(l, importance);
  const problems: PlanProblem[] = l.rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty,
    topics: l.topics.get(r.problem_id) ?? [],
    solved: r.solved,
    shaky: r.solved && (r.hinted || !r.first_try),
    lastAt: r.last_at ? new Date(r.last_at) : null,
  }));
  return { masteries, problems, importance, topicName: topicName(l), now: l.now };
}

/** A short plain-language summary of the plan. Deterministic: the language model is not needed to schedule or to explain. */
export function describePlan(
  plan: GeneratedPlan,
  ctx: PlanContext,
  placement: string | null,
): string {
  const weak = weakAreas(ctx.masteries)
    .slice(0, 3)
    .map((m) => ctx.topicName(m.topic));
  const fresh = ctx.masteries.filter((m) => m.attempted === 0).length;
  const parts: string[] = [];
  parts.push(
    placement
      ? `This plan runs from ${plan.from} to ${plan.until}, ahead of your ${placement} date.`
      : `This plan covers the next eight weeks (${plan.from} to ${plan.until}). Add a placement date to shape it backwards from the day.`,
  );
  if (plan.phases.length > 0) {
    parts.push(
      `It moves through ${plan.phases.map((p) => `${p.label} (${p.start} to ${p.end})`).join(", ")}.`,
    );
  }
  if (weak.length > 0) {
    parts.push(`First focus: ${weak.join(", ")}, your weakest topics so far.`);
  } else if (fresh > 0) {
    parts.push(
      "You have little history yet, so it starts with the fundamentals and learns from what you do.",
    );
  }
  parts.push(
    "Every task says why it is there. Move, skip or lock any of them; locked tasks stay put when the plan updates each night.",
  );
  return parts.join(" ");
}

// --- reconcile: mark tasks done from what the user actually did ---------------------------------------

export async function reconcilePlan(db: Database, userId: string): Promise<void> {
  const found = await activePlan(db, userId);
  if (!found) return;
  const open = found.tasks.filter((t) => t.status === "todo" && !t.custom);
  if (open.length === 0) return;

  const solved = (
    await db.execute(sql`
      SELECT p.slug, ups.first_ac_at FROM user_problem_state ups JOIN problems p ON p.id = ups.problem_id
      WHERE ups.user_id = ${userId} AND ups.status = 'solved' AND ups.first_ac_at IS NOT NULL`)
  ).rows as unknown as Array<{ slug: string; first_ac_at: Date }>;
  const solvedAt = new Map(solved.map((s) => [s.slug, new Date(s.first_ac_at)]));
  const accepts = (
    await db.execute(sql`
      SELECT p.slug, s.created_at FROM submissions s JOIN problems p ON p.id = s.problem_id
      WHERE s.user_id = ${userId} AND s.kind = 'submit' AND s.verdict = 'AC'
      ORDER BY s.created_at`)
  ).rows as unknown as Array<{ slug: string; created_at: Date }>;
  const sessions = (
    await db.execute(sql`
      SELECT id, type, ended_at FROM interview_sessions
      WHERE user_id = ${userId} AND ended_at IS NOT NULL AND COALESCE(end_reason, '') <> 'abandoned'
      ORDER BY ended_at`)
  ).rows as unknown as Array<{ id: string; type: string; ended_at: Date }>;
  const usedSessions = new Set<string>();

  for (const t of open.sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))) {
    let doneAt: Date | null = null;
    if (t.kind === "problem" && t.ref) {
      doneAt = solvedAt.get(t.ref) ?? null;
    } else if (t.kind === "review" && t.ref) {
      const hit = accepts.find((a) => a.slug === t.ref && new Date(a.created_at) >= t.createdAt);
      doneAt = hit ? new Date(hit.created_at) : null;
    } else if (t.kind === "mock" && t.ref) {
      const hit = sessions.find(
        (s) => s.type === t.ref && !usedSessions.has(s.id) && new Date(s.ended_at) >= t.createdAt,
      );
      if (hit) {
        usedSessions.add(hit.id);
        doneAt = new Date(hit.ended_at);
      }
    }
    if (doneAt) {
      await db
        .update(planTasks)
        .set({ status: "done", completedAt: doneAt })
        .where(eq(planTasks.id, t.id));
    }
  }
}

// --- persistence ---------------------------------------------------------------------------------------

async function persist(
  db: Database,
  userId: string,
  existing: { plan: PlanRow; tasks: TaskRow[] } | null,
  inputs: StoredInputs,
  targetKey: string,
  gen: GeneratedPlan,
  narrative: string,
  reason: string,
  today: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    let planId: string;
    let fromVersion = 0;
    let toVersion = 1;
    const values = {
      targetKey,
      placementDate: inputs.placementDate,
      inputs,
      phases: gen.phases,
      warnings: gen.warnings,
      narrativeMd: narrative,
      replannedOn: today,
    };
    if (existing) {
      planId = existing.plan.id;
      fromVersion = existing.plan.version;
      toVersion = fromVersion + 1;
      await tx
        .update(studyPlans)
        .set({ ...values, version: toVersion })
        .where(eq(studyPlans.id, planId));
    } else {
      planId = newId();
      await tx
        .insert(studyPlans)
        .values({ id: planId, userId, ...values, version: 1, active: true });
    }

    // missed tasks stay behind as history ("moved"), so the planned-versus-done record is honest
    const byKey = new Map<string, TaskRow>();
    for (const row of existing?.tasks ?? []) {
      if (row.status === "moved") continue;
      if (row.status === "todo" && !row.custom && row.plannedDate < today) {
        await tx
          .update(planTasks)
          .set({ status: "moved", key: `${row.key}#v${toVersion}` })
          .where(eq(planTasks.id, row.id));
        continue;
      }
      byKey.set(row.key, row);
    }
    const seen = new Set<string>();
    for (const t of gen.tasks) {
      if (seen.has(t.key)) continue;
      seen.add(t.key);
      const row = byKey.get(t.key);
      const fields = {
        plannedDate: t.date,
        kind: t.kind,
        refType: t.refType,
        ref: t.ref,
        title: t.title,
        estMinutes: t.estMinutes,
        status: t.status === "moved" ? "todo" : t.status,
        locked: row?.custom ? row.locked : t.locked,
        why: t.why,
        phase: t.phase,
        topic: t.topic ?? null,
      };
      if (row) {
        await tx.update(planTasks).set(fields).where(eq(planTasks.id, row.id));
      } else {
        await tx
          .insert(planTasks)
          .values({ id: newId(), planId, key: t.key, custom: false, ...fields });
      }
    }
    for (const row of byKey.values()) {
      if (!seen.has(row.key)) await tx.delete(planTasks).where(eq(planTasks.id, row.id));
    }
    await tx.insert(planDiffs).values({
      id: newId(),
      planId,
      fromVersion,
      toVersion,
      reason,
      diff: gen.diff,
    });
    return planId;
  });
}

async function run(
  ai: AiContext,
  userId: string,
  body: GeneratePlanInput | undefined,
  reason: "generate" | "manual" | "nightly" | "edit",
  efficiencyOverride?: number,
): Promise<PlanDto> {
  const db = ai.db;
  const now = ai.now();
  await reconcilePlan(db, userId);
  const existing = await activePlan(db, userId);
  if (reason !== "generate" && !existing)
    throw new AppError("NOT_FOUND", 404, "You don't have a plan yet");
  const l = await loadLearner(db, userId, now);
  const stored = (existing?.plan.inputs as StoredInputs | undefined) ?? null;
  const packSlug =
    body && "packSlug" in body ? (body.packSlug ?? null) : (stored?.packSlug ?? null);
  const packRow = await loadPack(db, userId, packSlug);
  if (packSlug && !packRow)
    throw new AppError("VALIDATION_FAILED", 422, "That company pack doesn't exist");
  const inputs = await buildInputs(db, l, stored, body, packRow?.slug ?? null);
  if (efficiencyOverride !== undefined) inputs.efficiency = efficiencyOverride;
  const ctx = buildContext(l, (packRow?.data as PackStyle | undefined) ?? null);
  const gen = generatePlan(
    ctx,
    { ...inputs, startDate: l.today },
    (existing?.tasks ?? []).filter((t) => t.status !== "moved").map(toCoreTask),
    l.today,
  );
  await persist(
    db,
    userId,
    existing,
    inputs,
    packRow?.slug ?? "general",
    gen,
    describePlan(gen, ctx, inputs.placementDate),
    reason,
    l.today,
  );
  const fresh = (await activePlan(db, userId))!;
  return toPlanDto(db, fresh.plan, fresh.tasks, l.today);
}

// --- public API ----------------------------------------------------------------------------------------

export async function getPlan(ai: AiContext, userId: string): Promise<PlanDto | null> {
  await reconcilePlan(ai.db, userId);
  const found = await activePlan(ai.db, userId);
  if (!found) return null;
  const tz = await timezoneOf(ai.db, userId);
  return toPlanDto(ai.db, found.plan, found.tasks, localDay(ai.now(), tz));
}

async function timezoneOf(db: Database, userId: string): Promise<string> {
  const [p] = await db
    .select({ tz: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  return p?.tz ?? "UTC";
}

export const generateUserPlan = (ai: AiContext, userId: string, body: GeneratePlanInput) =>
  run(ai, userId, body, "generate");

export const replanUser = (
  ai: AiContext,
  userId: string,
  reason: "manual" | "nightly" = "manual",
) => run(ai, userId, undefined, reason);

export async function patchTask(
  ai: AiContext,
  userId: string,
  taskId: string,
  patch: PatchPlanTaskInput,
): Promise<PlanTaskDto> {
  const found = await activePlan(ai.db, userId);
  const row = found?.tasks.find((t) => t.id === taskId);
  if (!found || !row) throw new AppError("NOT_FOUND", 404, "That task doesn't exist");
  const today = localDay(ai.now(), await timezoneOf(ai.db, userId));
  if (patch.date !== undefined) {
    if (patch.date < today)
      throw new AppError("VALIDATION_FAILED", 422, "Pick today or a later day");
    const inputs = found.plan.inputs as StoredInputs;
    const used = found.tasks
      .filter((t) => t.plannedDate === patch.date && t.id !== row.id && t.status !== "skipped")
      .reduce((a, t) => a + t.estMinutes, 0);
    const weekday = WEEKDAYS[new Date(Date.parse(`${patch.date}T00:00:00Z`)).getUTCDay()]!;
    const cap = inputs.restDays.includes(weekday)
      ? 0
      : Math.floor((inputs.hoursPerDay[weekday] ?? inputs.defaultHours) * 60 * inputs.efficiency);
    if (used + row.estMinutes > cap) {
      // the user may overrule the plan, but is told: moving never silently overbooks a day
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        `That day only has ${Math.max(0, cap - used)} free minutes and this task needs ${row.estMinutes}.`,
      );
    }
  }
  const [updated] = await ai.db
    .update(planTasks)
    .set({
      ...(patch.status !== undefined
        ? { status: patch.status, completedAt: patch.status === "done" ? ai.now() : null }
        : {}),
      ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
      ...(patch.date !== undefined
        ? { plannedDate: patch.date, status: patch.status ?? "todo" }
        : {}),
    })
    .where(eq(planTasks.id, taskId))
    .returning();
  return taskDto(updated!);
}

export async function addCustomTask(
  ai: AiContext,
  userId: string,
  input: CustomTaskInput,
): Promise<PlanTaskDto> {
  const found = await activePlan(ai.db, userId);
  if (!found) throw new AppError("NOT_FOUND", 404, "You don't have a plan yet");
  const today = localDay(ai.now(), await timezoneOf(ai.db, userId));
  if (input.date < today) throw new AppError("VALIDATION_FAILED", 422, "Pick today or a later day");
  const [row] = await ai.db
    .insert(planTasks)
    .values({
      id: newId(),
      planId: found.plan.id,
      key: `custom:${newId()}`,
      plannedDate: input.date,
      kind: "reading",
      title: input.title,
      estMinutes: input.estMinutes,
      locked: true,
      custom: true,
      why: "Added by you.",
      phase: "pattern_mastery",
    })
    .returning();
  return taskDto(row!);
}

export async function getPlanDiff(
  db: Database,
  userId: string,
  from?: number,
  to?: number,
): Promise<NonNullable<PlanDto["lastDiff"]>> {
  const found = await activePlan(db, userId);
  if (!found) throw new AppError("NOT_FOUND", 404, "You don't have a plan yet");
  const [d] = await db
    .select()
    .from(planDiffs)
    .where(
      and(
        eq(planDiffs.planId, found.plan.id),
        ...(to !== undefined ? [eq(planDiffs.toVersion, to)] : []),
        ...(from !== undefined ? [eq(planDiffs.fromVersion, from)] : []),
      ),
    )
    .orderBy(desc(planDiffs.toVersion))
    .limit(1);
  if (!d) throw new AppError("NOT_FOUND", 404, "No such plan change");
  return {
    ...(d.diff as PlanDiffDto),
    reason: d.reason,
    fromVersion: d.fromVersion,
    toVersion: d.toVersion,
    at: d.createdAt.toISOString(),
  };
}

/** Today's open and finished tasks, for the quest board. */
export async function todaysTasks(
  ai: AiContext,
  userId: string,
): Promise<{ tasks: PlanTaskDto[]; hasPlan: boolean }> {
  await reconcilePlan(ai.db, userId);
  const found = await activePlan(ai.db, userId);
  if (!found) return { tasks: [], hasPlan: false };
  const today = localDay(ai.now(), await timezoneOf(ai.db, userId));
  return {
    tasks: found.tasks
      .filter((t) => t.plannedDate === today && t.status !== "skipped")
      .map(taskDto),
    hasPlan: true,
  };
}

// --- nightly job -----------------------------------------------------------------------------------------

/**
 * Once per local day per user with an active plan: adapt the efficiency from the past week, re-plan
 * (missed tasks roll forward, locked ones stay) and take the readiness snapshot. Returns how many plans ran.
 */
export async function nightlyPlanning(ai: AiContext, limit = 20): Promise<number> {
  const now = ai.now();
  const due = (
    await ai.db.execute(sql`
      SELECT sp.user_id, sp.target_key, sp.inputs, sp.id
      FROM study_plans sp JOIN profiles p ON p.user_id = sp.user_id
      WHERE sp.active
        AND (sp.replanned_on IS NULL OR sp.replanned_on < (${now.toISOString()}::timestamptz AT TIME ZONE p.timezone)::date)
      ORDER BY sp.replanned_on NULLS FIRST
      LIMIT ${limit}`)
  ).rows as unknown as Array<{
    user_id: string;
    target_key: string;
    inputs: StoredInputs;
    id: string;
  }>;
  let n = 0;
  for (const row of due) {
    try {
      const weekAgo = addDays(localDay(now, await timezoneOf(ai.db, row.user_id)), -7);
      const stats = (
        await ai.db.execute(sql`
          SELECT COALESCE(sum(est_minutes) FILTER (WHERE status <> 'skipped'), 0)::int AS planned,
                 COALESCE(sum(est_minutes) FILTER (WHERE status = 'done'), 0)::int AS done
          FROM plan_tasks WHERE plan_id = ${row.id} AND planned_date >= ${weekAgo}::date
            AND planned_date < (${now.toISOString()}::timestamptz)::date`)
      ).rows[0] as { planned: number; done: number };
      const efficiency = adaptEfficiency(row.inputs.efficiency, stats.planned, stats.done);
      await run(ai, row.user_id, undefined, "nightly", efficiency);
      const { snapshotReadiness } = await import("../analytics/service.js");
      await snapshotReadiness(
        ai.db,
        row.user_id,
        row.target_key === "general" ? null : row.target_key,
        now,
      );
      n += 1;
    } catch (err) {
      ai.log.error({ err, userId: row.user_id }, "nightly planning failed");
      // do not retry in a tight loop: mark the day as handled
      await ai.db
        .update(studyPlans)
        .set({ replannedOn: addDays(localDay(now, "UTC"), 1) })
        .where(eq(studyPlans.id, row.id));
    }
  }
  return n;
}
