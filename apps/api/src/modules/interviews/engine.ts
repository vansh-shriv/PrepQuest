import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  interviewEvents,
  interviewScorecards,
  interviewSessions,
  interviewTurns,
  newId,
  questionMemory,
  submissions,
  withTransaction,
  type Db,
} from "@prepquest/db";
import {
  ABUSE_LIMIT,
  cleanWords,
  spokenPrefix,
  type SpokenWord,
  REACTION_NOTE,
  idleCodingDue,
  mayReact,
  reactionForRun,
  reactionForSnapshot,
  type ReactionKind,
  ControlStreamFilter,
  MAX_PAUSE_MS,
  PERSONAS,
  WARNING_THRESHOLDS,
  asksForHint,
  canPause,
  checkSolutionLeak,
  computePolicy,
  decideNext,
  detectAbuse,
  getRubric,
  getTemplate,
  nextDifficulty,
  parseReply,
  questionScore,
  sanitizeCandidateText,
  segmentKeyFor,
  styleFlags,
  timeGuard,
  validateControl,
  type Control,
  type InterviewState,
  type Persona,
  type PlannedQuestion,
} from "@prepquest/interview-core";
import {
  CLOSING_LINE,
  REACTION_SYSTEM,
  buildReactionPrompt,
  PROMPT_VERSIONS,
  REGENERATE_NOTES,
  buildInterviewerSystem,
  buildSessionFacts,
  buildTurnMessage,
  type TurnEvent,
} from "@prepquest/prompts";
import { AppError, type BargeInInput } from "@prepquest/shared";
import type { InterviewCodeEventInput, InterviewMessageInput } from "@prepquest/shared";
import type { LlmMessage } from "../../lib/llm/index.js";
import type { AiContext } from "../ai-context.js";
import type { InterviewBus, SessionStateEvent } from "./bus.js";
import {
  candidateSummary,
  loadProblemContext,
  loadResumeParsed,
  loadTurns,
  resumeContext,
  type ProblemContext,
} from "./context.js";
import { repickProblem } from "./plan.js";
import { memoryValues } from "./bank.js";
import { generateExtras } from "./extras.js";
import { generateScorecard } from "./scorecard.js";
import {
  elapsedMs,
  initialStateData,
  isActive,
  plannedMs,
  readPlan,
  readStateData,
  remainingMsOf,
  toFacts,
  type SessionRow,
  type StateData,
} from "./state.js";
import { createHash } from "node:crypto";
import { z } from "zod";

const reactionDecisionSchema = z.object({
  speak: z.boolean(),
  reason: z.string().max(200).optional(),
});

const NAMES: Record<Persona, string> = {
  friendly: "Priya",
  neutral: "Alex",
  strict: "Dr. Rao",
  rapid: "Sam",
};
const HISTORY_TURNS = 12;
const SUMMARY_EVERY = 10;
const IDLE_MS: Record<Persona, number> = {
  friendly: 120_000,
  neutral: 120_000,
  strict: 150_000,
  rapid: 60_000,
};
const IDLE_STATES: readonly InterviewState[] = [
  "WARMUP",
  "CLARIFY",
  "APPROACH",
  "OPTIMIZE",
  "FOLLOWUP",
  "WRAPUP",
];
const SAFE_REPLY = "Let's keep going. What's your next step?";
const MAX_REGENERATIONS = 1;

export interface TurnOutcome {
  seq: number;
  turnId: string;
  text: string;
  intent: string;
  hintUsed: boolean;
  state: InterviewState;
}

export interface MessageResult {
  candidateSeq: number;
  replay: boolean;
  replies: TurnOutcome[];
  state: InterviewState;
  ended: boolean;
}

export class InterviewEngine {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly problemCache = new Map<string, ProblemContext>();
  private readonly lastTick = new Map<string, number>();

  constructor(
    private readonly ctx: AiContext,
    readonly bus: InterviewBus,
  ) {}

  // ------------------------------------------------------------------ plumbing

  /** Runs `fn` after every earlier task of the same session (one turn at a time per session). */
  private serial<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(sessionId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.chains.set(sessionId, next);
    const clear = () => {
      if (this.chains.get(sessionId) === next) this.chains.delete(sessionId);
    };
    void next.then(clear, clear);
    return next;
  }

  private busy(sessionId: string): boolean {
    return this.chains.has(sessionId);
  }

  async getSession(id: string, userId?: string): Promise<SessionRow> {
    const [row] = await this.ctx.db
      .select()
      .from(interviewSessions)
      .where(eq(interviewSessions.id, id));
    if (!row || (userId && row.userId !== userId)) {
      throw new AppError("NOT_FOUND", 404, "Interview not found");
    }
    return row;
  }

  private async save(db: Db, id: string, patch: Partial<typeof interviewSessions.$inferInsert>) {
    await db.update(interviewSessions).set(patch).where(eq(interviewSessions.id, id));
  }

  stateEvent(s: SessionRow): SessionStateEvent {
    const plan = readPlan(s);
    const sd = readStateData(s);
    const keys = plan.questions.map((q) => q.segmentKey);
    return {
      state: s.state,
      segment: segmentKeyFor(s.state, sd.questionIndex, keys),
      remainingMs: s.endedAt ? 0 : remainingMsOf(s, this.ctx.now()),
      hintsLeft: Math.max(0, s.hintBudget - s.hintsGiven),
      paused: s.pausedAt !== null,
      questionIndex: sd.questionIndex,
      questionCount: plan.questions.length,
    };
  }

  private publishState(s: SessionRow) {
    this.bus.publish(s.id, { type: "session.state", state: this.stateEvent(s) });
  }

  // ------------------------------------------------------------------ lifecycle

  async start(userId: string, id: string): Promise<SessionRow> {
    return this.serial(id, async () => {
      const s = await this.getSession(id, userId);
      if (s.startedAt) return s; // idempotent
      if (s.state !== "SETUP")
        throw new AppError("CONFLICT", 409, "This interview can't be started");
      const [live] = await this.ctx.db
        .select({ id: interviewSessions.id })
        .from(interviewSessions)
        .where(
          and(
            eq(interviewSessions.userId, userId),
            sql`${interviewSessions.startedAt} IS NOT NULL`,
            isNull(interviewSessions.endedAt),
          ),
        );
      if (live) {
        throw new AppError("INTERVIEW_IN_PROGRESS", 409, "Finish your current interview first.");
      }
      const now = this.ctx.now();
      const sd = initialStateData(s.difficulty);
      await this.save(this.ctx.db, id, {
        startedAt: now,
        endsAt: new Date(now.getTime() + s.plannedSeconds * 1000),
        state: "WARMUP",
        stateData: sd,
      });
      const started = await this.getSession(id);
      this.publishState(started);
      this.ctx.jobs.run(`greeting:${id}`, async () => {
        await this.serial(id, () => this.runTurn(id, { kind: "start" }));
      });
      return started;
    });
  }

