import { and, desc, eq, sql } from "drizzle-orm";
import {
  jobDescriptions,
  newId,
  resumeChunks,
  resumes,
  withTransaction,
  type Database,
  type Db,
} from "@prepquest/db";
import {
  AppError,
  RESUME_MAX_BYTES,
  RESUME_MIMES,
  jdAnalysisSchema,
  jdGapSchema,
  resumeParsedSchema,
  type CreateJdInput,
  type JdDto,
  type ResumeDto,
  type JdAnalysis,
  type JdGap,
  type ResumeParsed,
  type UpdateParsedResumeInput,
} from "@prepquest/shared";
import {
  PROMPT_VERSIONS,
  JD_SYSTEM,
  RESUME_PARSE_SYSTEM,
  buildJdPrompt,
  buildResumeParsePrompt,
} from "@prepquest/prompts";
import { z } from "zod";
import { embedText } from "../../lib/embeddings.js";
import { assertEnoughText, extractResumeText, sniffResumeMime } from "../../lib/extract-text.js";
import { LlmValidationError } from "../../lib/llm/index.js";
import type { AiContext } from "../ai-context.js";

export const MAX_RESUMES_PER_USER = 10;
const MAX_TEXT_CHARS = 40_000;

type ResumeRow = typeof resumes.$inferSelect;

export function toResumeDto(r: ResumeRow): ResumeDto {
  return {
    id: r.id,
    label: r.label,
    mime: r.mime,
    bytes: r.bytes,
    status: r.status as ResumeDto["status"],
    parseError: r.parseError,
    parsed: (r.parsed as ResumeParsed | null) ?? null,
    claims: r.claims ?? null,
    isDefault: r.isDefault,
    confirmedAt: r.userConfirmedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function getOwnedResume(db: Database, userId: string, id: string): Promise<ResumeRow> {
  const [row] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, id), eq(resumes.userId, userId)));
  if (!row) throw new AppError("NOT_FOUND", 404, "Resume not found");
  return row;
}

export async function listResumes(db: Database, userId: string) {
  const rows = await db
    .select()
    .from(resumes)
    .where(eq(resumes.userId, userId))
    .orderBy(desc(resumes.createdAt));
  return rows.map(toResumeDto);
}

export async function uploadResume(
  ctx: AiContext,
  userId: string,
  file: { buffer: Buffer; filename: string; declaredMime: string },
  label?: string,
) {
  await ctx.limiter.enforce(
    `resume-upload:${userId}`,
    ctx.env.RL_RESUMES_PER_DAY,
    86_400,
    "resume uploads",
  );
  if (file.buffer.length === 0) throw new AppError("VALIDATION_FAILED", 422, "The file is empty");
  if (file.buffer.length > RESUME_MAX_BYTES) {
    throw new AppError("VALIDATION_FAILED", 422, "The file is larger than 5 MB");
  }
  const mime = sniffResumeMime(file.buffer);
  if (
    !mime ||
    !(RESUME_MIMES as readonly string[]).includes(file.declaredMime) ||
    mime !== file.declaredMime
  ) {
    throw new AppError("VALIDATION_FAILED", 422, "Upload a PDF or DOCX file");
  }
  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(resumes)
    .where(eq(resumes.userId, userId));
  if (n >= MAX_RESUMES_PER_USER) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      429,
      `You can keep up to ${MAX_RESUMES_PER_USER} resumes. Delete one first.`,
    );
  }
  const id = newId();
  const fileKey = `resumes/${userId}/${id}`;
  await ctx.store.put(fileKey, file.buffer, mime);
  const name =
    (label ?? file.filename)
      .replace(/\.[a-z0-9]+$/i, "")
      .trim()
      .slice(0, 80) || "Resume";
  const [row] = await ctx.db
    .insert(resumes)
    .values({
      id,
      userId,
      label: name,
      fileKey,
      mime,
      bytes: file.buffer.length,
      status: "parsing",
    })
    .returning();
  ctx.jobs.run(`parse-resume:${id}`, () => parseResumeJob(ctx, id));
  return toResumeDto(row!);
}

