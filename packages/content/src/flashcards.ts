import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { CARD_TYPES, cardIssues, DECK_KINDS } from "@prepquest/analytics-core";
import { flashcardDecks, flashcards, newId, type Db } from "@prepquest/db";
import { z } from "zod";
import type { Issue } from "./types.js";

// Starter flashcard decks (content/flashcards/<slug>.json): authored as JSON, validated here and upserted
// by slug. Learners copy a starter deck into their own decks; their copies never change when this does.

const face = z.string().min(1).max(1200);

export const starterDeckSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60),
  title: z.string().min(3).max(80),
  kind: z.enum(DECK_KINDS),
  description: z.string().min(10).max(300),
  cards: z
    .array(
      z.object({
        type: z.enum(CARD_TYPES).default("basic"),
        front: face,
        back: z.string().max(1200).default(""),
      }),
    )
    .min(3)
    .max(200),
});
export type StarterDeckSource = z.infer<typeof starterDeckSchema>;

export interface LoadedFlashcards {
  decks: StarterDeckSource[];
  issues: Issue[];
}

export async function loadFlashcards(root: string): Promise<LoadedFlashcards> {
  const issues: Issue[] = [];
  const decks: StarterDeckSource[] = [];
  let files: string[] = [];
  try {
    files = (await readdir(join(root, "flashcards"))).filter((f) => f.endsWith(".json")).sort();
  } catch {
    /* no flashcards folder */
  }
  for (const file of files) {
    try {
      decks.push(
        starterDeckSchema.parse(JSON.parse(await readFile(join(root, "flashcards", file), "utf8"))),
      );
    } catch (e) {
      issues.push({
        level: "error",
        problem: `flashcards/${file}`,
        message: (e as Error).message.split("\n")[0] ?? "invalid",
      });
    }
  }
  return { decks, issues };
}

/** Each card must render, and no deck repeats a front or a slug. */
export function validateFlashcards(f: LoadedFlashcards): Issue[] {
  const issues: Issue[] = [];
  const slugs = new Set<string>();
  for (const d of f.decks) {
    const name = `flashcards ${d.slug}`;
    if (slugs.has(d.slug))
      issues.push({ level: "error", problem: name, message: "duplicate slug" });
    slugs.add(d.slug);
    const fronts = new Set<string>();
    for (const [i, c] of d.cards.entries()) {
      for (const m of cardIssues(c))
        issues.push({ level: "error", problem: name, message: `card ${i + 1}: ${m}` });
      const key = c.front.trim().toLowerCase();
      if (fronts.has(key))
        issues.push({ level: "error", problem: name, message: `card ${i + 1}: duplicate front` });
      fronts.add(key);
    }
  }
  return issues;
}

export async function importFlashcards(
  db: Db,
  f: LoadedFlashcards,
): Promise<{ decks: number; cards: number }> {
  let cards = 0;
  for (const d of f.decks) {
    const values = {
      title: d.title,
      description: d.description,
      kind: d.kind,
      source: "starter",
    };
    const [existing] = await db
      .select({ id: flashcardDecks.id })
      .from(flashcardDecks)
      .where(eq(flashcardDecks.starterSlug, d.slug));
    const id = existing?.id ?? newId();
    if (existing) {
      await db.update(flashcardDecks).set(values).where(eq(flashcardDecks.id, id));
      await db.delete(flashcards).where(eq(flashcards.deckId, id));
    } else {
      await db.insert(flashcardDecks).values({ id, ownerId: null, starterSlug: d.slug, ...values });
    }
    // a fixed due date: starter cards carry no schedule, copies get their own
    await db.insert(flashcards).values(
      d.cards.map((c, i) => ({
        id: newId(),
        deckId: id,
        type: c.type,
        frontMd: c.front,
        backMd: c.back,
        dueOn: "2000-01-01",
        // keep the authored order: cards are read back by (created_at, id)
        createdAt: new Date(Date.UTC(2000, 0, 1, 0, 0, 0, i)),
      })),
    );
    cards += d.cards.length;
  }
  return { decks: f.decks.length, cards };
}
