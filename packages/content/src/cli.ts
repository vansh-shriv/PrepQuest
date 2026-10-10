import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDatabase } from "@prepquest/db";
import { serverEnvSchema } from "@prepquest/shared";
import { createObjectStore } from "@prepquest/storage";
import { buildTests, verifyTests } from "./build-tests.js";
import { importProblem, importSheet, linkRelatedEditorials } from "./import.js";
import { listProblemSlugs, loadProblem } from "./loader.js";
import { findContentRoot, taxonomy } from "./root.js";
import { sheetSchema, type Issue, type ProblemBundle } from "./types.js";
import { hasErrors, validateBundle, validateReferences } from "./validate.js";

const USAGE = `Usage: content <command> [options] [slug...]

  validate [slug...]      check content against the schemas and rules (no code execution)
  build-tests [slug...]   generate tests/*.in|out + manifest.json from examples, cases.json and gen.py
  verify [slug...]        re-run reference solutions against the committed tests (needs Python)
  import [--publish] [slug...]
                          upsert problems and sheets into the database (needs DATABASE_URL, tags seeded)
  new <slug>              scaffold a problem folder
`;

function print(issues: Issue[]) {
  for (const i of issues) {
    const tag = i.level === "error" ? "\x1b[31merror\x1b[0m" : "\x1b[33mwarn \x1b[0m";
    console.log(`  ${tag} ${i.problem}: ${i.message}`);
  }
}

async function selected(root: string, slugs: string[]): Promise<string[]> {
  const all = await listProblemSlugs(root);
  if (slugs.length === 0) return all;
  const unknown = slugs.filter((s) => !all.includes(s));
  if (unknown.length) throw new Error(`Unknown problem(s): ${unknown.join(", ")}`);
  return slugs;
}

async function loadAll(root: string, slugs: string[]) {
  const issues: Issue[] = [];
  const bundles: Array<{ slug: string; bundle: ProblemBundle }> = [];
  for (const slug of slugs) {
    const res = await loadProblem(root, slug);
    issues.push(...res.issues);
    if (res.bundle) bundles.push({ slug, bundle: res.bundle });
  }
  return { bundles, issues };
}

async function loadSheets(root: string, problemSlugs: Set<string>) {
  const issues: Issue[] = [];
  const sheets = [];
  let files: string[];
  try {
    files = (await readdir(join(root, "sheets"))).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { sheets: [], issues };
  }
  for (const file of files) {
    try {
      const sheet = sheetSchema.parse(
        JSON.parse(await readFile(join(root, "sheets", file), "utf8")),
      );
      for (const s of sheet.sections.flatMap((x) => x.problems)) {
        if (!problemSlugs.has(s))
          issues.push({
            level: "error",
            problem: `sheet ${sheet.slug}`,
            message: `unknown problem "${s}"`,
          });
      }
      sheets.push(sheet);
    } catch (e) {
      issues.push({
        level: "error",
        problem: `sheets/${file}`,
        message: (e as Error).message.split("\n")[0] ?? "invalid",
      });
    }
  }
  return { sheets, issues };
}

