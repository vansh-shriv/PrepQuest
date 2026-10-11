import { and, eq, isNull, sql } from "drizzle-orm";
import { interviewSessions, type Database } from "@prepquest/db";
import { AppError } from "@prepquest/shared";

/** True while the user is in an interview whose plan contains this problem. */
export async function problemInActiveInterview(
  db: Database,
  userId: string,
  problemId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: interviewSessions.id })
    .from(interviewSessions)
    .where(
      and(
        eq(interviewSessions.userId, userId),
        sql`${interviewSessions.startedAt} IS NOT NULL`,
        isNull(interviewSessions.endedAt),
        sql`${interviewSessions.plan}->'questions' @> ${JSON.stringify([{ problemId }])}::jsonb`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Hints and editorials are off while the problem is being asked in an interview (doc 02 D4). */
export async function assertNoInterviewLock(
  db: Database,
  userId: string,
  problemId: string,
): Promise<void> {
  if (await problemInActiveInterview(db, userId, problemId)) {
    throw new AppError(
      "HINT_LOCKED",
      403,
      "Hints and editorials are disabled while this problem is part of your interview.",
    );
  }
}

/** A run/submit may be tagged to an interview only if the session is live and asks this problem. */
export async function assertInterviewSubmissionAllowed(
  db: Database,
  userId: string,
  sessionId: string,
  problemId: string,
): Promise<void> {
  const [row] = await db
    .select({
      startedAt: interviewSessions.startedAt,
      endedAt: interviewSessions.endedAt,
      plan: interviewSessions.plan,
    })
    .from(interviewSessions)
    .where(and(eq(interviewSessions.id, sessionId), eq(interviewSessions.userId, userId)));
  if (!row) throw new AppError("NOT_FOUND", 404, "Interview not found");
  if (!row.startedAt || row.endedAt) {
    throw new AppError("INTERVIEW_NOT_ACTIVE", 409, "This interview is not in progress.");
  }
  const questions = (row.plan as { questions: { kind: string; problemId?: string }[] }).questions;
  if (!questions.some((q) => q.kind === "problem" && q.problemId === problemId)) {
    throw new AppError("VALIDATION_ERROR", 422, "This problem is not part of the interview.");
  }
}
