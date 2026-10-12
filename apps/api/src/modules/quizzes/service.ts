import { and, eq, inArray, sql } from "drizzle-orm";
import {
  activityDays,
  newId,
  profiles,
  quizAttemptAnswers,
  quizAttempts,
  quizQuestions,
  xpEvents,
  type Database,
  type Db,
} from "@prepquest/db";
import {
  gradeAnswer,
  levelFor,
  localDay,
  quizXp,
  scoreAttempt,
  subjectSkills,
  type QuizType,
  type SubjectSkill,
} from "@prepquest/analytics-core";
import {
  AppError,
  QUIZ_SUBJECT_LABELS,
  type CreateQuizAttemptInput,
  type QuizAnswerInput,
  type QuizAnswerResult,
  type QuizAttemptDto,
  type QuizCatalogResponse,
  type QuizQuestionDto,
  type QuizResultDto,
} from "@prepquest/shared";

// Quizzes (C1): practice, timed tests, topic drills and weak-area quizzes. Grading, the answer key and the
// clock live here; the browser only ever gets a question without its answer.

type QuestionRow = typeof quizQuestions.$inferSelect;
type AttemptRow = typeof quizAttempts.$inferSelect;

const toQuestion = (q: QuestionRow): QuizQuestionDto => ({
  id: q.id,
  subject: q.subject,
  topic: q.topic,
  difficulty: q.difficulty,
  type: q.type as QuizType,
  body: q.bodyMd,
  options: q.options ?? null,
});

const DEFAULT_COUNT = { practice: 10, drill: 15, timed: 15, weak: 10 } as const;
/** Seconds allowed per question in a timed test when the learner does not set the minutes. */
const SECONDS_PER_QUESTION = 90;

export async function getCatalog(db: Database, userId: string): Promise<QuizCatalogResponse> {
  const counts = (
    await db.execute(sql`
      SELECT subject, topic, count(*)::int AS n FROM quiz_questions
      WHERE status = 'published' GROUP BY subject, topic ORDER BY subject, topic`)
  ).rows as unknown as Array<{ subject: string; topic: string; n: number }>;
  const mine = (
    await db.execute(sql`
      SELECT q.subject, count(*)::int AS answered, count(*) FILTER (WHERE a.correct)::int AS correct
      FROM quiz_attempt_answers a
      JOIN quiz_attempts t ON t.id = a.attempt_id AND t.user_id = ${userId}
      JOIN quiz_questions q ON q.id = a.question_id
      GROUP BY q.subject`)
  ).rows as unknown as Array<{ subject: string; answered: number; correct: number }>;
  const weak = (
    await db.execute(sql`
      SELECT count(*)::int AS n FROM (
        SELECT DISTINCT ON (a.question_id) a.correct
        FROM quiz_attempt_answers a JOIN quiz_attempts t ON t.id = a.attempt_id AND t.user_id = ${userId}
        ORDER BY a.question_id, a.answered_at DESC, a.created_at DESC
      ) latest WHERE NOT latest.correct`)
  ).rows[0] as { n: number };
  const recent = await db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), sql`${quizAttempts.finishedAt} IS NOT NULL`))
    .orderBy(sql`${quizAttempts.finishedAt} DESC`)
    .limit(5);

  const subjects = new Map<string, QuizCatalogResponse["subjects"][number]>();
  for (const c of counts) {
    const s = subjects.get(c.subject) ?? {
      subject: c.subject,
      label: QUIZ_SUBJECT_LABELS[c.subject] ?? c.subject,
      questions: 0,
      topics: [],
      answered: 0,
      correct: 0,
    };
    s.questions += c.n;
    s.topics.push({ topic: c.topic, questions: c.n });
    subjects.set(c.subject, s);
  }
  for (const m of mine) {
    const s = subjects.get(m.subject);
    if (s) {
      s.answered = m.answered;
      s.correct = m.correct;
    }
  }
  return {
    subjects: [...subjects.values()],
    weakCount: Number(weak.n),
    recent: recent.map((r) => ({
      id: r.id,
      mode: r.mode,
      subject: r.subject,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      correct: r.correct,
      total: r.total,
    })),
  };
}

