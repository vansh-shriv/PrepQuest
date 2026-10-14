import type {
  InterviewPlan,
  InterviewTemplate,
  InterviewType,
  PlannedQuestion,
  PlannedSegment,
} from "./types.js";

// Interview templates (doc 03 I1): DSA, project deep-dive, resume-based, CS fundamentals, behavioural,
// and text-only low-level and high-level design. Voice, ML and embedded rounds come later.

const MIN = 60_000;

export const DSA_TEMPLATE: InterviewTemplate = {
  key: "dsa",
  type: "dsa",
  title: "DSA coding round",
  description: "Intro, a problem from the bank, optimization follow-ups and wrap-up.",
  defaultMinutes: 45,
  minMinutes: 20,
  maxMinutes: 60,
  segments: [
    { key: "warmup", name: "Intro", kind: "warmup", minutes: 5 },
    { key: "q1", name: "Problem 1", kind: "question", minutes: 20 },
    { key: "q2", name: "Problem 2 / follow-up", kind: "question", minutes: 15 },
    { key: "wrapup", name: "Questions and wrap-up", kind: "wrapup", minutes: 5 },
  ],
  rubricId: "coding",
  usesEditor: true,
  needsResume: false,
  source: "problems",
  followupCap: 0,
  minMsForNext: 8 * MIN,
  hasHints: true,
};

export const PROJECT_TEMPLATE: InterviewTemplate = {
  key: "project",
  type: "project",
  title: "Project deep-dive",
  description: "Probes your own projects in depth: decisions, trade-offs, metrics and failures.",
  defaultMinutes: 30,
  minMinutes: 15,
  maxMinutes: 45,
  segments: [
    { key: "warmup", name: "Intro", kind: "warmup", minutes: 3 },
    { key: "q1", name: "Project 1", kind: "question", minutes: 11 },
    { key: "q2", name: "Project 2", kind: "question", minutes: 11 },
    { key: "wrapup", name: "Questions and wrap-up", kind: "wrapup", minutes: 5 },
  ],
  rubricId: "project",
  usesEditor: false,
  needsResume: true,
  source: "resume",
  followupCap: 0,
  minMsForNext: 8 * MIN,
  hasHints: false,
};

export const RESUME_TEMPLATE: InterviewTemplate = {
  key: "resume",
  type: "resume",
  title: "Resume walk-through",
  description: "Goes through your resume line by line and tests the claims on it.",
  defaultMinutes: 30,
  minMinutes: 15,
  maxMinutes: 45,
  segments: [
    { key: "warmup", name: "Intro", kind: "warmup", minutes: 3 },
    { key: "q1", name: "Experience and projects", kind: "question", minutes: 12 },
    { key: "q2", name: "Claims and skills", kind: "question", minutes: 10 },
    { key: "wrapup", name: "Questions and wrap-up", kind: "wrapup", minutes: 5 },
  ],
  rubricId: "resume",
  usesEditor: false,
  needsResume: true,
  source: "resume",
  followupCap: 4,
  minMsForNext: 4 * MIN,
  hasHints: false,
};

export const CS_TEMPLATE: InterviewTemplate = {
  key: "cs",
  type: "cs",
  title: "CS fundamentals",
  description: "OS, databases, networks and OOP questions with follow-ups.",
  defaultMinutes: 30,
  minMinutes: 15,
  maxMinutes: 45,
  segments: [
    { key: "warmup", name: "Intro", kind: "warmup", minutes: 3 },
    { key: "q1", name: "Round 1", kind: "question", minutes: 12 },
    { key: "q2", name: "Round 2", kind: "question", minutes: 10 },
    { key: "wrapup", name: "Questions and wrap-up", kind: "wrapup", minutes: 5 },
  ],
  rubricId: "cs",
  usesEditor: false,
  needsResume: false,
  source: "bank",
  bankCategory: "cs",
  followupCap: 3,
  minMsForNext: 3 * MIN,
  hasHints: false,
};

export const BEHAVIORAL_TEMPLATE: InterviewTemplate = {
  key: "behavioral",
  type: "behavioral",
  title: "HR and behavioural",
  description: "Stories about ownership, conflict, failure and leadership, probed for specifics.",
  defaultMinutes: 30,
  minMinutes: 15,
  maxMinutes: 45,
  segments: [
    { key: "warmup", name: "Intro", kind: "warmup", minutes: 3 },
    { key: "q1", name: "Story 1 and 2", kind: "question", minutes: 12 },
    { key: "q2", name: "Story 3", kind: "question", minutes: 10 },
    { key: "wrapup", name: "Questions and wrap-up", kind: "wrapup", minutes: 5 },
  ],
  rubricId: "behavioral",
  usesEditor: false,
  needsResume: false,
  source: "bank",
  bankCategory: "behavioral",
  followupCap: 3,
  minMsForNext: 4 * MIN,
  hasHints: false,
};

