import type { InterviewPlan, InterviewTemplate, PlannedQuestion, PlannedSegment } from "./types.js";

// Interview templates (doc 03 I1). MVP: DSA round and project deep-dive; the rest arrive in Phase 8.

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
};

export const TEMPLATES: Record<InterviewTemplate["key"], InterviewTemplate> = {
  dsa: DSA_TEMPLATE,
  project: PROJECT_TEMPLATE,
};

export function getTemplate(key: string): InterviewTemplate | undefined {
  return (TEMPLATES as Record<string, InterviewTemplate | undefined>)[key];
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
): InterviewPlan {
  return {
    templateKey: template.key,
    minutes,
    segments: layoutSegments(template, minutes),
    questions,
  };
}