async function pickQuestions(
  db: Database,
  userId: string,
  input: CreateQuizAttemptInput,
  count: number,
): Promise<QuestionRow[]> {
  const subject = input.subject ? sql`AND q.subject = ${input.subject}` : sql``;
  const topic = input.topic ? sql`AND q.topic = ${input.topic}` : sql``;
  let ids: string[];
  if (input.mode === "weak") {
    ids = (
      (
        await db.execute(sql`
          SELECT q.id FROM (
            SELECT DISTINCT ON (a.question_id) a.question_id, a.correct
            FROM quiz_attempt_answers a JOIN quiz_attempts t ON t.id = a.attempt_id AND t.user_id = ${userId}
            ORDER BY a.question_id, a.answered_at DESC, a.created_at DESC
          ) latest JOIN quiz_questions q ON q.id = latest.question_id
          WHERE NOT latest.correct AND q.status = 'published' ${subject} ${topic}
          ORDER BY random() LIMIT ${count}`)
      ).rows as Array<{ id: string }>
    ).map((r) => r.id);
    if (ids.length === 0)
      throw new AppError("NO_WEAK_QUESTIONS", 422, "No mistakes to review yet. Take a quiz first.");
  } else {
    // questions never answered correctly come first, so a quiz teaches something new before it repeats
    ids = (
      (
        await db.execute(sql`
          SELECT q.id FROM quiz_questions q
          WHERE q.status = 'published' ${subject} ${topic}
          ORDER BY EXISTS (
            SELECT 1 FROM quiz_attempt_answers a JOIN quiz_attempts t ON t.id = a.attempt_id
            WHERE a.question_id = q.id AND t.user_id = ${userId} AND a.correct
          ), random() LIMIT ${count}`)
      ).rows as Array<{ id: string }>
    ).map((r) => r.id);
    if (ids.length === 0)
      throw new AppError("NO_QUESTIONS", 422, "There are no questions for that choice yet.");
  }
  const rows = await db.select().from(quizQuestions).where(inArray(quizQuestions.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

async function attemptDto(db: Db, a: AttemptRow): Promise<QuizAttemptDto> {
  const rows = await db
    .select()
    .from(quizQuestions)
    .where(inArray(quizQuestions.id, a.questionIds.length ? a.questionIds : [newId()]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const answered = await db
    .select({ id: quizAttemptAnswers.questionId })
    .from(quizAttemptAnswers)
    .where(eq(quizAttemptAnswers.attemptId, a.id));
  return {
    id: a.id,
    mode: a.mode as QuizAttemptDto["mode"],
    subject: a.subject,
    total: a.total,
    startedAt: a.startedAt.toISOString(),
    deadlineAt: a.deadlineAt?.toISOString() ?? null,
    finished: a.finishedAt !== null,
    questions: a.questionIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((q) => toQuestion(q!)),
    answered: answered.map((r) => r.id),
  };
}

export async function startAttempt(
  db: Database,
  userId: string,
  input: CreateQuizAttemptInput,
  now: Date,
): Promise<QuizAttemptDto> {
  if (input.mode === "drill" && !input.topic)
    throw new AppError("VALIDATION_ERROR", 422, "Pick a topic to drill.");
  const count = input.count ?? DEFAULT_COUNT[input.mode];
  const questions = await pickQuestions(db, userId, input, count);
  const timed = input.mode === "timed";
  const seconds = (input.minutes ?? Math.ceil((questions.length * SECONDS_PER_QUESTION) / 60)) * 60;
  const [row] = await db
    .insert(quizAttempts)
    .values({
      id: newId(),
      userId,
      mode: input.mode,
      subject: input.subject ?? null,
      topic: input.topic ?? null,
      questionIds: questions.map((q) => q.id),
      total: questions.length,
      startedAt: now,
      deadlineAt: timed ? new Date(now.getTime() + seconds * 1000) : null,
    })
    .returning();
  return attemptDto(db, row!);
}

async function ownAttempt(db: Db, userId: string, id: string, lock = false): Promise<AttemptRow> {
  const q = db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, id), eq(quizAttempts.userId, userId)));
  const [a] = await (lock ? q.for("update") : q);
  if (!a) throw new AppError("NOT_FOUND", 404, "Quiz attempt not found.");
  return a;
}

export async function answer(
  db: Database,
  userId: string,
  attemptId: string,
  input: QuizAnswerInput,
  now: Date,
): Promise<QuizAnswerResult> {
  const a = await ownAttempt(db, userId, attemptId);
  if (a.finishedAt) throw new AppError("QUIZ_FINISHED", 409, "This quiz is already finished.");
  if (a.deadlineAt && now > a.deadlineAt)
    throw new AppError("QUIZ_EXPIRED", 409, "Time is up for this quiz.");
  if (!a.questionIds.includes(input.questionId))
    throw new AppError("VALIDATION_ERROR", 422, "That question is not part of this quiz.");
  const [q] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, input.questionId));
  if (!q) throw new AppError("NOT_FOUND", 404, "Question not found.");
  const correct = gradeAnswer({ type: q.type as QuizType, answer: q.answer }, input.response);
  const timed = a.mode === "timed";
  const values = {
    attemptId,
    questionId: q.id,
    response: input.response,
    correct,
    timeMs: input.timeMs ?? null,
    answeredAt: now,
  };
  if (timed) {
    // a timed test lets you change an answer until the clock runs out
    await db
      .insert(quizAttemptAnswers)
      .values(values)
      .onConflictDoUpdate({
        target: [quizAttemptAnswers.attemptId, quizAttemptAnswers.questionId],
        set: { response: values.response, correct, timeMs: values.timeMs, answeredAt: now },
      });
    return { saved: true, feedback: null };
  }
  const inserted = await db
    .insert(quizAttemptAnswers)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: quizAttemptAnswers.questionId });
  if (inserted.length === 0)
    throw new AppError("ALREADY_ANSWERED", 409, "You already answered this question.");
  return {
    saved: true,
    feedback: {
      correct,
      answer: q.answer,
      explanation: q.explanationMd,
      interviewLine: q.interviewLine,
    },
  };
}

