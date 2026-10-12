// Quiz grading and scoring (C1). Pure: the API holds the answers, the browser never sees them in a timed test.

export const QUIZ_TYPES = ["single", "multi", "tf", "blank", "output"] as const;
export type QuizType = (typeof QUIZ_TYPES)[number];

export interface GradableQuestion {
  type: QuizType;
  /** single: option id. multi: option ids. tf: boolean. blank and output: accepted answers. */
  answer: unknown;
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** Output predictions ignore blank lines, trailing spaces and case. */
const normalizeOutput = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => normalize(l))
    .filter(Boolean)
    .join("\n");

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : typeof v === "string"
      ? [v]
      : [];

/** Whether `response` is a correct answer. Anything malformed is simply wrong. */
export function gradeAnswer(q: GradableQuestion, response: unknown): boolean {
  switch (q.type) {
    case "single":
      return typeof response === "string" && response === q.answer;
    case "tf":
      return typeof response === "boolean" && response === q.answer;
    case "multi": {
      const want = new Set(strings(q.answer));
      const got = new Set(strings(response));
      return got.size === want.size && [...want].every((x) => got.has(x));
    }
    case "blank": {
      if (typeof response !== "string") return false;
      const got = normalize(response);
      return got !== "" && strings(q.answer).some((a) => normalize(a) === got);
    }
    case "output": {
      if (typeof response !== "string") return false;
      const got = normalizeOutput(response);
      return got !== "" && strings(q.answer).some((a) => normalizeOutput(a) === got);
    }
  }
}

export interface AttemptScore {
  correct: number;
  total: number;
  /** 0 to 100, whole number. */
  percent: number;
  /** Median seconds per answered question, or null. */
  medianSeconds: number | null;
}

export function scoreAttempt(
  answers: ReadonlyArray<{ correct: boolean; timeMs?: number | null }>,
  total: number,
): AttemptScore {
  const correct = answers.filter((a) => a.correct).length;
  const times = answers
    .map((a) => a.timeMs)
    .filter((t): t is number => typeof t === "number" && t >= 0)
    .sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  const median =
    times.length === 0
      ? null
      : times.length % 2
        ? times[mid]!
        : (times[mid - 1]! + times[mid]!) / 2;
  return {
    correct,
    total,
    percent: total === 0 ? 0 : Math.round((correct / total) * 100),
    medianSeconds: median === null ? null : Math.round(median / 100) / 10,
  };
}

/** XP per question answered correctly for the first time ever (repeating a known answer earns nothing). */
export const QUIZ_XP_PER_NEW_CORRECT = 2;
/** Most XP one attempt can pay. */
export const QUIZ_XP_CAP = 30;

export function quizXp(newlyCorrect: number): number {
  return Math.min(QUIZ_XP_CAP, Math.max(0, newlyCorrect) * QUIZ_XP_PER_NEW_CORRECT);
}

export interface SubjectAnswer {
  subject: string;
  correct: boolean;
  /** Age of the answer in days. */
  ageDays: number;
}

export interface SubjectSkill {
  subject: string;
  /** Recency-weighted accuracy, 0 to 1 (30-day half-life). */
  score: number;
  /** 0 to 1: 20 answers is full confidence. */
  confidence: number;
  answered: number;
}

/** Recency-weighted accuracy per subject: this is what readiness reads as "CS fundamentals". */
export function subjectSkills(answers: readonly SubjectAnswer[]): SubjectSkill[] {
  const acc = new Map<string, { w: number; s: number; n: number }>();
  for (const a of answers) {
    const w = Math.pow(0.5, Math.max(0, a.ageDays) / 30);
    const cur = acc.get(a.subject) ?? { w: 0, s: 0, n: 0 };
    cur.w += w;
    cur.s += w * (a.correct ? 1 : 0);
    cur.n += 1;
    acc.set(a.subject, cur);
  }
  return [...acc]
    .map(([subject, a]) => ({
      subject,
      score: a.w > 0 ? a.s / a.w : 0,
      confidence: Math.min(1, a.n / 20),
      answered: a.n,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/** Combines subject skills into one component value, weighting each subject by how much was answered. */
export function overallQuizSkill(skills: readonly SubjectSkill[]): {
  score: number | null;
  confidence: number;
} {
  const total = skills.reduce((a, s) => a + s.answered, 0);
  if (total === 0) return { score: null, confidence: 0 };
  return {
    score: skills.reduce((a, s) => a + s.score * s.answered, 0) / total,
    confidence: Math.min(1, total / 30),
  };
}