  /**
   * The candidate talked over an interviewer reply (voice barge-in). The reply stays in the
   * transcript, marked as interrupted with the part that was actually heard, so the next turn knows.
   */
  async bargeIn(userId: string, id: string, input: BargeInInput): Promise<{ ok: true }> {
    return this.serial(id, async () => {
      const s = await this.requireActive(userId, id);
      const [turn] = await this.ctx.db
        .select()
        .from(interviewTurns)
        .where(
          and(
            eq(interviewTurns.id, input.turnId),
            eq(interviewTurns.sessionId, id),
            eq(interviewTurns.speaker, "interviewer"),
          ),
        );
      if (!turn) throw new AppError("NOT_FOUND", 404, "That interviewer message doesn't exist");
      const heard = spokenPrefix(turn.text, input.charIndex);
      const meta = {
        ...((turn.meta as Record<string, unknown> | null) ?? {}),
        interrupted: true,
        heard,
      };
      await this.ctx.db.update(interviewTurns).set({ meta }).where(eq(interviewTurns.id, turn.id));
      await this.logEvent(id, elapsedMs(s, this.ctx.now()), "barge_in", {
        turnId: turn.id,
        seq: turn.seq,
        heardChars: heard.length,
      });
      return { ok: true };
    });
  }

  async pause(userId: string, id: string): Promise<SessionRow> {
    return this.serial(id, async () => {
      const s = await this.requireActive(userId, id);
      const check = canPause({
        realistic: s.realistic,
        pausesUsed: s.pausesUsed,
        alreadyPaused: s.pausedAt !== null,
      });
      if (!check.ok) throw new AppError("CONFLICT", 409, check.reason);
      await this.save(this.ctx.db, id, { pausedAt: this.ctx.now(), pausesUsed: s.pausesUsed + 1 });
      const fresh = await this.getSession(id);
      await this.logEvent(id, elapsedMs(fresh, this.ctx.now()), "pause", {});
      this.publishState(fresh);
      return fresh;
    });
  }

  async resume(userId: string, id: string): Promise<SessionRow> {
    return this.serial(id, async () => {
      const s = await this.requireActive(userId, id);
      if (!s.pausedAt) throw new AppError("CONFLICT", 409, "The interview is not paused");
      return this.resumeNow(s);
    });
  }

  private async resumeNow(s: SessionRow): Promise<SessionRow> {
    const now = this.ctx.now();
    // only the allowed pause is credited back; a longer one counts against the clock
    const credit = Math.min(MAX_PAUSE_MS, now.getTime() - (s.pausedAt as Date).getTime());
    const sd = readStateData(s);
    sd.pausedMs += credit;
    sd.lastActivityMs = elapsedMs({ ...s, pausedAt: null, stateData: sd }, now);
    await this.save(this.ctx.db, s.id, {
      pausedAt: null,
      stateData: sd,
      endsAt: new Date((s.endsAt as Date).getTime() + credit),
    });
    const fresh = await this.getSession(s.id);
    this.publishState(fresh);
    return fresh;
  }

  async end(userId: string, id: string): Promise<SessionRow> {
    return this.serial(id, async () => {
      const s = await this.getSession(id, userId);
      if (s.endedAt) return s;
      if (!s.startedAt) {
        await this.save(this.ctx.db, id, {
          state: "ABANDONED",
          endedAt: this.ctx.now(),
          endReason: "abandoned",
        });
        return this.getSession(id);
      }
      return this.finish(s, "user");
    });
  }

  private async requireActive(userId: string, id: string): Promise<SessionRow> {
    const s = await this.getSession(id, userId);
    if (!isActive(s))
      throw new AppError("INTERVIEW_NOT_ACTIVE", 409, "This interview is not in progress.");
    return s;
  }

  // ------------------------------------------------------------------ candidate input

  async sendMessage(
    userId: string,
    id: string,
    input: InterviewMessageInput,
  ): Promise<MessageResult> {
    return this.serial(id, async () => {
      const s = await this.requireActive(userId, id);
      const dup = await this.findByClientId(id, input.clientMsgId);
      if (dup) {
        let after = await this.repliesAfter(id, dup.seq);
        if (after.length === 0 && !s.pausedAt) {
          // the first attempt failed before the interviewer answered: answer now, once
          const out = await this.runTurn(id, { kind: "candidate", text: dup.text });
          after = out.replies;
        }
        const fresh = await this.getSession(id);
        return {
          candidateSeq: dup.seq,
          replay: true,
          replies: after,
          state: fresh.state,
          ended: fresh.endedAt !== null,
        };
      }
      if (s.pausedAt) throw new AppError("INTERVIEW_PAUSED", 409, "Resume the interview first.");
      const now = this.ctx.now();
      if (elapsedMs(s, now) >= plannedMs(s)) {
        await this.finish(s, "timer");
        throw new AppError("INTERVIEW_NOT_ACTIVE", 409, "Time is up.");
      }
      const text = sanitizeCandidateText(input.text);
      if (!text) throw new AppError("VALIDATION_FAILED", 422, "Say something first");

      const sd = readStateData(s);
      const e = elapsedMs(s, now);
      sd.turnsInState += 1;
      sd.lastActivityMs = e;
      sd.idlePrompts = 0;
      sd.pendingReaction = null; // they are talking: no need to interrupt
      const seq = await this.insertTurn(id, "candidate", text, e, {
        clientMsgId: input.clientMsgId,
        modality: input.modality,
        words: input.words ? cleanWords(input.words) : null,
      });
      this.bus.publish(id, {
        type: "candidate.message",
        seq,
        text,
        offsetMs: e,
        clientMsgId: input.clientMsgId,
      });

      // time guard before the reply: at 85% the interviewer moves to the wrap-up
      let note: string | undefined;
      let state = s.state;
      const plan = readPlan(s);
      const guard = timeGuard(e, plannedMs(s));
      const lastQ = sd.questionIndex >= plan.questions.length - 1;
      if (
        guard === "force_wrapup" &&
        state !== "WRAPUP" &&
        state !== "ENDING" &&
        !((state === "CODING" || state === "TESTING") && lastQ)
      ) {
        state = "WRAPUP";
        sd.stateEnteredMs = e;
        sd.turnsInState = 0; // this message is not an answer to the wrap-up prompt
        note =
          "Time is almost up. Respond briefly to the candidate, then move to wrap up and invite their questions.";
      }
      await this.save(this.ctx.db, id, { state, stateData: sd });

      const out = await this.runTurn(
        id,
        { kind: "candidate", text },
        { note, localAbuse: detectAbuse(text), asksHint: asksForHint(text) },
      );
      const fresh = await this.getSession(id);
      return {
        candidateSeq: seq,
        replay: false,
        replies: out.replies,
        state: fresh.state,
        ended: fresh.endedAt !== null,
      };
    });
  }