async function buildResult(db: Db, a: AttemptRow): Promise<QuizResultDto> {
  const questions = await db
    .select()
    .from(quizQuestions)
    .where(inArray(quizQuestions.id, a.questionIds.length ? a.questionIds : [newId()]));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answers = await db
    .select()
    .from(quizAttemptAnswers)
    .where(eq(quizAttemptAnswers.attemptId, a.id));
  const ans = new Map(answers.map((x) => [x.questionId, x]));
  const score = scoreAttempt(answers, a.total);
  const finished = a.finishedAt ?? new Date();
  return {
    id: a.id,
    mode: a.mode,
    correct: score.correct,
    total: a.total,
    percent: score.percent,
    medianSeconds: score.medianSeconds,
    xpAwarded: a.xpAwarded,
    expired: a.deadlineAt !== null && finished >= a.deadlineAt && answers.length < a.total,
    review: a.questionIds
      .map((id) => byId.get(id))
      .filter((q): q is QuestionRow => Boolean(q))
      .map((q) => {
        const given = ans.get(q.id);
        return {
          question: toQuestion(q),
          response: given?.response ?? null,
          answered: given !== undefined,
          correct: given?.correct ?? false,
          answer: q.answer,
          explanation: q.explanationMd,
          interviewLine: q.interviewLine,
        };
      }),
  };
}

