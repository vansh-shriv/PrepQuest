import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns.js";
import { users } from "./identity.js";

// Resumes, job descriptions, interview sessions and evaluation (I1-I8, E1, E2, E5, X5).
// Doc 10 §2.6-2.7. As built: templates live in code (`@prepquest/interview-core`), so sessions
// carry `template_key` instead of a template foreign key.

export const interviewState = pgEnum("interview_state", [
  "SETUP",
  "WARMUP",
  "PROBLEM",
  "CLARIFY",
  "APPROACH",
  "CODING",
  "TESTING",
  "OPTIMIZE",
  "FOLLOWUP",
  "WRAPUP",
  "ENDING",
  "COMPLETED",
  "ABANDONED",
  "FAILED",
]);

export const resumes = pgTable(
  "resumes",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    fileKey: text("file_key").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    /** uploaded | parsing | needs_review | ready | failed */
    status: text("status").notNull().default("uploaded"),
    parseError: text("parse_error"),
    parsed: jsonb("parsed"),
    claims: jsonb("claims"),
    isDefault: boolean("is_default").notNull().default(false),
    userConfirmedAt: timestamp("user_confirmed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("resumes_user_idx").on(t.userId, t.createdAt.desc()),
    uniqueIndex("resumes_one_default_idx")
      .on(t.userId)
      .where(sql`${t.isDefault}`),
  ],
);

export const resumeChunks = pgTable(
  "resume_chunks",
  {
    id: uuid("id").primaryKey(),
    resumeId: uuid("resume_id")
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    /** Source reference shown to the user, e.g. `projects[0]`. */
    ref: text("ref").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    ...timestamps,
  },
  (t) => [
    index("resume_chunks_resume_idx").on(t.resumeId),
    index("resume_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const jobDescriptions = pgTable(
  "job_descriptions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    company: text("company"),
    role: text("role"),
    rawText: text("raw_text").notNull(),
    analysis: jsonb("analysis"),
    gap: jsonb("gap"),
    resumeId: uuid("resume_id").references(() => resumes.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("job_descriptions_user_idx").on(t.userId, t.createdAt.desc())],
);

export const interviewSessions = pgTable(
  "interview_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Key of the template in code (`dsa`, `project`). */
    templateKey: text("template_key").notNull(),
    type: text("type").notNull(),
    role: text("role"),
    companyName: text("company_name"),
    level: text("level").notNull().default("sde1"),
    resumeId: uuid("resume_id").references(() => resumes.id, { onDelete: "set null" }),
    jdId: uuid("jd_id").references(() => jobDescriptions.id, { onDelete: "set null" }),
    persona: text("persona").notNull().default("neutral"),
    difficulty: smallint("difficulty").notNull().default(3),
    adaptive: boolean("adaptive").notNull().default(true),
    hintBudget: smallint("hint_budget").notNull().default(2),
    interruptionLevel: text("interruption_level").notNull().default("normal"),
    mode: text("mode").notNull().default("text"),
    realistic: boolean("realistic").notNull().default(true),
    state: interviewState("state").notNull().default("SETUP"),
    /** Selected questions/problems and segments; frozen when the session is created. */
    plan: jsonb("plan").notNull(),
    /** Orchestrator working memory: current question index, per-segment timing, clamps. */
    stateData: jsonb("state_data").notNull().default({}),
    rollingSummary: text("rolling_summary"),
    hintsGiven: smallint("hints_given").notNull().default(0),
    pausesUsed: smallint("pauses_used").notNull().default(0),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    plannedSeconds: integer("planned_seconds").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** completed | timer | user | abandoned | error | abuse */
    endReason: text("end_reason"),
    promptVersion: text("prompt_version"),
    modelConfig: jsonb("model_config"),
    idempotencyKey: text("idempotency_key"),
    ...timestamps,
  },
  (t) => [
    index("interview_sessions_user_idx").on(t.userId, t.createdAt.desc()),
    index("interview_sessions_active_idx")
      .on(t.endsAt)
      .where(sql`${t.endedAt} IS NULL AND ${t.startedAt} IS NOT NULL`),
    uniqueIndex("interview_sessions_idem_idx")
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    check("interview_sessions_difficulty_check", sql`${t.difficulty} BETWEEN 1 AND 5`),
    check("interview_sessions_hint_budget_check", sql`${t.hintBudget} BETWEEN 0 AND 3`),
  ],
);

export const interviewTurns = pgTable(
  "interview_turns",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** interviewer | candidate | system */
    speaker: text("speaker").notNull(),
    text: text("text").notNull(),
    offsetMs: integer("offset_ms").notNull(),
    modality: text("modality").notNull().default("text"),
    words: jsonb("words"),
    /** {hint_given, state_before, state_after, intent, clamps, tokens} */
    meta: jsonb("meta"),
    /** Client message id: makes a retried send idempotent. */
    clientMsgId: text("client_msg_id"),
    ...timestamps,
  },
  (t) => [
    unique("interview_turns_session_seq_key").on(t.sessionId, t.seq),
    uniqueIndex("interview_turns_client_msg_idx")
      .on(t.sessionId, t.clientMsgId)
      .where(sql`${t.clientMsgId} IS NOT NULL`),
    check(
      "interview_turns_speaker_check",
      sql`${t.speaker} IN ('interviewer','candidate','system')`,
    ),
  ],
);