  private async repliesAfter(sessionId: string, seq: number): Promise<TurnOutcome[]> {
    const after = await this.ctx.db
      .select()
      .from(interviewTurns)
      .where(and(eq(interviewTurns.sessionId, sessionId), sql`${interviewTurns.seq} > ${seq}`))
      .orderBy(asc(interviewTurns.seq));
    return after
      .filter((t) => t.speaker === "interviewer")
      .map((t) => {
        const meta = (t.meta ?? {}) as Record<string, unknown>;
        return {
          seq: t.seq,
          turnId: t.id,
          text: t.text,
          intent: String(meta.intent ?? "followup"),
          hintUsed: Number(meta.hint_level ?? 0) > 0,
          state: String(meta.state_after ?? "WARMUP") as InterviewState,
        };
      });
  }

  private async findByClientId(sessionId: string, clientMsgId: string) {
    const [t] = await this.ctx.db
      .select()
      .from(interviewTurns)
      .where(
        and(eq(interviewTurns.sessionId, sessionId), eq(interviewTurns.clientMsgId, clientMsgId)),
      );
    return t;
  }

  private async insertTurn(
    sessionId: string,
    speaker: "interviewer" | "candidate" | "system",
    text: string,
    offsetMs: number,
    extra: {
      meta?: Record<string, unknown>;
      clientMsgId?: string;
      id?: string;
      db?: Db;
      modality?: "text" | "voice";
      words?: SpokenWord[] | null;
    } = {},
  ): Promise<number> {
    const db = extra.db ?? this.ctx.db;
    const [row] = await db
      .select({ next: sql<number>`coalesce(max(${interviewTurns.seq}), 0) + 1` })
      .from(interviewTurns)
      .where(eq(interviewTurns.sessionId, sessionId));
    const seq = row?.next ?? 1;
    await db.insert(interviewTurns).values({
      id: extra.id ?? newId(),
      sessionId,
      seq,
      speaker,
      text,
      offsetMs,
      modality: extra.modality ?? "text",
      words: extra.words && extra.words.length > 0 ? extra.words : null,
      meta: extra.meta ?? null,
      clientMsgId: extra.clientMsgId ?? null,
    });
    return seq;
  }

  private async logEvent(sessionId: string, offsetMs: number, kind: string, payload: object) {
    await this.ctx.db.insert(interviewEvents).values({ sessionId, offsetMs, kind, payload });
  }

  // ------------------------------------------------------------------ code events

  async codeEvent(userId: string, id: string, ev: InterviewCodeEventInput): Promise<{ ok: true }> {
    return this.serial(id, async () => {
      const s = await this.requireActive(userId, id);
      if (s.pausedAt) throw new AppError("INTERVIEW_PAUSED", 409, "Resume the interview first.");
      const now = this.ctx.now();
      const e = elapsedMs(s, now);
      const sd = readStateData(s);
      const template = getTemplate(s.templateKey);
      if (!template?.usesEditor)
        throw new AppError("VALIDATION_FAILED", 422, "This interview has no editor");

      if (ev.kind === "snapshot") {
        if (!ev.code) return { ok: true };
        const hash = createHash("sha256").update(ev.code).digest("hex");
        if (sd.lastCode?.hash === hash) return { ok: true };
        sd.lastCode = { language: ev.language ?? "unknown", code: ev.code, hash };
        sd.lastActivityMs = e;
        sd.lastCodeChangeMs = e;
        if (sd.starterLen === null) {
          sd.starterLen = ev.code.length; // the first snapshot of a question is the starter code
        } else if (!sd.pendingReaction) {
          sd.pendingReaction = reactionForSnapshot({
            state: s.state,
            code: ev.code,
            starterLength: sd.starterLen,
            approachStated: sd.approachStated,
            elapsedMs: e,
            reactedKinds: sd.reactedKinds,
          });
        }
        await this.logEvent(id, e, "code_snapshot", {
          language: sd.lastCode.language,
          code: ev.code,
        });
        await this.save(this.ctx.db, id, { stateData: sd });
        return { ok: true };
      }
      if (ev.kind === "paste" || ev.kind === "focus_lost") {
        await this.logEvent(id, e, ev.kind, ev.meta ?? {});
        return { ok: true };
      }

      // run / submit: the verdict comes from the judge's own record, never from the browser
      if (!ev.submissionId)
        throw new AppError("VALIDATION_FAILED", 422, "submissionId is required");
      const [sub] = await this.ctx.db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.id, ev.submissionId),
            eq(submissions.userId, userId),
            eq(submissions.interviewSessionId, id),
          ),
        );
      if (!sub) throw new AppError("NOT_FOUND", 404, "Submission not found for this interview");
      if (["QUEUED", "COMPILING", "RUNNING"].includes(sub.verdict)) {
        throw new AppError("CONFLICT", 409, "Wait for the judge to finish first");
      }
      const prevState = s.state;
      sd.hasRun = true;
      sd.lastActivityMs = e;
      sd.lastRun = `${sub.kind} ${sub.verdict}${sub.total ? ` ${sub.passed ?? 0}/${sub.total}` : ""}`;
      const q = sd.questions[sd.questionIndex];
      if (q) q.runs += 1;
      const firstAc = sub.kind === "submit" && sub.verdict === "AC" && !sd.ac;
      if (firstAc) {
        sd.ac = true;
        if (q) q.solved = true;
        sd.pendingReaction = null;
        sd.lastProactiveMs = e;
        sd.reactionsOnQuestion += 1;
        sd.reactedKinds.push("ac_reached");
      } else if (sub.verdict !== "AC" && !sd.pendingReaction) {
        sd.pendingReaction = reactionForRun({ elapsedMs: e, reactedKinds: sd.reactedKinds });
      }
      await this.logEvent(id, e, sub.kind === "submit" ? "submit" : "run", {
        submissionId: sub.id,
        verdict: sub.verdict,
        passed: sub.passed,
        total: sub.total,
        language: sub.language,
        code: sub.code,
      });
      sd.lastCode = {
        language: sub.language,
        code: sub.code,
        hash: createHash("sha256").update(sub.code).digest("hex"),
      };

