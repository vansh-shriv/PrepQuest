import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  editorials,
  interviewTurns,
  problems,
  resumeChunks,
  resumes,
  type Database,
} from "@prepquest/db";
import type { InterviewPlan, TranscriptTurn } from "@prepquest/interview-core";
import type { ProblemFacts } from "@prepquest/prompts";
import type { ResumeParsed } from "@prepquest/shared";
import { retrieveChunks } from "../resumes/service.js";

// Data the prompts need for a session, loaded once per turn (problem text is cached per session).

export interface ProblemContext {
  facts: Record<string, ProblemFacts>;
  /** Text the interviewer must never repeat: approaches and reference code. */
  references: string[];
}

export async function loadProblemContext(
  db: Database,
  plan: InterviewPlan,
): Promise<ProblemContext> {
  const ids = plan.questions.flatMap((q) => (q.kind === "problem" ? [q.problemId] : []));
  if (ids.length === 0) return { facts: {}, references: [] };
  const rows = await db
    .select({
      id: problems.id,
      title: problems.title,
      difficulty: problems.difficulty,
      statement: problems.statementMd,
      constraints: problems.constraintsMd,
      examples: problems.examples,
      approaches: editorials.approaches,
    })
    .from(problems)
    .leftJoin(editorials, eq(editorials.problemId, problems.id))
    .where(inArray(problems.id, ids));
  const facts: Record<string, ProblemFacts> = {};
  const references: string[] = [];
  for (const r of rows) {
    const approaches = r.approaches ?? [];
    const examples = r.examples
      .map((e) => `Example: input ${e.input} -> output ${e.output}`)
      .join("\n");
    facts[r.id] = {
      title: r.title,
      difficulty: r.difficulty,
      statementMd: [r.statement, r.constraints ?? "", examples].filter(Boolean).join("\n\n"),
      confidentialApproach: approaches
        .map(
          (a) =>
            `${a.name}: ${a.intuition} Steps: ${a.steps.join("; ")}. Time ${a.time}, space ${a.space}.${
              a.pitfalls?.length ? ` Pitfalls: ${a.pitfalls.join("; ")}.` : ""
            }`,
        )
        .join("\n"),
    };
    for (const a of approaches) {
      references.push(`${a.intuition} ${a.steps.join(" ")}`);
      references.push(...Object.values(a.code));
    }
  }
  return { facts, references };
}

/** A few lines the interviewer may use to speak about the candidate; no contact details. */
export function candidateSummary(parsed: ResumeParsed | null, level: string): string {
  if (!parsed) return `A ${level}-level candidate.`;
  const skills = Object.values(parsed.skills).flat().slice(0, 12).join(", ");
  const projects = parsed.projects
    .map((p) => p.name)
    .slice(0, 4)
    .join("; ");
  return `A ${level}-level candidate. Skills: ${skills || "n/a"}. Projects: ${projects || "n/a"}.`;
}

export async function loadResumeParsed(
  db: Database,
  resumeId: string | null,
): Promise<ResumeParsed | null> {
  if (!resumeId) return null;
  const [r] = await db
    .select({ parsed: resumes.parsed })
    .from(resumes)
    .where(eq(resumes.id, resumeId));
  return (r?.parsed as ResumeParsed | null) ?? null;
}

/** The chunk for the question's own resume item first, then the nearest others (doc 13 §4). */
export async function resumeContext(
  db: Database,
  resumeId: string | null,
  sourceRef: string,
  query: string,
): Promise<string[]> {
  if (!resumeId) return [];
  const [own] = await db
    .select({ ref: resumeChunks.ref, text: resumeChunks.text })
    .from(resumeChunks)
    .where(and(eq(resumeChunks.resumeId, resumeId), eq(resumeChunks.ref, sourceRef)));
  const near = await retrieveChunks(db, resumeId, query, 3);
  const out: string[] = [];
  for (const c of [own, ...near]) {
    if (c && !out.some((x) => x.startsWith(`[${c.ref}]`))) out.push(`[${c.ref}] ${c.text}`);
  }
  return out.slice(0, 3).map((t) => t.slice(0, 1500));
}

export async function loadTurns(
  db: Database,
  sessionId: string,
  upToSeq?: number,
): Promise<TranscriptTurn[]> {
  const rows = await db
    .select()
    .from(interviewTurns)
    .where(
      and(
        eq(interviewTurns.sessionId, sessionId),
        upToSeq !== undefined ? lte(interviewTurns.seq, upToSeq) : sql`true`,
      ),
    )
    .orderBy(asc(interviewTurns.seq));
  return rows.map((r) => ({
    seq: r.seq,
    speaker: r.speaker as TranscriptTurn["speaker"],
    text: r.text,
    offsetMs: r.offsetMs,
  }));
}