async function scaffold(root: string, slug: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error("slug must be kebab-case");
  const dir = join(root, "problems", slug);
  await mkdir(join(dir, "tests"), { recursive: true });
  await mkdir(join(dir, "solutions"), { recursive: true });
  const files: Record<string, string> = {
    "meta.json": `${JSON.stringify(
      {
        slug,
        title: "Title Here",
        difficulty: "easy",
        topics: ["arrays"],
        patterns: [],
        estMinutes: 15,
        source: "Original problem",
        license: "CC0-1.0",
      },
      null,
      2,
    )}\n`,
    "signature.json": `${JSON.stringify({ function: "solve", params: [{ name: "nums", type: "int[]" }], returns: "int" }, null, 2)}\n`,
    "examples.json": `${JSON.stringify([{ args: [[1, 2, 3]], expected: 6, explanation: "Explain the example." }], null, 2)}\n`,
    "statement.md": "Write the problem statement here in your own words.\n",
    "constraints.md": "- `1 <= nums.length <= 20000`\n",
    "solutions/ref.py":
      "class Solution:\n    def solve(self, nums: list[int]) -> int:\n        return sum(nums)\n",
    "tests/cases.json": `${JSON.stringify([{ kind: "edge", label: "single element", args: [[5]] }], null, 2)}\n`,
  };
  for (const [name, text] of Object.entries(files))
    await writeFile(join(dir, name), text, { flag: "wx" });
  console.log(
    `Created ${dir}\nNext: edit the files, add tests/gen.py for random/stress cases, then run \`pnpm content:build-tests ${slug}\`.`,
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const publish = rest.includes("--publish");
  const args = rest.filter((a) => !a.startsWith("--"));
  const root = findContentRoot();

  if (command === "new") {
    if (!args[0]) throw new Error("usage: content new <slug>");
    return scaffold(root, args[0]);
  }
  if (!command || !["validate", "build-tests", "verify", "import"].includes(command)) {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
    return;
  }

  const slugs = await selected(root, args);
  const folderSet = new Set(await listProblemSlugs(root));

  if (command === "build-tests") {
    let failed = false;
    for (const slug of slugs) {
      const { bundle, issues } = await loadProblem(root, slug);
      const fatal = issues.filter(
        (i) => i.level === "error" && !/tests?[/ ]|manifest/.test(i.message),
      );
      if (!bundle || fatal.length) {
        print(fatal.length ? fatal : issues);
        failed = true;
        continue;
      }
      const res = await buildTests(bundle, slug);
      print(res.issues);
      console.log(
        `${res.issues.some((i) => i.level === "error") ? "✗" : "✓"} ${slug}: ${res.count} tests`,
      );
      failed ||= hasErrors(res.issues);
    }
    process.exitCode = failed ? 1 : 0;
    return;
  }

  const { bundles, issues: loadIssues } = await loadAll(root, slugs);
  const { sheets, issues: sheetIssues } = await loadSheets(root, folderSet);
  const issues: Issue[] = [...loadIssues, ...sheetIssues];

  if (command === "verify") {
    for (const { slug, bundle } of bundles) {
      const found = await verifyTests(bundle, slug);
      issues.push(...found);
      console.log(`${found.length ? "✗" : "✓"} ${slug}: ${bundle.tests.length} tests`);
    }
    print(issues);
    process.exitCode = hasErrors(issues) ? 1 : 0;
    return;
  }

  for (const { slug, bundle } of bundles) issues.push(...validateBundle(bundle, slug, taxonomy));
  issues.push(...validateReferences(bundles.map((b) => b.bundle)));
  const slugCounts = new Map<string, number>();
  for (const { bundle } of bundles)
    slugCounts.set(bundle.meta.slug, (slugCounts.get(bundle.meta.slug) ?? 0) + 1);
  for (const [s, n] of slugCounts)
    if (n > 1) issues.push({ level: "error", problem: s, message: "duplicate slug" });

  print(issues);
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  console.log(
    `${bundles.length} problem(s), ${sheets.length} sheet(s): ${errors} error(s), ${warnings} warning(s)`,
  );
  if (errors) {
    process.exitCode = 1;
    return;
  }
  if (command === "validate") return;

  // import
  const env = serverEnvSchema
    .pick({
      DATABASE_URL: true,
      STORAGE_DRIVER: true,
      STORAGE_FS_DIR: true,
      S3_ENDPOINT: true,
      S3_REGION: true,
      S3_BUCKET: true,
      S3_ACCESS_KEY: true,
      S3_SECRET_KEY: true,
      S3_FORCE_PATH_STYLE: true,
    })
    .parse(process.env);
  const db = createDatabase(env.DATABASE_URL, 2);
  const store = createObjectStore(env);
  try {
    for (const { bundle } of bundles) {
      const r = await importProblem(db, store, bundle, { publish });
      console.log(`${r.action.padEnd(9)} ${r.slug} (v${r.version})`);
    }
    // editorials can name problems imported later in the same run
    await linkRelatedEditorials(
      db,
      root,
      bundles.map((b) => b.slug),
    );
    if (args.length === 0) {
      for (const sheet of sheets) {
        const r = await importSheet(db, sheet);
        console.log(`sheet     ${r.slug} (${r.problems} problems)`);
      }
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