      // follow the automatic transitions (CODING -> TESTING -> OPTIMIZE) until the machine settles
      let state = s.state;
      for (let hop = 0; hop < 3; hop++) {
        const decision = decideNext(
          state,
          undefined,
          toFacts({ ...s, state, stateData: sd }, now, sd),
        );
        if (decision.state === state || !decision.forced) break;
        state = decision.state;
        sd.stateEnteredMs = e;
        sd.turnsInState = 0;
        sd.candidateDone = false;
      }
      await this.save(this.ctx.db, id, { state, stateData: sd });
      this.publishState(await this.getSession(id));
      if (firstAc && prevState !== "OPTIMIZE") {
        // acknowledge the accepted solution right away (doc 03 I6)
        await this.runTurn(
          id,
          { kind: "timer", note: REACTION_NOTE.ac_reached },
          { proactive: "ac_reached" },
        );
      }
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ the turn

  private async problemContext(s: SessionRow): Promise<ProblemContext> {
    const cached = this.problemCache.get(s.id);
    if (cached) return cached;
    const c = await loadProblemContext(this.ctx.db, readPlan(s));
    this.problemCache.set(s.id, c);
    return c;
  }

  private async buildRequest(
    s: SessionRow,
    sd: StateData,
    event: TurnEvent,
    state: InterviewState,
    note: string | undefined,
    regen: string | undefined,
  ) {
    const plan = readPlan(s);
    const template = getTemplate(s.templateKey)!;
    const persona = (PERSONAS as readonly string[]).includes(s.persona)
      ? (s.persona as Persona)
      : "neutral";
    const now = this.ctx.now();
    const e = elapsedMs(s, now);
    const policy = computePolicy({
      type: template.type,
      persona,
      state,
      hintBudget: s.hintBudget,
      hintsGiven: s.hintsGiven,
      hintsOnQuestion: sd.hintsOnQuestion,
    });
    const pc = await this.problemContext(s);
    const parsed = await loadResumeParsed(this.ctx.db, s.resumeId);
    const turns = await loadTurns(this.ctx.db, s.id);
    // the candidate's current message is part of the turn message, not of the history
    const history = event.kind === "candidate" ? turns.slice(0, -1) : turns;
    const recent = history.filter((t) => t.speaker !== "system").slice(-HISTORY_TURNS);

    const messages: LlmMessage[] = [];
    const push = (role: "user" | "assistant", content: string) => {
      const last = messages[messages.length - 1];
      if (last && last.role === role) last.content += `\n${content}`;
      else messages.push({ role, content });
    };
    for (const t of recent) {
      push(
        t.speaker === "interviewer" ? "assistant" : "user",
        t.speaker === "interviewer"
          ? t.interruptedAfter !== undefined
            ? `${t.interruptedAfter || "(nothing)"} [interrupted: the candidate heard only this part]`
            : t.text
          : `<candidate_message>${t.text}</candidate_message>`,
      );
    }
    if (messages[0]?.role === "assistant")
      messages.unshift({ role: "user", content: "(The interview has begun.)" });

    const q = plan.questions[Math.min(sd.questionIndex, plan.questions.length - 1)] as
      PlannedQuestion | undefined;
    const chunks =
      q && q.kind !== "problem" && s.resumeId
        ? await resumeContext(
            this.ctx.db,
            s.resumeId,
            q.sourceRef,
            `${q.question} ${event.kind === "candidate" ? event.text : ""}`,
          )
        : [];
    const code =
      template.usesEditor &&
      sd.lastCode &&
      ["CODING", "TESTING", "OPTIMIZE", "FOLLOWUP"].includes(state)
        ? sd.lastCode.code.split("\n").slice(0, 150).join("\n")
        : null;
    const keys = plan.questions.map((x) => x.segmentKey);
    const extra = [...(note ? [`note=${note}`] : []), ...(sd.nudge ? [`nudge=${sd.nudge}`] : [])];
    const turnMessage = buildTurnMessage({
      event,
      signals: {
        state,
        segment: segmentKeyFor(state, sd.questionIndex, keys),
        elapsedMin: e / 60_000,
        remainingMin: Math.max(0, plannedMs(s) - e) / 60_000,
        hintsLeft: policy.hintsLeft,
        hintsUsed: s.hintsGiven,
        questionIndex: sd.questionIndex,
        questionCount: plan.questions.length,
        idleSeconds: Math.round(Math.max(0, e - sd.lastActivityMs) / 1000),
        lastRun: sd.lastRun,
        maxWords: policy.maxWords,
        extra,
      },
      resumeChunks: chunks,
      memory: plan.callbacks ?? [],
      summary: s.rollingSummary,
      code,
    });
    push("user", regen ? `${turnMessage}\n${regen}` : turnMessage);

    const jdText = s.jdId ? await this.jdPoints(s.jdId) : null;
    return {
      policy,
      references: pc.references,
      request: {
        task: "interviewer_turn" as const,
        modelClass: "interviewer" as const,
        system: buildInterviewerSystem({
          interviewerName: NAMES[persona],
          type: template.type,
          persona,
          level: s.level,
          role: s.role,
          company: s.companyName,
          minutes: plan.minutes,
          hintBudget: s.hintBudget,
          interruptionLevel: s.interruptionLevel as "off" | "low" | "normal",
          voice: s.mode !== "text",
          packNotes: plan.style?.notes ?? null,
          followUpDepth: plan.style?.followUpDepth ?? 2,
        }),
        context: buildSessionFacts({
          questions: plan.questions,
          problems: pc.facts,
          candidateSummary: candidateSummary(parsed, s.level),
          jdPoints: jdText,
        }),
        messages,
        maxTokens: 700,
        effort: "low" as const,
        userId: s.userId,
        sessionId: s.id,
        promptVersion: PROMPT_VERSIONS.interviewer,
      },
    };
  }

