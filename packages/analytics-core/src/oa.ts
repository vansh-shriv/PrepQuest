// Online-assessment simulator (C2). Pure: assembles a multi-section test, runs the section clocks,
// scores with negative marking and builds the report. The API holds the state and the answer key.

import { gradeAnswer, type GradableQuestion } from "./quiz.js";

export interface OaSectionSpec {
  key: string;
  title: string;
  /** Where the questions come from: aptitude items of a section, or CS quiz questions of a subject. */
  source: "aptitude" | "quiz";
  /** Aptitude section (quant, logical, verbal, di, pseudocode) or quiz subject (os, dbms, cn, oop). */
  from: string;
  count: number;
  minutes: number;
}

export interface OaTemplateSpec {
  slug: string;
  title: string;
  kind: "oa" | "drill";
  sections: OaSectionSpec[];
  /** Marks lost for each wrong answer (0 turns negative marking off). Each right answer earns 1. */
  negativeMarking: number;
  calculator: boolean;
}

export interface OaAnswer {
  response: unknown;
  /** Seconds into the section when this answer was last saved. */
  atSecond: number;
}

export type OaSectionStatus = "pending" | "active" | "done";

export interface OaSectionState {
  key: string;
  itemIds: string[];
  status: OaSectionStatus;
  startedAt: string | null;
  deadlineAt: string | null;
  endedAt: string | null;
  endedBy: "submitted" | "time" | null;
  answers: Record<string, OaAnswer>;
}

export interface OaState {
  sections: OaSectionState[];
}

/** A small deterministic generator, so a given attempt always rebuilds the same paper. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PoolItem {
  id: string;
  difficulty: number;
}

/**
 * Picks `count` items. Mixed difficulty: roughly a third easy, half medium, the rest hard when the pool
 * allows it, then shuffled. A short pool simply yields fewer items.
 */
export function pickItems(pool: readonly PoolItem[], count: number, seed: string): string[] {
  const rand = rng(seed);
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const band = (d: number) => (d <= 1 ? 0 : d === 2 ? 1 : 2);
  const buckets: PoolItem[][] = [[], [], []];
  for (const it of shuffle(pool)) buckets[band(it.difficulty)]!.push(it);
  const want = [Math.round(count * 0.35), Math.round(count * 0.45), 0];
  want[2] = Math.max(0, count - want[0]! - want[1]!);
  const chosen: PoolItem[] = [];
  for (let b = 0; b < 3; b++) chosen.push(...buckets[b]!.splice(0, want[b]!));
  // Top up from whatever is left when a band ran short.
  const rest = shuffle(buckets.flat());
  while (chosen.length < Math.min(count, pool.length) && rest.length) chosen.push(rest.shift()!);
  return shuffle(chosen).map((i) => i.id);
}

export function newState(sections: ReadonlyArray<{ key: string; itemIds: string[] }>): OaState {
  return {
    sections: sections.map((s) => ({
      key: s.key,
      itemIds: s.itemIds,
      status: "pending",
      startedAt: null,
      deadlineAt: null,
      endedAt: null,
      endedBy: null,
      answers: {},
    })),
  };
}

const ms = (iso: string) => new Date(iso).getTime();

/** Closes an active section whose time is up. Returns a new state; the input is not changed. */
export function syncClock(state: OaState, now: Date): OaState {
  return {
    sections: state.sections.map((s) =>
      s.status === "active" && s.deadlineAt !== null && now.getTime() >= ms(s.deadlineAt)
        ? { ...s, status: "done", endedAt: s.deadlineAt, endedBy: "time" }
        : s,
    ),
  };
}

export type OaStep =
  | { kind: "section"; index: number; secondsLeft: number }
  | { kind: "between"; next: number }
  | { kind: "finished" };

/** Where the learner is: inside a running section, waiting to start the next, or done. */
export function currentStep(state: OaState, now: Date): OaStep {
  const synced = syncClock(state, now);
  const active = synced.sections.findIndex((s) => s.status === "active");
  if (active !== -1) {
    const left = Math.max(
      0,
      Math.ceil((ms(synced.sections[active]!.deadlineAt!) - now.getTime()) / 1000),
    );
    return { kind: "section", index: active, secondsLeft: left };
  }
  const next = synced.sections.findIndex((s) => s.status === "pending");
  return next === -1 ? { kind: "finished" } : { kind: "between", next };
}

/** Starts the next waiting section. Sections run in order and cannot be reopened. */
export function startSection(
  state: OaState,
  index: number,
  minutes: number,
  now: Date,
): OaState | { error: "ORDER" | "RUNNING" } {
  const synced = syncClock(state, now);
  if (synced.sections.some((s) => s.status === "active")) return { error: "RUNNING" };
  const next = synced.sections.findIndex((s) => s.status === "pending");
  if (next !== index) return { error: "ORDER" };
  return {
    sections: synced.sections.map((s, i) =>
      i === index
        ? {
            ...s,
            status: "active",
            startedAt: now.toISOString(),
            deadlineAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
          }
        : s,
    ),
  };
}

