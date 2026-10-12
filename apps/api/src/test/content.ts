import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  importBank,
  importLearning,
  loadLearning,
  importFolder,
  importSheet,
  findContentRoot,
  loadBank,
} from "@prepquest/content";
import { seedReferenceData } from "@prepquest/db";
import { FsObjectStore } from "@prepquest/storage";
import type { TestApp } from "./helpers.js";

export const FIXTURE_SLUGS = [
  "two-sum",
  "valid-parentheses",
  "three-sum",
  "climbing-stairs",
  "edit-distance",
  "merge-intervals",
] as const;

/**
 * Imports a few real problems (with their real tests) into the test database, using a temporary
 * object store, plus a small sheet. Call after `makeTestApp()`: its TRUNCATE ... CASCADE wipes problems.
 */
export async function seedContent(t: TestApp, slugs: readonly string[] = FIXTURE_SLUGS) {
  const store = new FsObjectStore(await mkdtemp(join(tmpdir(), "pq-objects-")));
  await seedReferenceData(t.db);
  const root = findContentRoot();
  for (const slug of slugs) await importFolder(t.db, store, root, slug, { publish: true });
  // the sheet only references problems that were imported
  const has = (slug: string) => slugs.includes(slug);
  const sections = [
    { name: "Warm-up", problems: ["valid-parentheses", "two-sum"].filter(has) },
    { name: "Harder", problems: ["edit-distance"].filter(has) },
  ].filter((section) => section.problems.length > 0);
  if (sections.length > 0) {
    await importSheet(t.db, {
      slug: "mini",
      title: "Mini Sheet",
      description: "Three problems",
      sections,
    });
  }
  return { store, root };
}

/** Imports the real question bank and company packs (72 questions, 5 packs) into the test database. */
export async function seedBank(t: TestApp) {
  const bank = await loadBank(findContentRoot());
  return importBank(t.db, bank);
}

/** Imports the real quiz questions and roadmaps (48 questions, 2 roadmaps). Needs the problems for ladders. */
export async function seedLearning(t: TestApp) {
  const learning = await loadLearning(findContentRoot());
  return importLearning(t.db, learning);
}