  private async jdPoints(jdId: string): Promise<string | null> {
    const { rows } = await this.ctx.db.execute(
      sql`SELECT analysis FROM job_descriptions WHERE id = ${jdId}`,
    );
    const a = (rows[0] as { analysis?: { required?: string[] } } | undefined)?.analysis;
    return a?.required?.slice(0, 8).join("; ") ?? null;
  }

  /** One interviewer turn: generate, enforce the rules in code, advance the state machine, persist. */
  private async runTurn(
    sessionId: string,
    event: TurnEvent,
    opts: {
      note?: string;
      localAbuse?: boolean;
      asksHint?: boolean;
      proactive?: ReactionKind;
    } = {},
  ): Promise<{ replies: TurnOutcome[] }> {
    const replies: TurnOutcome[] = [];
    let s = await this.getSession(sessionId);
    if (s.endedAt) return { replies };
    const sd = readStateData(s);
    const template = getTemplate(s.templateKey)!;
    let turnId = newId();
    const started = Date.now();

    this.bus.publish(sessionId, { type: "interviewer.typing", on: true });
    let regen: string | undefined;
    let spoken = "";
    let control: Control = { intent: "followup", hint_level: 0, topic_tags: [], flags: [] };
    const clamps: string[] = [];
    let hintUsed = false;
    let tokens = { in: 0, out: 0 };
    let model = "";
    let regenerations = 0;
    let fellBack = false;

    try {
      for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
        const { policy, references, request } = await this.buildRequest(
          s,
          sd,
          event,
          s.state,
          opts.note,
          regen,
        );
        const filter = new ControlStreamFilter();
        const attemptId = newId();
        const result = await this.ctx.llm.text(request, {
          onReset: () =>
            this.bus.publish(sessionId, { type: "interviewer.retract", turnId: attemptId }),
          onDelta: (delta) => {
            const safe = filter.push(delta);
            if (safe)
              this.bus.publish(sessionId, {
                type: "interviewer.token",
                turnId: attemptId,
                delta: safe,
              });
          },
        });
        const tail = filter.finish();
        if (tail)
          this.bus.publish(sessionId, {
            type: "interviewer.token",
            turnId: attemptId,
            delta: tail,
          });
        tokens = {
          in: tokens.in + result.usage.inputTokens,
          out: tokens.out + result.usage.outputTokens,
        };
        model = result.model;
        const parsed = parseReply(result.text);
        const validated = validateControl(parsed.control, policy);
        const leak = checkSolutionLeak(parsed.spoken, references);
        const style = styleFlags(parsed.spoken, policy);
        const broken = validated.needsRegen || leak.leaked || !parsed.spoken || result.refused;
        if (broken && attempt < MAX_REGENERATIONS) {
          // streamed text is retracted before the corrected reply (doc 13 §3)
          this.bus.publish(sessionId, { type: "interviewer.retract", turnId: attemptId });
          regenerations++;
          regen = validated.needsRegen
            ? REGENERATE_NOTES.hint
            : leak.leaked
              ? REGENERATE_NOTES.leak
              : REGENERATE_NOTES.control;
          clamps.push(...validated.clamps, ...(leak.leaked ? [`leak_${leak.reason}`] : []));
          continue;
        }
        if (broken) {
          this.bus.publish(sessionId, { type: "interviewer.retract", turnId: attemptId });
          spoken = SAFE_REPLY;
          control = {
            intent: "followup",
            hint_level: 0,
            topic_tags: [],
            flags: validated.control.flags,
          };
          clamps.push(...validated.clamps, "fallback_reply");
          fellBack = true;
          turnId = newId();
          this.bus.publish(sessionId, { type: "interviewer.token", turnId, delta: SAFE_REPLY });
        } else {
          spoken = parsed.spoken;
          control = validated.control;
          hintUsed = validated.hintUsed;
          clamps.push(...validated.clamps, ...style);
          turnId = attemptId; // the id the client already saw the tokens under
        }
        break;
      }
    } finally {
      this.bus.publish(sessionId, { type: "interviewer.typing", on: false });
    }

    // ----- apply the reply to the session (all rules in code)
    const now = this.ctx.now();
    const e = elapsedMs(s, now);
    s = await this.getSession(sessionId); // may have moved while generating
    if (s.endedAt) return { replies };
    const sd2 = readStateData(s);
    const flags = new Set(control.flags);
    const abusive = Boolean(opts.localAbuse) || flags.has("abusive");
    if (abusive) sd2.abuseCount += 1;
    if (flags.has("approach_stated")) sd2.approachStated = true;
    if (flags.has("candidate_done")) sd2.candidateDone = true;
    if (hintUsed) {
      sd2.hintsOnQuestion += 1;
      const q = sd2.questions[sd2.questionIndex];
      if (q) q.hints += 1;
    }
    sd2.nudge = null;
    sd2.lastActivityMs = e;

    // only a reply to the candidate may propose a move; greetings, presentations and nudges do not
    const proposal = event.kind === "candidate" && !abusive ? control.next_state : undefined;
    const before = s.state;
    const decision = decideNext(before, proposal, toFacts(s, now, sd2));
    let nextState = decision.state;
    let plan = readPlan(s);
    let advanced = false;
    if (decision.nudge) sd2.nudge = decision.nudge;

