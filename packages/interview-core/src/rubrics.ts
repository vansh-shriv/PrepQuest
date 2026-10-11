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

const dim = (
  key: string,
  name: string,
  weight: number,
  one: string,
  three: string,
  five: string,
): RubricDimension => ({ key, name, weight, anchors: { 1: one, 3: three, 5: five } });

export const RESUME_RUBRIC: Rubric = {
  id: "resume",
  version: "1.0.0",
  dimensions: [
    dim(
      "honesty",
      "Honesty (claims hold under probing)",
      30,
      "Claims collapse when probed",
      "Mostly consistent, some vagueness",
      "Every claim is specific, consistent and admitted where limited",
    ),
    dim(
      "technical_depth",
      "Technical depth",
      25,
      "Surface-level buzzwords",
      "Understands the main parts",
      "Explains internals and why they matter",
    ),
    dim(
      "ownership",
      "Ownership",
      20,
      "Cannot separate own work from the team's",
      "Clear about their part, vague on the rest",
      "Precise about their contribution and the team's",
    ),
    dim(
      "impact",
      "Impact and metrics",
      15,
      "No outcomes",
      "Outcomes stated, not substantiated",
      "Metrics defined, measured and consistent under probing",
    ),
    dim(
      "communication",
      "Communication",
      10,
      "Rambling or silent",
      "Clear when asked",
      "Structured and concise throughout",
    ),
  ],
};

export const CS_RUBRIC: Rubric = {
  id: "cs",
  version: "1.0.0",
  dimensions: [
    dim(
      "accuracy",
      "Accuracy",
      30,
      "Significantly wrong",
      "Correct with some gaps",
      "Correct and precise, including edge details",
    ),
    dim(
      "depth",
      "Depth",
      20,
      "Definitions only",
      "Explains how it works",
      "Explains why, with trade-offs and internals",
    ),
    dim("clarity", "Clarity", 20, "Hard to follow", "Understandable", "Structured, with examples"),
    dim(
      "practice",
      "Linking theory to practice",
      15,
      "No real-world link",
      "A generic example",
      "A concrete example from experience or a real system",
    ),
    dim(
      "followups",
      "Handling follow-ups",
      15,
      "Cannot extend the answer",
      "Handles some",
      "Extends the answer confidently and says when unsure",
    ),
  ],
};

export const BEHAVIORAL_RUBRIC: Rubric = {
  id: "behavioral",
  version: "1.0.0",
  dimensions: [
    dim(
      "structure",
      "Structure (situation, task, action, result)",
      20,
      "No clear story",
      "Story with missing parts",
      "Clear situation, task, action and result",
    ),
    dim(
      "specificity",
      "Specificity",
      20,
      "Generalities",
      "Some concrete details",
      "Names, numbers, timelines and decisions",
    ),
    dim(
      "ownership",
      "Ownership",
      15,
      "Only we, no personal actions",
      "Own role mentioned",
      "Clear personal actions and accountability",
    ),
    dim(
      "impact",
      "Impact and results",
      15,
      "No result",
      "A result without evidence",
      "A measured result and its significance",
    ),
    dim(
      "reflection",
      "Self-awareness and reflection",
      15,
      "No reflection",
      "Names a lesson",
      "A lesson that changed behaviour, with evidence",
    ),
    dim(
      "communication",
      "Communication",
      10,
      "Rambling",
      "Clear when asked",
      "Concise and engaging",
    ),
    dim(
      "alignment",
      "Alignment with the competency",
      5,
      "Answers a different question",
      "Partly relevant",
      "Directly shows the competency asked",
    ),
  ],
};

