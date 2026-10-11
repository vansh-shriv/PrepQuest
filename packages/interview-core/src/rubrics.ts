// Rubrics and scoring anchors (doc 13 §6, doc 03 E1). The weights live in code: the model never
// computes the overall score.

export interface RubricDimension {
  key: string;
  name: string;
  weight: number;
  /** What the dimension looks like at score 1, 3 and 5 (shown to the evaluator). */
  anchors: { 1: string; 3: string; 5: string };
  /** Computed by code from the judge, not by the model. */
  fromJudge?: boolean;
}

export interface Rubric {
  id: string;
  version: string;
  dimensions: readonly RubricDimension[];
}

export const SCALE_ANCHORS = [
  "1 Not demonstrated or significantly wrong.",
  "2 Weak: major gaps, needed heavy help.",
  "3 Adequate: meets basic expectation with some gaps.",
  "4 Strong: solid, minor gaps, little help.",
  "5 Excellent: exemplary, would impress a strong interviewer.",
] as const;

export const CODING_RUBRIC: Rubric = {
  id: "coding",
  version: "1.0.0",
  dimensions: [
    {
      key: "problem_solving",
      name: "Problem solving",
      weight: 25,
      anchors: {
        1: "No coherent approach",
        3: "Reaches a working approach with hints",
        5: "Finds the optimal approach independently, justifies alternatives",
      },
    },
    {
      key: "code_quality",
      name: "Code quality",
      weight: 15,
      anchors: {
        1: "Messy, unreadable",
        3: "Readable, some issues",
        5: "Clean, idiomatic, modular",
      },
    },
    {
      key: "communication",
      name: "Communication",
      weight: 20,
      anchors: {
        1: "Silent or unclear",
        3: "Explains when asked",
        5: "Thinks aloud, structured, asks clarifying questions",
      },
    },
    {
      key: "optimization",
      name: "Optimization",
      weight: 15,
      anchors: {
        1: "No complexity awareness",
        3: "States complexity, finds one improvement with prompting",
        5: "Analyzes trade-offs, optimizes proactively",
      },
    },
    {
      key: "edge_cases",
      name: "Edge cases",
      weight: 10,
      anchors: { 1: "Misses obvious cases", 3: "Handles some", 5: "Enumerates systematically" },
    },
    {
      key: "testing",
      name: "Testing",
      weight: 10,
      anchors: {
        1: "No testing",
        3: "Runs samples",
        5: "Dry-runs, designs targeted tests, debugs methodically",
      },
    },
    {
      key: "correctness",
      name: "Correctness",
      weight: 5,
      fromJudge: true,
      anchors: { 1: "Fails", 3: "Passes with fixes", 5: "Correct on the first pass" },
    },
  ],
};

export const PROJECT_RUBRIC: Rubric = {
  id: "project",
  version: "1.0.0",
  dimensions: [
    {
      key: "ownership",
      name: "Ownership",
      weight: 15,
      anchors: {
        1: "Cannot say what they personally did",
        3: "Clear about their part, vague on the rest",
        5: "Precise about own contribution and what the team did",
      },
    },
    {
      key: "technical_depth",
      name: "Technical depth",
      weight: 20,
      anchors: {
        1: "Surface-level buzzwords",
        3: "Understands the main components",
        5: "Explains internals and why they matter",
      },
    },
    {
      key: "decisions",
      name: "Decision-making and trade-offs",
      weight: 20,
      anchors: {
        1: "No alternatives considered",
        3: "Names alternatives, weak reasoning",
        5: "Compares options with concrete criteria",
      },
    },
    {
      key: "impact",
      name: "Impact and metrics",
      weight: 15,
      anchors: {
        1: "No outcomes",
        3: "Outcomes stated, not substantiated",
        5: "Metrics defined, measured and consistent under probing",
      },
    },
    {
      key: "failure_analysis",
      name: "Failure analysis",
      weight: 10,
      anchors: {
        1: "No failures or lessons",
        3: "Names a problem, shallow lesson",
        5: "Root causes and what changed afterwards",
      },
    },
    {
      key: "scalability",
      name: "Scalability thinking",
      weight: 10,
      anchors: {
        1: "Never considered scale",
        3: "Knows the bottleneck",
        5: "Reasons about growth and limits with numbers",
      },
    },
    {
      key: "honesty",
      name: "Honesty (claims hold under probing)",
      weight: 10,
      anchors: {
        1: "Claims collapse under probing",
        3: "Mostly consistent",
        5: "Admits limits, claims stay consistent",
      },
    },
  ],
};

export const RUBRICS: Record<string, Rubric> = { coding: CODING_RUBRIC, project: PROJECT_RUBRIC };

export function getRubric(id: string): Rubric | undefined {
  return RUBRICS[id];
}

export type Band = "Not ready" | "Borderline" | "Ready" | "Strong";

export function bandFor(overall: number): Band {
  if (overall < 45) return "Not ready";
  if (overall < 65) return "Borderline";
  if (overall < 80) return "Ready";
  return "Strong";
}