/** Text extraction, then LLM extraction into `ResumeParsed`. Leaves the resume in `needs_review` for the user. */
export async function parseResumeJob(ctx: AiContext, resumeId: string): Promise<void> {
  const [row] = await ctx.db.select().from(resumes).where(eq(resumes.id, resumeId));
  if (!row) return;
  const fail = async (message: string) => {
    await ctx.db
      .update(resumes)
      .set({ status: "failed", parseError: message })
      .where(eq(resumes.id, resumeId));
  };
  try {
    await ctx.db
      .update(resumes)
      .set({ status: "parsing", parseError: null })
      .where(eq(resumes.id, resumeId));
    const buffer = await ctx.store.get(row.fileKey);
    const text = (await extractResumeText(buffer, row.mime)).slice(0, MAX_TEXT_CHARS);
    assertEnoughText(text);
    const { value } = await ctx.llm.json(
      {
        task: "resume_parse",
        modelClass: "light",
        system: RESUME_PARSE_SYSTEM,
        messages: [{ role: "user", content: buildResumeParsePrompt(text) }],
        maxTokens: 6000,
        effort: "low",
        userId: row.userId,
        promptVersion: PROMPT_VERSIONS.resumeParse,
      },
      resumeParsedSchema,
    );
    await ctx.db
      .update(resumes)
      .set({ status: "needs_review", parsed: value, claims: value.claims, parseError: null })
      .where(eq(resumes.id, resumeId));
  } catch (err) {
    if (err instanceof AppError && err.code === "RESUME_UNREADABLE") await fail(err.message);
    else if (err instanceof LlmValidationError)
      await fail("We couldn't understand the structure of this resume. Try another file.");
    else if (err instanceof AppError) await fail(err.message);
    else {
      ctx.log.error({ err, resumeId }, "resume parsing failed");
      await fail("Parsing failed. Please retry.");
    }
  }
}

export async function retryParse(ctx: AiContext, userId: string, id: string) {
  const row = await getOwnedResume(ctx.db, userId, id);
  if (row.status !== "failed")
    throw new AppError("CONFLICT", 409, "Only failed resumes can be retried");
  await ctx.db
    .update(resumes)
    .set({ status: "parsing", parseError: null })
    .where(eq(resumes.id, id));
  ctx.jobs.run(`parse-resume:${id}`, () => parseResumeJob(ctx, id));
  return toResumeDto({ ...row, status: "parsing", parseError: null });
}

// --- chunks (retrieval) ---------------------------------------------------------------------

export interface ChunkSpec {
  section: string;
  ref: string;
  text: string;
}

export function chunksFromParsed(p: ResumeParsed): ChunkSpec[] {
  const out: ChunkSpec[] = [];
  p.projects.forEach((x, i) =>
    out.push({
      section: "projects",
      ref: `projects[${i}]`,
      text: `Project ${x.name}. ${x.summary} Tech: ${x.tech.join(", ")}. ${x.bullets.join(" ")} ${x.metrics.join(", ")}`.trim(),
    }),
  );
  p.experience.forEach((x, i) =>
    out.push({
      section: "experience",
      ref: `experience[${i}]`,
      text: `${x.role ?? "Role"} at ${x.company}. ${x.bullets.join(" ")} Tech: ${x.tech.join(", ")}`.trim(),
    }),
  );
  const skills = Object.values(p.skills).flat();
  if (skills.length > 0)
    out.push({ section: "skills", ref: "skills", text: `Skills: ${skills.join(", ")}` });
  if (p.achievements.length > 0)
    out.push({ section: "achievements", ref: "achievements", text: p.achievements.join(" ") });
  return out.filter((c) => c.text.length > 10);
}

async function rebuildChunks(tx: Db, resumeId: string, parsed: ResumeParsed) {
  await tx.delete(resumeChunks).where(eq(resumeChunks.resumeId, resumeId));
  const specs = chunksFromParsed(parsed);
  if (specs.length === 0) return;
  await tx.insert(resumeChunks).values(
    specs.map((c) => ({
      id: newId(),
      resumeId,
      section: c.section,
      ref: c.ref,
      text: c.text,
      embedding: embedText(c.text),
    })),
  );
}

export async function updateParsed(
  db: Database,
  userId: string,
  id: string,
  input: UpdateParsedResumeInput,
) {
  const row = await getOwnedResume(db, userId, id);
  if (row.status === "parsing" || row.status === "uploaded" || row.status === "failed") {
    throw new AppError("CONFLICT", 409, "This resume isn't ready to edit yet");
  }
  const updated = await withTransaction(db, async (tx) => {
    const [r] = await tx
      .update(resumes)
      .set({
        parsed: input.parsed,
        claims: input.parsed.claims,
        ...(input.label ? { label: input.label } : {}),
        ...(input.confirm ? { status: "ready", userConfirmedAt: new Date() } : {}),
      })
      .where(eq(resumes.id, id))
      .returning();
    await rebuildChunks(tx, id, input.parsed);
    if (input.confirm) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(resumes)
        .where(and(eq(resumes.userId, userId), eq(resumes.isDefault, true)));
      if (n === 0) await tx.update(resumes).set({ isDefault: true }).where(eq(resumes.id, id));
    }
    const [fresh] = await tx.select().from(resumes).where(eq(resumes.id, id));
    return fresh ?? r!;
  });
  return toResumeDto(updated);
}

