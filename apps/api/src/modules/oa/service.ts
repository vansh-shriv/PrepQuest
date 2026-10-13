import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  aptitudeItems,
  newId,
  oaAttempts,
  oaTemplates,
  quizQuestions,
  type Database,
  type Db,
} from "@prepquest/db";
import {
  buildReport,
  closeAll,
  currentStep,
  gradeAnswer,
  newState,
  percentile,
  pickItems,
  saveAnswer,
  startSection,
  submitSection,
  syncClock,
  type KeyedItem,
  type OaReport,
  type OaSectionSpec,
  type OaState,
  type QuizType,
} from "@prepquest/analytics-core";
import {
  AppError,
  type OaAnswerInput,
  type OaAttemptDto,
  type OaAttemptSummary,
  type OaCatalogResponse,
  type OaItemDto,
  type OaReportDto,
  type OaReviewItemDto,
  type OaTemplateDto,
} from "@prepquest/shared";
import { grantXp } from "../progress/xp.js";

// Online assessments (C2). The server owns the paper, the section clocks and the answer key: a section's
// timer keeps running whether or not the browser is open, a finished section is locked, and the key only
// appears in the report.

type TemplateRow = typeof oaTemplates.$inferSelect;
type AttemptRow = typeof oaAttempts.$inferSelect;

/** An open attempt this old is closed by the next visit, so a forgotten test cannot block a new one. */
const STALE_MS = 24 * 3600 * 1000;
const OA_XP_CAP = 30;

const specs = (t: TemplateRow) => t.sections as OaSectionSpec[];

const toDto = (t: TemplateRow, attempts: number, best: number | null): OaTemplateDto => {
  const sections = specs(t);
  return {
    slug: t.slug,
    title: t.title,
    kind: t.kind as "oa" | "drill",
    description: t.description ?? "",
    negativeMarking: Number(t.negativeMarking),
    calculator: t.calculator,
    sections: sections.map((s) => ({
      key: s.key,
      title: s.title,
      count: s.count,
      minutes: s.minutes,
    })),
    totalMinutes: sections.reduce((a, s) => a + s.minutes, 0),
    totalQuestions: sections.reduce((a, s) => a + s.count, 0),
    attempts,
    bestPercent: best,
  };
};

const summary = (a: AttemptRow, t: TemplateRow): OaAttemptSummary => {
  const r = a.report as { percent?: number } | null;
  return {
    id: a.id,
    template: t.slug,
    title: t.title,
    startedAt: a.startedAt.toISOString(),
    finishedAt: a.finishedAt?.toISOString() ?? null,
    percent: r?.percent ?? null,
    marks: a.marks === null ? null : Number(a.marks),
    maxMarks: a.maxMarks,
  };
};

// Items --------------------------------------------------------------------------------------------------

interface Item extends KeyedItem {
  /** Where the item came from, for display. */
  section: string;
  body: string;
  options: Array<{ id: string; text: string }> | null;
  explanation: string;
  shortcut: string | null;
}

const TF_OPTIONS = [
  { id: "true", text: "True" },
  { id: "false", text: "False" },
];

async function loadItems(db: Db, ids: string[]): Promise<Map<string, Item>> {
  const out = new Map<string, Item>();
  if (ids.length === 0) return out;
  const apt = await db.select().from(aptitudeItems).where(inArray(aptitudeItems.id, ids));
  for (const a of apt)
    out.set(a.id, {
      id: a.id,
      topic: a.topic,
      type: a.type as "single" | "blank",
      answer: a.answer,
      section: a.section,
      body: a.bodyMd,
      options: a.options ?? null,
      explanation: a.explanationMd,
      shortcut: a.shortcutMd,
    });
  const quiz = await db.select().from(quizQuestions).where(inArray(quizQuestions.id, ids));
  for (const q of quiz)
    out.set(q.id, {
      id: q.id,
      topic: q.topic,
      type: q.type as QuizType,
      answer: q.answer,
      section: q.subject,
      body: q.bodyMd,
      options: q.type === "tf" ? TF_OPTIONS : (q.options ?? null),
      explanation: q.explanationMd,
      shortcut: q.interviewLine,
    });
  return out;
}