export const LLD_TEMPLATE: InterviewTemplate = {
  key: "lld",
  type: "lld",
  title: "Low-level design",
  description: "Class design, SOLID and patterns, talked through in text (no diagram canvas yet).",
  defaultMinutes: 45,
  minMinutes: 30,
  maxMinutes: 60,
  segments: [
    { key: "warmup", name: "Intro", kind: "warmup", minutes: 3 },
    { key: "q1", name: "Design", kind: "question", minutes: 37 },
    { key: "wrapup", name: "Questions and wrap-up", kind: "wrapup", minutes: 5 },
  ],
  rubricId: "lld",
  usesEditor: false,
  needsResume: false,
  source: "bank",
  bankCategory: "lld",
  followupCap: 0,
  minMsForNext: 20 * MIN,
  hasHints: false,
};

export const HLD_TEMPLATE: InterviewTemplate = {
  key: "hld",
  type: "hld",
  title: "High-level design",
  description:
    "Requirements, estimates, APIs, data model, scaling and trade-offs, with a drawing board the interviewer can see.",
  defaultMinutes: 60,
  minMinutes: 40,
  maxMinutes: 75,
  segments: [
    { key: "warmup", name: "Intro", kind: "warmup", minutes: 3 },
    { key: "q1", name: "Design", kind: "question", minutes: 50 },
    { key: "wrapup", name: "Questions and wrap-up", kind: "wrapup", minutes: 7 },
  ],
  rubricId: "hld",
  usesEditor: false,
  usesCanvas: true,
  needsResume: false,
  source: "bank",
  bankCategory: "hld",
  followupCap: 0,
  minMsForNext: 30 * MIN,
  hasHints: false,
};

export const TEMPLATES: Record<InterviewType, InterviewTemplate> = {
  dsa: DSA_TEMPLATE,
  project: PROJECT_TEMPLATE,
  resume: RESUME_TEMPLATE,
  cs: CS_TEMPLATE,
  behavioral: BEHAVIORAL_TEMPLATE,
  lld: LLD_TEMPLATE,
  hld: HLD_TEMPLATE,
};

export function getTemplate(key: string): InterviewTemplate | undefined {
  return (TEMPLATES as Record<string, InterviewTemplate | undefined>)[key];
}

/** How many questions fit: problems by length, short verbal rounds by the time per question. */
export function questionCountFor(template: InterviewTemplate, minutes: number): number {
  switch (template.type) {
    case "dsa":
      return minutes >= 40 ? 2 : 1;
    case "project":
      return minutes >= 25 ? 2 : 1;
    case "resume":
      return Math.max(2, Math.min(6, Math.floor((minutes - 8) / 5)));
    case "cs":
      return Math.max(2, Math.min(8, Math.floor((minutes - 8) / 5)));
    case "behavioral":
      return Math.max(2, Math.min(5, Math.floor((minutes - 8) / 6)));
    default:
      return 1;
  }
}

/** Segment key for the i-th question: several short questions share a segment. */
export function segmentKeyForQuestion(
  template: InterviewTemplate,
  index: number,
  count: number,
): string {
  const segs = template.segments.filter((s) => s.kind === "question");
  const per = Math.max(1, Math.ceil(count / segs.length));
  return segs[Math.min(Math.floor(index / per), segs.length - 1)]!.key;
}

/** Lays the template's segments on a timeline, scaled to `minutes` (whole seconds, last one absorbs rounding). */
export function layoutSegments(template: InterviewTemplate, minutes: number): PlannedSegment[] {
  const total = template.segments.reduce((sum, s) => sum + s.minutes, 0);
  const totalMs = minutes * 60_000;
  const out: PlannedSegment[] = [];
  let cursor = 0;
  template.segments.forEach((seg, i) => {
    const last = i === template.segments.length - 1;
    const len = last
      ? totalMs - cursor
      : Math.round(((seg.minutes / total) * totalMs) / 1000) * 1000;
    out.push({
      key: seg.key,
      name: seg.name,
      kind: seg.kind,
      startMs: cursor,
      endMs: cursor + len,
    });
    cursor += len;
  });
  return out;
}

export function buildPlan(
  template: InterviewTemplate,
  minutes: number,
  questions: PlannedQuestion[],
  extra: Partial<Pick<InterviewPlan, "packSlug" | "rubricWeights" | "style" | "callbacks">> = {},
): InterviewPlan {
  return {
    templateKey: template.key,
    minutes,
    segments: layoutSegments(template, minutes),
    questions,
    ...extra,
  };
}