/** Scores the attempt and pays XP once: 2 XP per question answered correctly for the first time ever. */
export async function finish(
  db: Database,
  userId: string,
  attemptId: string,
  now: Date,
): Promise<QuizResultDto> {
  const a = await db.transaction(async (tx) => {
    const att = await ownAttempt(tx, userId, attemptId, true);
    if (att.finishedAt) return att;
    const correctNow = (
      await tx
        .select({ id: quizAttemptAnswers.questionId })
        .from(quizAttemptAnswers)
        .where(
          and(eq(quizAttemptAnswers.attemptId, attemptId), eq(quizAttemptAnswers.correct, true)),
        )
    ).map((r) => r.id);
    let newly = 0;
    if (correctNow.length > 0) {
      const before = (
        (
          await tx.execute(sql`
            SELECT DISTINCT a.question_id FROM quiz_attempt_answers a
            JOIN quiz_attempts t ON t.id = a.attempt_id
            WHERE t.user_id = ${userId} AND t.id <> ${attemptId} AND a.correct
              AND a.question_id IN (${sql.join(
                correctNow.map((id) => sql`${id}`),
                sql`, `,
              )})`)
        ).rows as Array<{ question_id: string }>
      ).map((r) => r.question_id);
      const seen = new Set(before);
      newly = correctNow.filter((id) => !seen.has(id)).length;
    }
    const xp = quizXp(newly);
    const total = (
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(quizAttemptAnswers)
        .where(eq(quizAttemptAnswers.attemptId, attemptId))
    )[0]!.n;
    const [updated] = await tx
      .update(quizAttempts)
      .set({ finishedAt: now, correct: correctNow.length, xpAwarded: xp })
      .where(eq(quizAttempts.id, attemptId))
      .returning();
    if (total > 0) {
      const [p] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).for("update");
      if (p) {
        const day = localDay(now, p.timezone);
        const newXp = p.xp + xp;
        if (xp > 0) {
          await tx
            .update(profiles)
            .set({ xp: newXp, level: Math.max(p.level, levelFor(newXp).level) })
            .where(eq(profiles.userId, userId));
          await tx.insert(xpEvents).values({
            userId,
            delta: xp,
            reason: "quiz",
            refType: "quiz_attempt",
            refId: attemptId,
            at: now,
          });
        }
        await tx
          .insert(activityDays)
          .values({ userId, day, quizzes: 1 })
          .onConflictDoUpdate({
            target: [activityDays.userId, activityDays.day],
            set: { quizzes: sql`${activityDays.quizzes} + 1` },
          });
      }
    }
    return updated!;
  });
  return buildResult(db, a);
}

export async function getAttempt(
  db: Database,
  userId: string,
  id: string,
): Promise<{ attempt: QuizAttemptDto | null; result: QuizResultDto | null }> {
  const a = await ownAttempt(db, userId, id);
  if (a.finishedAt) return { attempt: null, result: await buildResult(db, a) };
  return { attempt: await attemptDto(db, a), result: null };
}

/** Recency-weighted quiz accuracy per subject: readiness reads it as "CS fundamentals". */
export async function quizSkills(db: Database, userId: string, now: Date): Promise<SubjectSkill[]> {
  const rows = (
    await db.execute(sql`
      SELECT q.subject, a.correct, a.answered_at
      FROM quiz_attempt_answers a
      JOIN quiz_attempts t ON t.id = a.attempt_id AND t.user_id = ${userId} AND t.finished_at IS NOT NULL
      JOIN quiz_questions q ON q.id = a.question_id`)
  ).rows as unknown as Array<{ subject: string; correct: boolean; answered_at: Date }>;
  return subjectSkills(
    rows.map((r) => ({
      subject: r.subject,
      correct: r.correct,
      ageDays: Math.max(0, (now.getTime() - new Date(r.answered_at).getTime()) / 86_400_000),
    })),
  );
}