/** Responses travel as strings; grading wants true/false for tf and a list for multi. */
function parseResponse(type: string, raw: string): unknown {
  if (type === "tf") return raw === "true";
  if (type === "multi")
    return raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  return raw;
}
function formatResponse(type: string, stored: unknown): string {
  if (type === "tf") return stored === true ? "true" : "false";
  if (type === "multi" && Array.isArray(stored)) return stored.join(",");
  return typeof stored === "string" ? stored : "";
}

const itemDto = (it: Item): OaItemDto => ({
  id: it.id,
  topic: it.topic,
  type: it.type,
  body: it.body,
  options: it.options,
});

/** The correct answer written for a person. */
function displayAnswer(it: Item): string {
  const text = (id: string) => it.options?.find((o) => o.id === id)?.text ?? id;
  const a = it.answer;
  switch (it.type) {
    case "single":
      return typeof a === "string" ? text(a) : "";
    case "multi":
      return Array.isArray(a) ? a.map((x) => text(String(x))).join(", ") : "";
    case "tf":
      return a === true ? "True" : "False";
    default:
      return Array.isArray(a) ? String(a[0] ?? "") : String(a ?? "");
  }
}
function displayResponse(it: Item, stored: unknown): string | null {
  if (stored === undefined || stored === null) return null;
  const text = (id: string) => it.options?.find((o) => o.id === id)?.text ?? id;
  if (it.type === "single") return text(String(stored));
  if (it.type === "multi" && Array.isArray(stored))
    return stored.map((x) => text(String(x))).join(", ");
  if (it.type === "tf") return stored === true ? "True" : "False";
  return String(stored);
}

// Catalog and start --------------------------------------------------------------------------------------

export async function getCatalog(
  db: Database,
  userId: string,
  now: Date,
): Promise<OaCatalogResponse> {
  await sweep(db, userId, now);
  const templates = await db
    .select()
    .from(oaTemplates)
    .where(eq(oaTemplates.status, "published"))
    .orderBy(oaTemplates.kind, oaTemplates.title);
  const stats = (
    await db.execute(sql`
      SELECT template_id, count(*)::int AS n, max((report->>'percent')::int) AS best
      FROM oa_attempts WHERE user_id = ${userId} AND finished_at IS NOT NULL GROUP BY template_id`)
  ).rows as unknown as Array<{ template_id: string; n: number; best: number | null }>;
  const byTemplate = new Map(stats.map((s) => [s.template_id, s]));
  const mine = await db
    .select()
    .from(oaAttempts)
    .where(eq(oaAttempts.userId, userId))
    .orderBy(desc(oaAttempts.startedAt))
    .limit(8);
  const byId = new Map((await db.select().from(oaTemplates)).map((t) => [t.id, t]));
  const rows = mine.filter((a) => byId.has(a.templateId));
  const open = rows.find((a) => !a.finishedAt);
  return {
    templates: templates.map((t) =>
      toDto(t, byTemplate.get(t.id)?.n ?? 0, byTemplate.get(t.id)?.best ?? null),
    ),
    recent: rows.filter((a) => a.finishedAt).map((a) => summary(a, byId.get(a.templateId)!)),
    open: open ? summary(open, byId.get(open.templateId)!) : null,
  };
}

async function poolFor(
  db: Db,
  s: OaSectionSpec,
): Promise<Array<{ id: string; difficulty: number }>> {
  if (s.source === "aptitude") {
    return db
      .select({ id: aptitudeItems.id, difficulty: aptitudeItems.difficulty })
      .from(aptitudeItems)
      .where(and(eq(aptitudeItems.section, s.from), eq(aptitudeItems.status, "published")));
  }
  return db
    .select({ id: quizQuestions.id, difficulty: quizQuestions.difficulty })
    .from(quizQuestions)
    .where(and(eq(quizQuestions.subject, s.from), eq(quizQuestions.status, "published")));
}