    if (decision.nextQuestion) {
      advanced = true;
      const prev = sd2.questions[sd2.questionIndex];
      const budget = plan.segments.find(
        (x) => x.key === plan.questions[sd2.questionIndex]?.segmentKey,
      );
      if (prev) {
        prev.endMs = e;
        if (s.adaptive && template.type === "dsa") {
          const sc = questionScore({
            solved: prev.solved,
            hintsUsed: prev.hints,
            usedMs: e - prev.startMs,
            budgetMs: budget ? budget.endMs - budget.startMs : 20 * 60_000,
          });
          sd2.difficulty = nextDifficulty(sd2.difficulty, sc, {
            min: Math.max(1, s.difficulty - 1),
            max: Math.min(5, s.difficulty + 1),
          });
        }
      }
      sd2.questionIndex += 1;
      sd2.questions.push({
        index: sd2.questionIndex,
        startMs: e,
        endMs: null,
        hints: 0,
        solved: false,
        runs: 0,
      });
      sd2.hintsOnQuestion = 0;
      sd2.reactionsOnQuestion = 0;
      sd2.reactedKinds = [];
      sd2.pendingReaction = null;
      sd2.starterLen = null;
      sd2.lastCodeChangeMs = null;
      sd2.approachStated = false;
      sd2.hasRun = false;
      sd2.ac = false;
      sd2.lastRun = null;
      sd2.lastCode = null;
      if (s.adaptive && template.type === "dsa") {
        const swapped = await repickProblem(
          this.ctx,
          s.userId,
          plan,
          sd2.questionIndex,
          Math.round(sd2.difficulty),
        );
        if (swapped) {
          plan = {
            ...plan,
            questions: plan.questions.map((x, i) => (i === sd2.questionIndex ? swapped : x)),
          };
          this.problemCache.delete(s.id);
        }
      }
    }
    if (nextState !== before) {
      sd2.stateEnteredMs = e;
      sd2.turnsInState = 0;
      sd2.candidateDone = false;
    }
    if (
      before === "PROBLEM" &&
      event.kind === "present" &&
      sd2.questionIndex === 0 &&
      sd2.questions[0]
    ) {
      sd2.questions[0].startMs = e;
    }

    // closing rules
    let finishReason: string | null = null;
    if (sd2.abuseCount >= ABUSE_LIMIT) finishReason = "abuse";
    else if (decision.state === "ENDING" && decision.forced) finishReason = "timer";
    else if (
      before === "WRAPUP" &&
      event.kind === "candidate" &&
      ((control.intent === "close" && sd2.turnsInState >= 1) || sd2.turnsInState >= 3)
    ) {
      finishReason = "completed";
    }
    if (finishReason) nextState = "ENDING";

    const meta = {
      intent: control.intent,
      hint_level: control.hint_level,
      flags: control.flags,
      topic_tags: control.topic_tags,
      state_before: before,
      state_after: nextState,
      reason: decision.reason,
      clamps,
      regenerations,
      fell_back: fellBack,
      model,
      tokens,
      latency_ms: Date.now() - started,
      prompt_version: PROMPT_VERSIONS.interviewer,
      event: event.kind,
      proactive: opts.proactive ?? null,
    };
    const seq = await withTransaction(this.ctx.db, async (tx) => {
      const n = await this.insertTurn(sessionId, "interviewer", spoken, e, {
        meta,
        id: turnId,
        db: tx,
      });
      await this.save(tx, sessionId, {
        state: nextState,
        stateData: sd2,
        plan,
        hintsGiven: s.hintsGiven + (hintUsed ? 1 : 0),
        promptVersion: `interviewer@${PROMPT_VERSIONS.interviewer},scorecard@${PROMPT_VERSIONS.scorecard}`,
      });
      return n;
    });
    this.ctx.log.info(
      {
        sessionId,
        seq,
        intent: control.intent,
        clamps,
        tokens,
        ms: meta.latency_ms,
        state: nextState,
      },
      "interview turn",
    );

    this.bus.publish(sessionId, {
      type: "interviewer.message",
      turnId,
      seq,
      text: spoken,
      offsetMs: e,
      meta: { intent: control.intent, hintLevel: control.hint_level, hintUsed },
    });
    if (hintUsed) {
      const left = Math.max(0, s.hintBudget - (s.hintsGiven + 1));
      this.bus.publish(sessionId, {
        type: "system.notice",
        code: "hint_given",
        text: `Hint used. ${left} left.`,
      });
    }
    replies.push({ seq, turnId, text: spoken, intent: control.intent, hintUsed, state: nextState });
    this.publishState(await this.getSession(sessionId));

