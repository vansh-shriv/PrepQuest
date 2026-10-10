import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { saveEditorialSchema, type SaveEditorial } from "@prepquest/shared";
import {
  caseSchema,
  editorialFileSchema,
  exampleSchema,
  LANGUAGES,
  manifestEntrySchema,
  metaSchema,
  signatureSchema,
  type Issue,
  type ProblemBundle,
  type TestCase,
  type TestFile,
} from "./types.js";

export const testFileName = (ordinal: number, ext: "in" | "out") =>
  `${String(ordinal).padStart(2, "0")}.${ext}`;

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readJson<T>(
  path: string,
  schema: z.ZodType<T>,
  problem: string,
  issues: Issue[],
  required = true,
): Promise<T | null> {
  const text = await readText(path);
  if (text === null) {
    if (required)
      issues.push({
        level: "error",
        problem,
        message: `missing ${path.split(/[\\/]/).slice(-2).join("/")}`,
      });
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    issues.push({
      level: "error",
      problem,
      message: `${path.split(/[\\/]/).pop()} is not valid JSON: ${(err as Error).message}`,
    });
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({
        level: "error",
        problem,
        message: `${path.split(/[\\/]/).pop()}: ${i.path.join(".") || "(root)"}: ${i.message}`,
      });
    }
    return null;
  }
  return parsed.data;
}

/** Lists problem folders (directories under content/problems that don't start with `_`). */
export async function listProblemSlugs(contentRoot: string): Promise<string[]> {
  const entries = await readdir(join(contentRoot, "problems"), { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

/**
 * Loads one problem folder. Problems found in the files are reported as issues rather than thrown,
 * so a single run can list everything wrong. Returns `bundle: null` when it can't be assembled.
 */
export async function loadProblem(
  contentRoot: string,
  slug: string,
): Promise<{ bundle: ProblemBundle | null; issues: Issue[] }> {
  const dir = join(contentRoot, "problems", slug);
  const issues: Issue[] = [];

  const meta = await readJson(join(dir, "meta.json"), metaSchema, slug, issues);
  const signature = await readJson(join(dir, "signature.json"), signatureSchema, slug, issues);
  const examples = await readJson(
    join(dir, "examples.json"),
    z.array(exampleSchema).min(1).max(5),
    slug,
    issues,
  );
  const statementMd = await readText(join(dir, "statement.md"));
  const constraintsMd = await readText(join(dir, "constraints.md"));
  if (statementMd === null)
    issues.push({ level: "error", problem: slug, message: "missing statement.md" });
  if (constraintsMd === null)
    issues.push({ level: "error", problem: slug, message: "missing constraints.md" });

  const starters: ProblemBundle["starters"] = {};
  for (const lang of LANGUAGES) {
    const text = await readText(join(dir, "starter", `${lang}.txt`));
    if (text !== null) starters[lang] = text;
  }

  const hints: ProblemBundle["hints"] = {};
  for (const tier of [1, 2, 3] as const) {
    const text = await readText(join(dir, "hints", `${tier}.md`));
    if (text !== null) hints[tier] = text.trim();
  }

  const editorial = await loadEditorial(dir, slug, issues);

  const tests: TestFile[] = [];
  const manifest = await readJson(
    join(dir, "tests", "manifest.json"),
    z.array(manifestEntrySchema),
    slug,
    issues,
    false,
  );
  for (const entry of manifest ?? []) {
    const input = await readText(join(dir, "tests", testFileName(entry.ordinal, "in")));
    const output = await readText(join(dir, "tests", testFileName(entry.ordinal, "out")));
    if (input === null || output === null) {
      issues.push({
        level: "error",
        problem: slug,
        message: `test ${entry.ordinal}: missing ${input === null ? testFileName(entry.ordinal, "in") : testFileName(entry.ordinal, "out")}`,
      });
      continue;
    }
    tests.push({ ...entry, input, output });
  }

  if (!meta || !signature || !examples || statementMd === null || constraintsMd === null) {
    return { bundle: null, issues };
  }
  return {
    bundle: {
      dir,
      meta,
      statementMd,
      constraintsMd,
      examples,
      signature,
      starters,
      hints,
      editorial,
      tests,
    },
    issues,
  };
}

/** Hand-written cases (`tests/cases.json`), if any. */
export async function loadCases(dir: string, slug: string, issues: Issue[]): Promise<TestCase[]> {
  return (
    (await readJson(join(dir, "tests", "cases.json"), z.array(caseSchema), slug, issues, false)) ??
    []
  );
}

const MAX_CODE_FILE_BYTES = 20_000;

/** Reads `editorial.json`, inlines `{ "file": ... }` code references and checks the result. */
async function loadEditorial(
  dir: string,
  slug: string,
  issues: Issue[],
): Promise<SaveEditorial | null> {
  const raw = await readJson(join(dir, "editorial.json"), editorialFileSchema, slug, issues, false);
  if (!raw) return null;
  const approaches: unknown[] = [];
  for (const approach of raw.approaches) {
    const code: Record<string, string> = {};
    for (const [lang, value] of Object.entries(approach.code)) {
      if (typeof value === "string") {
        code[lang] = value;
        continue;
      }
      const rel = value.file;
      if (isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
        issues.push({
          level: "error",
          problem: slug,
          message: `editorial code file escapes the problem folder: ${rel}`,
        });
        continue;
      }
      const text = await readText(join(dir, rel));
      if (text === null) {
        issues.push({
          level: "error",
          problem: slug,
          message: `editorial code file not found: ${rel}`,
        });
      } else if (Buffer.byteLength(text) > MAX_CODE_FILE_BYTES) {
        issues.push({
          level: "error",
          problem: slug,
          message: `editorial code file is larger than 20 KB: ${rel}`,
        });
      } else {
        code[lang] = text;
      }
    }
    approaches.push({ ...approach, code });
  }
  const parsed = saveEditorialSchema.safeParse({
    approaches,
    talkTrackMd: raw.talkTrackMd ?? null,
    relatedSlugs: raw.relatedSlugs ?? [],
  });
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({
        level: "error",
        problem: slug,
        message: `editorial.json: ${i.path.join(".") || "(root)"}: ${i.message}`,
      });
    }
    return null;
  }
  return parsed.data;
}
