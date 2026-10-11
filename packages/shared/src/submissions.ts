import { z } from "zod";
import type { SolveRewards } from "./practice.js";
import { LANGUAGE_VALUES, type LanguageValue } from "./problems.js";

/** Submission, history, bookmark and note contracts (doc 11 §3-4, features D3, U2, U3). */

export const MAX_SOURCE_BYTES = 64 * 1024;
export const MAX_CUSTOM_INPUT_BYTES = 256 * 1024;

export const VERDICT_VALUES = [
  "QUEUED",
  "COMPILING",
  "RUNNING",
  "AC",
  "WA",
  "TLE",
  "MLE",
  "RE",
  "CE",
  "OLE",
  "IE",
] as const;
export type VerdictValue = (typeof VERDICT_VALUES)[number];
export const TERMINAL_VERDICTS: readonly VerdictValue[] = [
  "AC",
  "WA",
  "TLE",
  "MLE",
  "RE",
  "CE",
  "OLE",
  "IE",
];
export const isTerminal = (v: VerdictValue) => TERMINAL_VERDICTS.includes(v);

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export const submissionCreateSchema = z
  .object({
    problemSlug: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .max(60),
    language: z.enum(LANGUAGE_VALUES),
    code: z
      .string()
      .min(1, "Write some code first")
      .refine((s) => byteLength(s) <= MAX_SOURCE_BYTES, { message: "Code is larger than 64 KB" }),
    kind: z.enum(["run", "submit"]),
    /** Saved custom tests to include in a run. */
    customTestIds: z.array(z.string().uuid()).max(20).default([]),
    /** Ad-hoc inputs for a run (not saved). */
    customInputs: z
      .array(
        z.string().refine((s) => byteLength(s) <= MAX_CUSTOM_INPUT_BYTES, {
          message: "Input is larger than 256 KB",
        }),
      )
      .max(5)
      .default([]),
    mode: z.enum(["practice", "interview"]).default("practice"),
    /** Required when `mode` is `interview`: the session the run belongs to. */
    interviewSessionId: z.string().uuid().optional(),
  })
  .refine((v) => v.mode !== "interview" || Boolean(v.interviewSessionId), {
    message: "An interview run needs the interview session",
    path: ["interviewSessionId"],
  });
export type SubmissionCreate = z.infer<typeof submissionCreateSchema>;

export const submissionListQuerySchema = z.object({
  problem: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60)
    .optional(),
  verdict: z.enum(VERDICT_VALUES).optional(),
  language: z.enum(LANGUAGE_VALUES).optional(),
  mode: z.enum(["practice", "contest", "interview", "review"]).optional(),
  /** Runs are hidden from history unless asked for. */
  kind: z.enum(["run", "submit", "all"]).default("submit"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type SubmissionListQuery = z.infer<typeof submissionListQuerySchema>;

export const submissionNoteSchema = z.object({ note: z.string().trim().max(500).nullable() });

export interface SubmissionCreated {
  submissionId: string;
  status: "QUEUED";
  /** Rough count of jobs waiting in the same lane (including this one). */
  queuePosition?: number;
}

export type TestKindValue = "sample" | "hidden" | "edge" | "stress" | "custom";

export interface SubmissionTestResult {
  ordinal: number;
  kind: TestKindValue | null;
  verdict: VerdictValue;
  timeMs: number | null;
  memoryKb: number | null;
  /** Only present for samples and custom runs; hidden tests reveal verdict, time and memory only. */
  stdout?: string;
  stderr?: string;
  checkerMsg?: string;
  input?: string;
  expected?: string;
}

export interface SubmissionDetail {
  id: string;
  problem: { slug: string; title: string };
  language: LanguageValue;
  kind: "run" | "submit";
  mode: string;
  verdict: VerdictValue;
  /** True once the judge has finished (any final verdict, including IE). */
  finished: boolean;
  passed: number | null;
  total: number | null;
  timeMs: number | null;
  memoryKb: number | null;
  /** The first failing test; hidden tests reveal only their number and the author's label. */
  failing: { ordinal: number; label: string | null; kind: TestKindValue | null } | null;
  compileOutput: string | null;
  stderrTail: string | null;
  results: SubmissionTestResult[];
  note: string | null;
  hintsUsed: number;
  /** What an accepted submission earned (XP, streak, badges); null otherwise. */
  rewards: SolveRewards | null;
  createdAt: string;
  finishedAt: string | null;
  /** Source code: included once the submission has finished. */
  code?: string;
}

export interface SubmissionListItem {
  id: string;
  problem: { slug: string; title: string };
  language: LanguageValue;
  kind: "run" | "submit";
  mode: string;
  verdict: VerdictValue;
  timeMs: number | null;
  memoryKb: number | null;
  passed: number | null;
  total: number | null;
  hintsUsed: number;
  note: string | null;
  createdAt: string;
}

export interface SubmissionListResponse {
  items: SubmissionListItem[];
  nextCursor: string | null;
}

// ---- bookmarks and notes (U3)

export const bookmarkSchema = z.object({
  folder: z.string().trim().min(1).max(40).default("default"),
});

export interface BookmarkItem {
  problem: { slug: string; title: string; difficulty: "easy" | "medium" | "hard" };
  folder: string;
  createdAt: string;
}

export const MAX_NOTE_CHARS = 20_000;

export const noteSaveSchema = z.object({
  bodyMd: z.string().max(MAX_NOTE_CHARS),
  /** The note version this edit started from (0 when there is no note yet). */
  baseVersion: z.number().int().min(0),
});

export interface NoteDto {
  bodyMd: string;
  version: number;
  updatedAt: string;
}

export interface NoteHubItem {
  problem: { slug: string; title: string; archived: boolean } | null;
  bodyMd: string;
  updatedAt: string;
}

export const noteSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

// ---- line diff (history "compare" view; shared so the server and web agree)

export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

/** Line diff via longest common subsequence. Inputs are capped (editor code is at most 64 KB). */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  const at = (i: number, j: number) => (lcs[i] as Uint32Array)[j] as number;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      (lcs[i] as Uint32Array)[j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] as string });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ type: "del", text: a[i++] as string });
    } else {
      out.push({ type: "add", text: b[j++] as string });
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] as string });
  while (j < m) out.push({ type: "add", text: b[j++] as string });
  return out;
}