    if (finishReason) {
      await this.finish(await this.getSession(sessionId), finishReason);
      return { replies };
    }
    // follow-up turns that need no candidate input
    if (event.kind !== "present" && nextState === "PROBLEM") {
      const more = await this.runTurn(sessionId, { kind: "present" });
      replies.push(...more.replies);
    } else if (nextState === "WRAPUP" && before !== "WRAPUP" && !opts.note) {
      const more = await this.runTurn(sessionId, { kind: "wrapup" });
      replies.push(...more.replies);
    }
    if (advanced) this.problemCache.delete(sessionId);
    void this.maybeSummarize(sessionId);
    return { replies };
  }

  // ------------------------------------------------------------------ summary

  private async maybeSummarize(sessionId: string) {
    this.ctx.jobs.run(`summary:${sessionId}`, async () => {
      const s = await this.getSession(sessionId);
      const sd = readStateData(s);
      const turns = await loadTurns(this.ctx.db, sessionId);
      const cutoff = turns.length - HISTORY_TURNS;
      if (cutoff < SUMMARY_EVERY || cutoff - sd.summaryUpTo < SUMMARY_EVERY) return;
      const slice = turns.filter(
        (t) => t.seq > sd.summaryUpTo && t.seq <= (turns[cutoff - 1]?.seq ?? 0),
      );
      const { buildSummaryPrompt, SUMMARY_SYSTEM } = await import("@prepquest/prompts");
      const res = await this.ctx.llm.text({
        task: "summary",
        modelClass: "light",
        system: SUMMARY_SYSTEM,
        messages: [{ role: "user", content: buildSummaryPrompt(s.rollingSummary, slice) }],
        maxTokens: 400,
        effort: "low",
        userId: s.userId,
        sessionId,
        promptVersion: PROMPT_VERSIONS.summary,
      });
      sd.summaryUpTo = slice.at(-1)?.seq ?? sd.summaryUpTo;
      await this.save(this.ctx.db, sessionId, {
        rollingSummary: res.text.trim().slice(0, 1500),
        stateData: sd,
      });
    });
  }

  // ------------------------------------------------------------------ finishing

  /** Ends the session (idempotent), stores what the next session needs, and queues the scorecard. */
  private async finish(s: SessionRow, reason: string): Promise<SessionRow> {
    if (s.endedAt) return s;
    const now = this.ctx.now();
    const e = Math.min(elapsedMs(s, now), plannedMs(s));
    const turns = await loadTurns(this.ctx.db, s.id);
    const candidateTurns = turns.filter((t) => t.speaker === "candidate").length;
    const lastInterviewer = [...turns].reverse().find((t) => t.speaker === "interviewer");
    const closed = s.state === "WRAPUP" || s.state === "ENDING";
    if (
      (reason === "timer" || reason === "user") &&
      candidateTurns > 0 &&
      !closed &&
      lastInterviewer
    ) {
      const seq = await this.insertTurn(s.id, "interviewer", CLOSING_LINE, e, {
        meta: { canned: true, reason },
      });
      this.bus.publish(s.id, {
        type: "interviewer.message",
        turnId: newId(),
        seq,
        text: CLOSING_LINE,
        offsetMs: e,
        meta: { canned: true },
      });
    }
    const sd = readStateData(s);
    const open = sd.questions[sd.questionIndex];
    if (open && open.endMs === null) open.endMs = e;
    const abandoned = candidateTurns === 0;
    const finalState: InterviewState = abandoned ? "ABANDONED" : "COMPLETED";
    const rubric = getRubric(getTemplate(s.templateKey)?.rubricId ?? "coding");
    await withTransaction(this.ctx.db, async (tx) => {
      const done = await tx
        .update(interviewSessions)
        .set({
          state: finalState,
          stateData: sd,
          endedAt: now,
          pausedAt: null,
          endReason: abandoned ? "abandoned" : reason,
        })
        .where(and(eq(interviewSessions.id, s.id), isNull(interviewSessions.endedAt)))
        .returning({ id: interviewSessions.id });
      if (done.length === 0) return; // lost a race with another finisher
      if (!abandoned && rubric) {
        await tx
          .insert(interviewScorecards)
          .values({
            id: newId(),
            sessionId: s.id,
            rubricId: rubric.id,
            rubricVersion: rubric.version,
            status: "generating",
          })
          .onConflictDoNothing();
      }
      const plan = readPlan(s);
      const asked = plan.questions.slice(0, sd.questionIndex + 1);
      for (const [i, q] of asked.entries()) {
        const log = sd.questions[i];
        if (!log || (i === sd.questionIndex && candidateTurns === 0)) continue;
        // problems are judged now; spoken questions are marked weak later, by the review jobs
        await tx
          .insert(questionMemory)
          .values(
            memoryValues(
              s.userId,
              s.id,
              q,
              log.solved ? 1 : 0,
              q.kind === "problem" ? !log.solved || log.hints > 0 : false,
            ),
          );
      }
    });
    this.problemCache.delete(s.id);
    const fresh = await this.getSession(s.id);
    this.bus.publish(s.id, {
      type: "session.ended",
      reason: fresh.endReason ?? reason,
      scorecardStatus: abandoned ? "none" : "generating",
    });
    this.publishState(fresh);
    if (!abandoned) {
      this.ctx.jobs.run(`scorecard:${s.id}`, () => generateScorecard(this.ctx, this.bus, s.id));
    }
    return fresh;
  }

  // ------------------------------------------------------------------ timers

  /** Called every few seconds: ends expired sessions, sends warnings and ticks, nudges silence. */
  async sweep(): Promise<void> {
    const now = this.ctx.now();
    const rows = await this.ctx.db
      .select()
      .from(interviewSessions)
      .where(
        and(sql`${interviewSessions.startedAt} IS NOT NULL`, isNull(interviewSessions.endedAt)),
      );
    for (const row of rows) {
      try {
        await this.sweepOne(row, now);
      } catch (err) {
        this.ctx.log.error({ err, sessionId: row.id }, "interview sweep failed");
      }
    }
    // retry scorecards that never finished (process crash, transient model failure)
    const stuck = await this.ctx.db
      .select({ sessionId: interviewScorecards.sessionId })
      .from(interviewScorecards)
      .where(
        and(
          eq(interviewScorecards.status, "generating"),
          sql`${interviewScorecards.attempts} < 3`,
          sql`${interviewScorecards.updatedAt} < ${new Date(now.getTime() - 120_000)}`,
        ),
      )
      .orderBy(desc(interviewScorecards.updatedAt))
      .limit(5);
    const unfinished = await this.ctx.db
      .select({ sessionId: interviewScorecards.sessionId })
      .from(interviewScorecards)
      .where(
        and(
          eq(interviewScorecards.status, "ready"),
          sql`${interviewScorecards.extrasStatus} IN ('pending', 'running')`,
          sql`${interviewScorecards.extrasAttempts} < 3`,
          sql`${interviewScorecards.updatedAt} < ${new Date(now.getTime() - 120_000)}`,
        ),
      )
      .limit(5);
    for (const r of unfinished) {
      this.ctx.jobs.run(`extras:${r.sessionId}`, () =>
        generateExtras(this.ctx, this.bus, r.sessionId),
      );
    }
    for (const r of stuck) {
      this.ctx.jobs.run(`scorecard:${r.sessionId}`, () =>
        generateScorecard(this.ctx, this.bus, r.sessionId),
      );
    }
  }

  private async sweepOne(row: SessionRow, now: Date) {
    if (row.pausedAt && now.getTime() - row.pausedAt.getTime() >= MAX_PAUSE_MS) {
      await this.serial(row.id, async () => {
        const fresh = await this.getSession(row.id);
        if (fresh.pausedAt && !fresh.endedAt) await this.resumeNow(fresh);
      });
      return;
    }
    if (row.pausedAt) return;
    const remaining = remainingMsOf(row, now);
    if (remaining <= 0) {
      await this.serial(row.id, async () => {
        const fresh = await this.getSession(row.id);
        if (!fresh.endedAt) await this.finish(fresh, "timer");
      });
      return;
    }
    const sd = readStateData(row);
    const planned = plannedMs(row);
    const due = WARNING_THRESHOLDS.filter(
      (w) => w.ms < planned && remaining <= w.ms && !sd.warningsSent.includes(w.key),
    );
    const lastTick = this.lastTick.get(row.id) ?? 0;
    if (due.length > 0) {
      sd.warningsSent.push(...due.map((w) => w.key));
      await this.save(this.ctx.db, row.id, { stateData: sd });
      const k = due[due.length - 1]!.key;
      this.bus.publish(row.id, { type: "timer.tick", remainingMs: remaining, warning: k });
      this.bus.publish(row.id, {
        type: "system.notice",
        code: `time_${k}`,
        text: k === "1m" ? "One minute left." : `${k === "10m" ? "10" : "5"} minutes left.`,
      });
      this.lastTick.set(row.id, now.getTime());
    } else if (now.getTime() - lastTick >= 10_000) {
      this.bus.publish(row.id, { type: "timer.tick", remainingMs: remaining });
      this.lastTick.set(row.id, now.getTime());
    }
    await this.maybeReact(row, now);
    await this.maybeIdlePrompt(row, now);
  }

  /**
   * Proactive reactions to the candidate's coding (doc 03 I6): due reactions wait for the cooldown and
   * for the typing to stop, a small model decides whether speaking is worth it, and the interviewer
   * phrases it. Everything about when and how often is rules, not the model's call.
   */
  private async maybeReact(row: SessionRow, now: Date) {
    if (this.busy(row.id) || !getTemplate(row.templateKey)?.usesEditor) return;
    const sd = readStateData(row);
    const e = elapsedMs(row, now);
    const persona = (PERSONAS as readonly string[]).includes(row.persona)
      ? (row.persona as Persona)
      : "neutral";
    let pending = sd.pendingReaction;
    if (
      !pending &&
      idleCodingDue({
        state: row.state,
        persona,
        elapsedMs: e,
        lastActivityMs: sd.lastActivityMs,
        reactedKinds: sd.reactedKinds,
      })
    ) {
      pending = { kind: "idle_coding", dueMs: e };
    }
    if (!pending || pending.dueMs > e) return;

    const stillRelevant =
      pending.kind === "no_approach_before_code"
        ? row.state === "CLARIFY" || row.state === "APPROACH"
        : pending.kind === "run_failed"
          ? (row.state === "CODING" || row.state === "TESTING") && !sd.ac
          : row.state === "CODING";
    if (!stillRelevant || e - pending.dueMs > 180_000) {
      if (sd.pendingReaction) {
        sd.pendingReaction = null;
        await this.save(this.ctx.db, row.id, { stateData: sd });
      }
      return;
    }
    const gate = mayReact({
      state: row.state,
      persona,
      interruptionsOff: row.interruptionLevel === "off",
      elapsedMs: e,
      lastProactiveMs: sd.lastProactiveMs,
      lastCodeChangeMs: sd.lastCodeChangeMs,
      // "rarely" allows half as many
      reactionsOnQuestion:
        row.interruptionLevel === "low" ? sd.reactionsOnQuestion * 2 : sd.reactionsOnQuestion,
      reactedKinds: sd.reactedKinds,
    });
    if (!gate.ok) return; // due, but not now: the next sweep tries again

    const kind = pending.kind;
    await this.serial(row.id, async () => {
      const s = await this.getSession(row.id);
      if (s.endedAt || s.pausedAt) return;
      const sd2 = readStateData(s);
      const at = elapsedMs(s, this.ctx.now());
      const speak = await this.shouldSpeak(s, kind, at);
      sd2.pendingReaction = null;
      sd2.reactedKinds.push(kind); // asked once, spoken or not: never retried for this question
      if (speak) {
        sd2.lastProactiveMs = at;
        sd2.lastActivityMs = at;
        sd2.reactionsOnQuestion += 1;
      }
      await this.save(this.ctx.db, s.id, { stateData: sd2 });
      if (speak) {
        await this.runTurn(s.id, { kind: "timer", note: REACTION_NOTE[kind] }, { proactive: kind });
      }
    });
  }

  /** The small classifier: any failure means "speak", because the rules above already gated it. */
  private async shouldSpeak(s: SessionRow, kind: ReactionKind, at: number): Promise<boolean> {
    try {
      const turns = (await loadTurns(this.ctx.db, s.id)).slice(-4);
      const lastInterviewer = [...turns].reverse().find((t) => t.speaker === "interviewer");
      const { value } = await this.ctx.llm.json(
        {
          task: "reaction",
          modelClass: "light",
          system: REACTION_SYSTEM,
          messages: [
            {
              role: "user",
              content: buildReactionPrompt({
                trigger: kind,
                note: REACTION_NOTE[kind],
                recent: turns,
                minutesSinceInterviewerSpoke: lastInterviewer
                  ? Math.max(0, at - lastInterviewer.offsetMs) / 60_000
                  : at / 60_000,
              }),
            },
          ],
          maxTokens: 120,
          effort: "low",
          userId: s.userId,
          sessionId: s.id,
          promptVersion: PROMPT_VERSIONS.reaction,
        },
        reactionDecisionSchema,
        { maxRepairs: 0 },
      );
      return value.speak;
    } catch {
      return true;
    }
  }

  /** Silence after the interviewer spoke: one gentle prompt, at most twice per question (doc 03 I4). */
  private async maybeIdlePrompt(row: SessionRow, now: Date) {
    if (this.busy(row.id)) return;
    const sd = readStateData(row);
    const persona = (PERSONAS as readonly string[]).includes(row.persona)
      ? (row.persona as Persona)
      : "neutral";
    const idleMs = elapsedMs(row, now) - sd.lastActivityMs;
    if (!IDLE_STATES.includes(row.state) || sd.idlePrompts >= 2 || idleMs < IDLE_MS[persona])
      return;
    await this.serial(row.id, async () => {
      const s = await this.getSession(row.id);
      if (s.endedAt || s.pausedAt) return;
      const sd2 = readStateData(s);
      sd2.idlePrompts += 1;
      sd2.lastActivityMs = elapsedMs(s, this.ctx.now());
      await this.save(this.ctx.db, s.id, { stateData: sd2 });
      await this.runTurn(s.id, {
        kind: "timer",
        note: `The candidate has been silent for about ${Math.round(idleMs / 1000)} seconds. Gently prompt them, for example "Take your time, what are you thinking?"`,
      });
    });
  }

  async regenerateExtras(sessionId: string) {
    await generateExtras(this.ctx, this.bus, sessionId);
  }

  async regenerateScorecard(sessionId: string) {
    await generateScorecard(this.ctx, this.bus, sessionId);
  }

  /** Restores a session view for a reconnecting client. */
  async snapshot(userId: string, id: string) {
    const s = await this.getSession(id, userId);
    const turns = await this.ctx.db
      .select()
      .from(interviewTurns)
      .where(eq(interviewTurns.sessionId, id))
      .orderBy(asc(interviewTurns.seq));
    return { session: s, turns, state: this.stateEvent(s) };
  }
}