/** Code and system events for replay (I6 groundwork): run, submit, paste, focus_lost, pause. */
export const interviewEvents = pgTable(
  "interview_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    offsetMs: integer("offset_ms").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    ...timestamps,
  },
  (t) => [index("interview_events_session_idx").on(t.sessionId, t.offsetMs)],
);

export const interviewScorecards = pgTable(
  "interview_scorecards",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .unique()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    rubricId: text("rubric_id").notNull(),
    rubricVersion: text("rubric_version").notNull(),
    /** generating | ready | failed */
    status: text("status").notNull().default("generating"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    overall: smallint("overall"),
    band: text("band"),
    summary: text("summary"),
    strengths: jsonb("strengths"),
    redFlags: jsonb("red_flags"),
    nextActions: jsonb("next_actions"),
    coverage: jsonb("coverage"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    helpful: smallint("helpful"),
    feedbackText: text("feedback_text"),
    ...timestamps,
  },
  (t) => [check("interview_scorecards_overall_check", sql`${t.overall} BETWEEN 0 AND 100`)],
);

export const scorecardScores = pgTable(
  "scorecard_scores",
  {
    scorecardId: uuid("scorecard_id")
      .notNull()
      .references(() => interviewScorecards.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    /** Null when the evidence was insufficient. */
    score: smallint("score"),
    weight: numeric("weight", { precision: 4, scale: 3 }).notNull(),
    justification: text("justification").notNull(),
    evidence: jsonb("evidence").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.scorecardId, t.dimension] }),
    check("scorecard_scores_score_check", sql`${t.score} IS NULL OR ${t.score} BETWEEN 1 AND 5`),
  ],
);

export const transcriptAnnotations = pgTable(
  "transcript_annotations",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    offsetMs: integer("offset_ms").notNull(),
    turnSeq: integer("turn_seq").notNull(),
    kind: text("kind").notNull(),
    dimension: text("dimension"),
    text: text("text").notNull(),
    severity: text("severity"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    index("transcript_annotations_session_idx").on(t.sessionId, t.offsetMs),
    check(
      "transcript_annotations_kind_check",
      sql`${t.kind} IN ('positive','improve','missed','red_flag')`,
    ),
  ],
);

/** Questions a user has been asked, so later sessions avoid repeats (X5, minimal). */
export const questionMemory = pgTable(
  "question_memory",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => interviewSessions.id, { onDelete: "set null" }),
    /** problem | project */
    kind: text("kind").notNull(),
    refKey: text("ref_key").notNull(),
    questionText: text("question_text").notNull(),
    outcome: smallint("outcome"),
    weak: boolean("weak").notNull().default(false),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index("question_memory_user_idx").on(t.userId, t.askedAt.desc())],
);

/** One row per LLM call: token accounting for budgets and dashboards (doc 13 §12). */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    sessionId: uuid("session_id").references(() => interviewSessions.id, { onDelete: "set null" }),
    task: text("task").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    meta: jsonb("meta"),
    ...timestamps,
  },
  (t) => [
    index("llm_usage_user_idx").on(t.userId, t.createdAt.desc()),
    index("llm_usage_session_idx").on(t.sessionId),
  ],
);