/** Records an answer in the running section. Late answers (after the deadline) are refused. */
export function saveAnswer(
  state: OaState,
  itemId: string,
  response: unknown,
  now: Date,
): OaState | { error: "CLOSED" | "UNKNOWN" } {
  const synced = syncClock(state, now);
  const at = synced.sections.findIndex((s) => s.itemIds.includes(itemId));
  if (at === -1) return { error: "UNKNOWN" };
  const sec = synced.sections[at]!;
  if (sec.status !== "active") return { error: "CLOSED" };
  const atSecond = Math.max(0, Math.round((now.getTime() - ms(sec.startedAt!)) / 1000));
  const answers = { ...sec.answers };
  if (response === null || response === undefined || response === "") delete answers[itemId];
  else answers[itemId] = { response, atSecond };
  return { sections: synced.sections.map((s, i) => (i === at ? { ...s, answers } : s)) };
}

/** The learner hands in the running section early. */
export function submitSection(state: OaState, now: Date): OaState {
  const synced = syncClock(state, now);
  return {
    sections: synced.sections.map((s) =>
      s.status === "active"
        ? { ...s, status: "done", endedAt: now.toISOString(), endedBy: "submitted" }
        : s,
    ),
  };
}

/** Ends everything: a running section is handed in and a waiting one scores zero. */
export function closeAll(state: OaState, now: Date): OaState {
  const submitted = submitSection(state, now);
  return {
    sections: submitted.sections.map((s) =>
      s.status === "pending"
        ? { ...s, status: "done", endedAt: now.toISOString(), endedBy: "submitted" }
        : s,
    ),
  };
}

export interface KeyedItem extends GradableQuestion {
  id: string;
  topic: string;
}

export interface SectionScore {
  key: string;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  total: number;
  /** Marks after negative marking, never below zero for the section. */
  marks: number;
  maxMarks: number;
  /** 0 to 100 of the section's marks. */
  percent: number;
  /** Correct answers over attempted answers, 0 to 100, or null when nothing was attempted. */
  accuracy: number | null;
  secondsUsed: number;
  endedBy: "submitted" | "time" | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function scoreSection(
  section: OaSectionState,
  items: ReadonlyMap<string, KeyedItem>,
  negativeMarking: number,
): SectionScore {
  let correct = 0;
  let wrong = 0;
  for (const id of section.itemIds) {
    const a = section.answers[id];
    const it = items.get(id);
    if (!a || !it) continue;
    if (gradeAnswer(it, a.response)) correct++;
    else wrong++;
  }
  const total = section.itemIds.length;
  const marks = Math.max(0, round2(correct - wrong * negativeMarking));
  const secondsUsed =
    section.startedAt && section.endedAt
      ? Math.max(0, Math.round((ms(section.endedAt) - ms(section.startedAt)) / 1000))
      : 0;
  return {
    key: section.key,
    attempted: correct + wrong,
    correct,
    wrong,
    skipped: total - correct - wrong,
    total,
    marks,
    maxMarks: total,
    percent: total === 0 ? 0 : Math.round((marks / total) * 100),
    accuracy: correct + wrong === 0 ? null : Math.round((correct / (correct + wrong)) * 100),
    secondsUsed,
    endedBy: section.endedBy,
  };
}

export interface OaReport {
  sections: SectionScore[];
  marks: number;
  maxMarks: number;
  percent: number;
  /** The weakest topics across the paper, with the number of items missed or skipped. */
  weakTopics: Array<{ topic: string; missed: number; total: number }>;
  /** Average seconds per attempted question over the whole paper, or null. */
  secondsPerQuestion: number | null;
  /** Sections that ran out of time with questions unanswered. */
  rushed: string[];
}

export function buildReport(
  state: OaState,
  items: ReadonlyMap<string, KeyedItem>,
  negativeMarking: number,
): OaReport {
  const sections = state.sections.map((s) => scoreSection(s, items, negativeMarking));
  const marks = round2(sections.reduce((a, s) => a + s.marks, 0));
  const maxMarks = sections.reduce((a, s) => a + s.maxMarks, 0);
  const topics = new Map<string, { missed: number; total: number }>();
  for (const s of state.sections) {
    for (const id of s.itemIds) {
      const it = items.get(id);
      if (!it) continue;
      const t = topics.get(it.topic) ?? { missed: 0, total: 0 };
      t.total++;
      const a = s.answers[id];
      if (!a || !gradeAnswer(it, a.response)) t.missed++;
      topics.set(it.topic, t);
    }
  }
  const attempted = sections.reduce((a, s) => a + s.attempted, 0);
  const seconds = sections.reduce((a, s) => a + s.secondsUsed, 0);
  return {
    sections,
    marks,
    maxMarks,
    percent: maxMarks === 0 ? 0 : Math.round((marks / maxMarks) * 100),
    weakTopics: [...topics]
      .map(([topic, t]) => ({ topic, ...t }))
      .filter((t) => t.missed > 0 && t.total >= 2)
      .sort((a, b) => b.missed / b.total - a.missed / a.total || b.missed - a.missed)
      .slice(0, 4),
    secondsPerQuestion: attempted === 0 ? null : Math.round(seconds / attempted),
    rushed: sections.filter((s) => s.endedBy === "time" && s.skipped > 0).map((s) => s.key),
  };
}

/** Share of other attempts this one beat (ties count half), or null while fewer than `min` others exist. */
export function percentile(value: number, others: readonly number[], min = 10): number | null {
  if (others.length < min) return null;
  const below = others.filter((o) => o < value).length;
  const ties = others.filter((o) => o === value).length;
  return Math.round(((below + ties / 2) / others.length) * 100);
}
