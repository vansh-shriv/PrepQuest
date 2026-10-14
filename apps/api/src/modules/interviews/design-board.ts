import { analyzeDesign, describeGraph, type DesignCanvas } from "@prepquest/analytics-core";

// The drawing board of a design interview (C3 inside I1): the interviewer and the scorecard read the
// canvas as text. The text is built in code from the validated canvas; labels are the candidate's words
// and travel in a delimited block like any other candidate text.

const MAX_CHARS = 6000;

/** Components, connections and the automatic checks, with ids that evidence and questions can cite. */
export function boardOutline(canvas: DesignCanvas): string {
  const checks = analyzeDesign(canvas).filter((f) => f.code !== "empty");
  const lines = [
    describeGraph(canvas),
    ...(checks.length > 0
      ? ["AUTOMATIC CHECKS (facts about the drawing):", ...checks.map((f) => `- ${f.message}`)]
      : []),
  ];
  return lines.join("\n").slice(0, MAX_CHARS);
}

export const isBlank = (c: DesignCanvas) => c.nodes.length === 0;