export async function setDefault(db: Database, userId: string, id: string) {
  const row = await getOwnedResume(db, userId, id);
  if (row.status !== "ready")
    throw new AppError("CONFLICT", 409, "Review and confirm the resume first");
  await withTransaction(db, async (tx) => {
    await tx
      .update(resumes)
      .set({ isDefault: false })
      .where(and(eq(resumes.userId, userId), eq(resumes.isDefault, true)));
    await tx.update(resumes).set({ isDefault: true }).where(eq(resumes.id, id));
  });
  return toResumeDto(await getOwnedResume(db, userId, id));
}

export async function deleteResume(ctx: AiContext, userId: string, id: string) {
  const row = await getOwnedResume(ctx.db, userId, id);
  await ctx.db.delete(resumes).where(eq(resumes.id, id)); // chunks cascade; sessions and JDs keep a null link
  await ctx.store.delete(row.fileKey).catch(() => undefined);
  if (row.isDefault) {
    const [next] = await ctx.db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.status, "ready")))
      .orderBy(desc(resumes.createdAt))
      .limit(1);
    if (next) await ctx.db.update(resumes).set({ isDefault: true }).where(eq(resumes.id, next.id));
  }
}

/** The chunks most relevant to `query`, nearest first (cosine distance in pgvector). */
export async function retrieveChunks(db: Database, resumeId: string, query: string, k = 3) {
  const vec = JSON.stringify(embedText(query));
  const rows = await db
    .select({ ref: resumeChunks.ref, text: resumeChunks.text })
    .from(resumeChunks)
    .where(eq(resumeChunks.resumeId, resumeId))
    .orderBy(sql`${resumeChunks.embedding} <=> ${vec}::vector`)
    .limit(k);
  return rows;
}

// --- job descriptions -----------------------------------------------------------------------

const jdResultSchema = z.object({ analysis: jdAnalysisSchema, gap: jdGapSchema });

type JdRow = typeof jobDescriptions.$inferSelect;
export function toJdDto(r: JdRow): JdDto {
  return {
    id: r.id,
    company: r.company,
    role: r.role,
    analysis: (r.analysis as JdAnalysis | null) ?? null,
    gap: (r.gap as JdGap | null) ?? null,
    resumeId: r.resumeId,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function createJd(ctx: AiContext, userId: string, input: CreateJdInput) {
  await ctx.limiter.enforce(`jd:${userId}`, 30, 86_400, "job description analyses");
  let resume: ResumeParsed | null = null;
  if (input.resumeId) {
    const r = await getOwnedResume(ctx.db, userId, input.resumeId);
    resume = (r.parsed as ResumeParsed | null) ?? null;
  }
  const { value } = await ctx.llm.json(
    {
      task: "jd_analysis",
      modelClass: "light",
      system: JD_SYSTEM,
      messages: [{ role: "user", content: buildJdPrompt(input.text, resume) }],
      maxTokens: 3000,
      effort: "low",
      userId,
      promptVersion: PROMPT_VERSIONS.jd,
    },
    jdResultSchema,
  );
  const [row] = await ctx.db
    .insert(jobDescriptions)
    .values({
      id: newId(),
      userId,
      company: input.company ?? null,
      role: input.role ?? null,
      rawText: input.text,
      analysis: value.analysis,
      gap: input.resumeId ? value.gap : null,
      resumeId: input.resumeId ?? null,
    })
    .returning();
  return toJdDto(row!);
}

export async function getJd(db: Database, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(jobDescriptions)
    .where(and(eq(jobDescriptions.id, id), eq(jobDescriptions.userId, userId)));
  if (!row) throw new AppError("NOT_FOUND", 404, "Job description not found");
  return row;
}

export async function listJds(db: Database, userId: string) {
  const rows = await db
    .select()
    .from(jobDescriptions)
    .where(eq(jobDescriptions.userId, userId))
    .orderBy(desc(jobDescriptions.createdAt))
    .limit(50);
  return rows.map(toJdDto);
}

export async function deleteJd(db: Database, userId: string, id: string) {
  await getJd(db, userId, id);
  await db.delete(jobDescriptions).where(eq(jobDescriptions.id, id));
}