export async function startAttempt(
  db: Database,
  userId: string,
  templateSlug: string,
  now: Date,
): Promise<OaAttemptDto> {
  await sweep(db, userId, now);
  const [t] = await db
    .select()
    .from(oaTemplates)
    .where(and(eq(oaTemplates.slug, templateSlug), eq(oaTemplates.status, "published")));
  if (!t) throw new AppError("NOT_FOUND", 404, "That test does not exist.");
  const [open] = await db
    .select({ id: oaAttempts.id })
    .from(oaAttempts)
    .where(and(eq(oaAttempts.userId, userId), isNull(oaAttempts.finishedAt)))
    .limit(1);
  if (open)
    throw new AppError("OA_OPEN", 409, "Finish the test you have open before starting another.", {
      attemptId: open.id,
    });
  const id = newId();
  const sections = [];
  for (const s of specs(t)) {
    const pool = await poolFor(db, s);
    if (pool.length < s.count)
      throw new AppError("OA_NOT_ENOUGH", 422, `Not enough questions for "${s.title}" yet.`);
    sections.push({ key: s.key, itemIds: pickItems(pool, s.count, `${id}:${s.key}`) });
  }
  const [row] = await db
    .insert(oaAttempts)
    .values({ id, userId, templateId: t.id, state: newState(sections), startedAt: now })
    .returning();
  return attemptDto(db, row!, t, now);
}

// Running ------------------------------------------------------------------------------------------------

async function own(
  db: Db,
  userId: string,
  id: string,
  lock = false,
): Promise<{ a: AttemptRow; t: TemplateRow }> {
  const q = db
    .select()
    .from(oaAttempts)
    .where(and(eq(oaAttempts.id, id), eq(oaAttempts.userId, userId)));
  const [a] = await (lock ? q.for("update") : q);
  if (!a) throw new AppError("NOT_FOUND", 404, "Test not found.");
  const [t] = await db.select().from(oaTemplates).where(eq(oaTemplates.id, a.templateId));
  return { a, t: t! };
}

const stateOf = (a: AttemptRow) => a.state as OaState;
const save = (db: Db, id: string, state: OaState) =>
  db.update(oaAttempts).set({ state }).where(eq(oaAttempts.id, id));

/** Closes finished or forgotten attempts so they get their report. */
async function sweep(db: Database, userId: string, now: Date): Promise<void> {
  const open = await db
    .select()
    .from(oaAttempts)
    .where(and(eq(oaAttempts.userId, userId), isNull(oaAttempts.finishedAt)));
  for (const a of open) {
    const state = syncClock(stateOf(a), now);
    const stale = now.getTime() - a.startedAt.getTime() > STALE_MS;
    if (stale || currentStep(state, now).kind === "finished") {
      await db.transaction(async (tx) => {
        const locked = await own(tx, userId, a.id, true);
        if (locked.a.finishedAt) return;
        await finalize(tx, locked.a, locked.t, stale ? closeAll(state, now) : state, now);
      });
    }
  }
}

export async function getAttempt(
  db: Database,
  userId: string,
  id: string,
  now: Date,
): Promise<OaAttemptDto> {
  let { a, t } = await own(db, userId, id);
  if (!a.finishedAt) {
    const synced = syncClock(stateOf(a), now);
    const stale = now.getTime() - a.startedAt.getTime() > STALE_MS;
    if (stale || currentStep(synced, now).kind === "finished") {
      await db.transaction(async (tx) => {
        const locked = await own(tx, userId, id, true);
        if (!locked.a.finishedAt)
          await finalize(tx, locked.a, locked.t, stale ? closeAll(synced, now) : synced, now);
      });
      ({ a, t } = await own(db, userId, id));
    } else if (JSON.stringify(synced) !== JSON.stringify(stateOf(a))) {
      await save(db, id, synced);
      a = { ...a, state: synced };
    }
  }
  return attemptDto(db, a, t, now);
}