export const LLD_RUBRIC: Rubric = {
  id: "lld",
  version: "1.0.0",
  dimensions: [
    dim(
      "requirements",
      "Requirements and use cases",
      15,
      "Starts designing at once",
      "Some clarification",
      "Clarifies scope, actors and use cases first",
    ),
    dim(
      "modeling",
      "Class and entity modeling",
      20,
      "God classes or no model",
      "Reasonable classes, some blur",
      "Clean entities with clear responsibilities",
    ),
    dim(
      "solid_patterns",
      "SOLID and patterns",
      15,
      "Ignores principles",
      "Names patterns, applies loosely",
      "Applies principles and patterns where they earn their place",
    ),
    dim(
      "extensibility",
      "Extensibility",
      15,
      "Rigid",
      "Some extension points",
      "New requirements fit without edits to existing classes",
    ),
    dim(
      "code_skeleton",
      "Code skeleton quality",
      15,
      "Unclear signatures",
      "Readable skeleton",
      "Precise interfaces and method contracts",
    ),
    dim(
      "edge_cases",
      "Edge cases and concurrency",
      10,
      "Not considered",
      "A few considered",
      "Systematic, including concurrency and failures",
    ),
    dim(
      "communication",
      "Communication",
      10,
      "Silent or scattered",
      "Explains when asked",
      "Structured, checks understanding",
    ),
  ],
};

export const HLD_RUBRIC: Rubric = {
  id: "hld",
  version: "1.0.0",
  dimensions: [
    dim(
      "requirements",
      "Requirements gathering",
      15,
      "Skips requirements",
      "Some functional requirements",
      "Functional and non-functional requirements, scope agreed",
    ),
    dim(
      "estimation",
      "Estimation",
      10,
      "None",
      "Rough numbers",
      "Back-of-envelope numbers that drive decisions",
    ),
    dim(
      "api_data",
      "API and data modeling",
      15,
      "None",
      "Basic endpoints or tables",
      "APIs and a data model that fit the access patterns",
    ),
    dim(
      "architecture",
      "Architecture",
      20,
      "A box with no flow",
      "Reasonable components",
      "Components, data flow and responsibilities clear",
    ),
    dim(
      "scalability",
      "Scalability and reliability",
      15,
      "Single server",
      "Names caching and sharding",
      "Bottlenecks identified, failure modes handled",
    ),
    dim(
      "tradeoffs",
      "Trade-offs and depth",
      15,
      "No alternatives",
      "Names alternatives",
      "Compares options against the requirements and goes deep on one",
    ),
    dim(
      "communication",
      "Communication",
      10,
      "Silent or scattered",
      "Explains when asked",
      "Structured, drives the conversation",
    ),
  ],
};

export const RUBRICS: Record<string, Rubric> = {
  coding: CODING_RUBRIC,
  project: PROJECT_RUBRIC,
  resume: RESUME_RUBRIC,
  cs: CS_RUBRIC,
  behavioral: BEHAVIORAL_RUBRIC,
  lld: LLD_RUBRIC,
  hld: HLD_RUBRIC,
};

/**
 * The rubric with a company pack's emphasis (weights summing to 1 or 100). Dimensions the pack does
 * not name share what is left in proportion, so the weights still total 100.
 */
export function withWeights(
  rubric: Rubric,
  weights: Record<string, number> | null | undefined,
): Rubric {
  if (!weights) return rubric;
  const scale = Object.values(weights).reduce((a, b) => a + b, 0) <= 1.5 ? 100 : 1;
  const named = rubric.dimensions.filter((d) => weights[d.key] !== undefined);
  if (named.length === 0) return rubric;
  const namedTotal = named.reduce((sum, d) => sum + (weights[d.key] as number) * scale, 0);
  const restTotal = rubric.dimensions
    .filter((d) => weights[d.key] === undefined)
    .reduce((sum, d) => sum + d.weight, 0);
  const left = Math.max(0, 100 - namedTotal);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    ...rubric,
    dimensions: rubric.dimensions.map((d) => ({
      ...d,
      weight:
        weights[d.key] !== undefined
          ? round((weights[d.key] as number) * scale)
          : restTotal > 0
            ? round((d.weight / restTotal) * left)
            : d.weight,
    })),
  };
}

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