export async function begin(
  db: Database,
  userId: string,
  id: string,
  index: number,
  now: Date,
): Promise<OaAttemptDto> {
  await db.transaction(async (tx) => {
    const { a, t } = await own(tx, userId, id, true);
    if (a.finishedAt) throw new AppError("OA_FINISHED", 409, "This test is finished.");
    const spec = specs(t)[index];
    if (!spec) throw new AppError("VALIDATION_ERROR", 422, "No such section.");
    const next = startSection(stateOf(a), index, spec.minutes, now);
    if ("error" in next)
      throw new AppError(
        "OA_ORDER",
        409,
        next.error === "RUNNING"
          ? "Finish the running section first."
          : "Sections run in order and cannot be reopened.",
      );
    await save(tx, id, next);
  });
  return getAttempt(db, userId, id, now);
}

export async function answer(
  db: Database,
  userId: string,
  id: string,
  input: OaAnswerInput,
  now: Date,
): Promise<{ saved: true; secondsLeft: number }> {
  return db.transaction(async (tx) => {
    const { a } = await own(tx, userId, id, true);
    if (a.finishedAt) throw new AppError("OA_FINISHED", 409, "This test is finished.");
    const items = await loadItems(tx, [input.itemId]);
    const it = items.get(input.itemId);
    const response =
      input.response === null || it === undefined ? null : parseResponse(it.type, input.response);
    const next = saveAnswer(stateOf(a), input.itemId, response, now);
    if ("error" in next) {
      // A late answer is refused, but the expiry is still recorded.
      await save(tx, id, syncClock(stateOf(a), now));
      throw new AppError(
        next.error === "UNKNOWN" ? "VALIDATION_ERROR" : "OA_SECTION_CLOSED",
        next.error === "UNKNOWN" ? 422 : 409,
        next.error === "UNKNOWN"
          ? "That question is not part of this test."
          : "Time is up for this section.",
      );
    }
    await save(tx, id, next);
    const step = currentStep(next, now);
    return { saved: true as const, secondsLeft: step.kind === "section" ? step.secondsLeft : 0 };
  });
}

export async function submitCurrent(
  db: Database,
  userId: string,
  id: string,
  now: Date,
): Promise<OaAttemptDto> {
  await db.transaction(async (tx) => {
    const { a, t } = await own(tx, userId, id, true);
    if (a.finishedAt) return;
    const next = submitSection(stateOf(a), now);
    if (currentStep(next, now).kind === "finished") await finalize(tx, a, t, next, now);
    else await save(tx, id, next);
  });
  return getAttempt(db, userId, id, now);
}

export async function finish(
  db: Database,
  userId: string,
  id: string,
  now: Date,
): Promise<OaAttemptDto> {
  await db.transaction(async (tx) => {
    const { a, t } = await own(tx, userId, id, true);
    if (a.finishedAt) return;
    await finalize(tx, a, t, closeAll(stateOf(a), now), now);
  });
  return getAttempt(db, userId, id, now);
}

// Report -------------------------------------------------------------------------------------------------

async function finalize(
  tx: Db,
  a: AttemptRow,
  t: TemplateRow,
  state: OaState,
  now: Date,
): Promise<void> {
  const ids = state.sections.flatMap((s) => s.itemIds);
  const items = await loadItems(tx, ids);
  const report = buildReport(state, items, Number(t.negativeMarking));
  const correct = report.sections.reduce((n, s) => n + s.correct, 0);
  const attempted = report.sections.reduce((n, s) => n + s.attempted, 0);
  const xp = attempted === 0 ? 0 : Math.min(OA_XP_CAP, Math.floor(correct / 2));
  await tx
    .update(oaAttempts)
    .set({
      state,
      report,
      finishedAt: now,
      marks: String(report.marks),
      maxMarks: report.maxMarks,
      xpAwarded: xp,
    })
    .where(eq(oaAttempts.id, a.id));
  if (attempted > 0) {
    await grantXp(tx, a.userId, {
      xp,
      reason: "assessment",
      refType: "oa_attempt",
      refId: a.id,
      now,
      activity: "quizzes",
    });
  }
}

async function benchmarks(db: Db, a: AttemptRow) {
  const rows = (
    await db.execute(sql`
      SELECT report FROM oa_attempts
      WHERE template_id = ${a.templateId} AND finished_at IS NOT NULL AND id <> ${a.id} AND report IS NOT NULL`)
  ).rows as unknown as Array<{ report: OaReport }>;
  return rows.map((r) => r.report);
}

async function reportDto(db: Db, a: AttemptRow, t: TemplateRow): Promise<OaReportDto> {
  const report = a.report as OaReport;
  const state = stateOf(a);
  const items = await loadItems(
    db,
    state.sections.flatMap((s) => s.itemIds),
  );
  const others = await benchmarks(db, a);
  const titles = new Map(specs(t).map((s) => [s.key, s.title]));
  const review: OaReviewItemDto[] = [];
  for (const s of state.sections) {
    for (const itemId of s.itemIds) {
      const it = items.get(itemId);
      if (!it) continue;
      const given = s.answers[itemId];
      const wasCorrect = given ? isCorrect(it, given.response) : false;
      review.push({
        id: it.id,
        section: titles.get(s.key) ?? s.key,
        topic: it.topic,
        body: it.body,
        options: it.options,
        yourAnswer: given ? displayResponse(it, given.response) : null,
        correct: wasCorrect,
        answered: Boolean(given),
        answer: displayAnswer(it),
        explanation: it.explanation,
        shortcut: it.shortcut,
      });
    }
  }
  return {
    sections: report.sections.map((s) => ({
      ...s,
      title: titles.get(s.key) ?? s.key,
      percentile: percentile(
        s.percent,
        others.map((o) => o.sections.find((x) => x.key === s.key)?.percent ?? 0),
      ),
    })),
    marks: report.marks,
    maxMarks: report.maxMarks,
    percent: report.percent,
    percentile: percentile(
      report.percent,
      others.map((o) => o.percent),
    ),
    weakTopics: report.weakTopics,
    secondsPerQuestion: report.secondsPerQuestion,
    rushed: report.rushed.map((k) => titles.get(k) ?? k),
    xpAwarded: a.xpAwarded,
    review,
  };
}

const isCorrect = (it: Item, response: unknown) => gradeAnswer(it, response);

// DTO ----------------------------------------------------------------------------------------------------

async function attemptDto(db: Db, a: AttemptRow, t: TemplateRow, now: Date): Promise<OaAttemptDto> {
  const state = syncClock(stateOf(a), now);
  const plan = specs(t);
  const step = a.finishedAt ? ({ kind: "finished" } as const) : currentStep(state, now);
  const sections = state.sections.map((s, i) => ({
    key: s.key,
    title: plan[i]?.title ?? s.key,
    count: s.itemIds.length,
    minutes: plan[i]?.minutes ?? 0,
    status: s.status,
    endedBy: s.endedBy,
    answered: Object.keys(s.answers).length,
  }));
  let current: OaAttemptDto["current"] = null;
  if (step.kind === "section") {
    const s = state.sections[step.index]!;
    const items = await loadItems(db, s.itemIds);
    current = {
      key: s.key,
      secondsLeft: step.secondsLeft,
      deadlineAt: s.deadlineAt!,
      items: s.itemIds.map((id) => itemDto(items.get(id)!)),
      answers: Object.fromEntries(
        Object.entries(s.answers).map(([id, v]) => [
          id,
          formatResponse(items.get(id)?.type ?? "single", v.response),
        ]),
      ),
    };
  }
  return {
    id: a.id,
    template: {
      slug: t.slug,
      title: t.title,
      negativeMarking: Number(t.negativeMarking),
      calculator: t.calculator,
    },
    startedAt: a.startedAt.toISOString(),
    finishedAt: a.finishedAt?.toISOString() ?? null,
    sections,
    step: step.kind,
    index: step.kind === "section" ? step.index : step.kind === "between" ? step.next : null,
    current,
    report: a.finishedAt && a.report ? await reportDto(db, a, t) : null,
  };
}
