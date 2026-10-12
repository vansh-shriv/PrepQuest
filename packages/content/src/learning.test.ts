import { describe, expect, it } from "vitest";
import {
  loadLearning,
  validateLearning,
  type LoadedLearning,
  type QuizQuestionSource,
  type RoadmapSource,
} from "./learning.js";
import { findContentRoot } from "./root.js";

const taxonomy = { topics: new Set(["arrays", "graphs"]), patterns: new Set(["dfs"]) };
const problems = new Set(["two-sum"]);

const question = (over: Partial<QuizQuestionSource>): QuizQuestionSource => ({
  slug: "q-one",
  subject: "os",
  topic: "processes",
  difficulty: 2,
  type: "single",
  body: "Which one is a process?",
  options: [
    { id: "a", text: "This" },
    { id: "b", text: "That" },
  ],
  answer: "a",
  explanation: "Because the first one is the right one here.",
  tags: [],
  ...over,
});

const roadmap = (nodes: RoadmapSource["nodes"]): RoadmapSource => ({
  slug: "map",
  title: "A map",
  track: "sde",
  description: "A small roadmap for the tests to use.",
  version: 1,
  nodes,
});
const node = (
  id: string,
  requires: string[] = [],
  extra: Partial<RoadmapSource["nodes"][number]> = {},
): RoadmapSource["nodes"][number] => ({
  id,
  title: id,
  summary: "A summary that is long enough to pass.",
  resources: [],
  problems: [],
  requires,
  topic: "arrays",
  ...extra,
});

const check = (quizzes: QuizQuestionSource[], roadmaps: RoadmapSource[] = []) =>
  validateLearning({ quizzes, roadmaps, issues: [] } as LoadedLearning, taxonomy, problems).map(
    (i) => i.message,
  );

describe("quiz and roadmap content", () => {
  it("the repository content is valid", async () => {
    const learning = await loadLearning(findContentRoot());
    expect(learning.issues).toEqual([]);
    expect(learning.quizzes.length).toBeGreaterThanOrEqual(40);
    expect(learning.roadmaps.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts a well-formed question", () => {
    expect(check([question({})])).toEqual([]);
  });

  it("checks the answer against the type and the options", () => {
    expect(check([question({ answer: "z" })])[0]).toMatch(/single answer/);
    expect(check([question({ type: "multi", answer: ["a"] })])[0]).toMatch(/multi answer/);
    expect(check([question({ type: "tf", options: undefined, answer: "yes" })])[0]).toMatch(
      /boolean/,
    );
    expect(check([question({ type: "blank", options: undefined, answer: "x" })])[0]).toMatch(
      /list of accepted/,
    );
    expect(check([question({ type: "tf", answer: true })])[0]).toMatch(/no options/);
    expect(check([question({ options: [{ id: "a", text: "Only" }] })])[0]).toMatch(/two options/);
  });

  it("rejects duplicate question slugs", () => {
    expect(check([question({}), question({})])).toContain("duplicate question slug");
  });

  it("validates the roadmap graph, topics, problems and thresholds", () => {
    expect(check([question({})], [roadmap([node("a"), node("b", ["a"])])])).toEqual([]);
    expect(check([], [roadmap([node("a", ["b"]), node("b", ["a"])])])[0]).toMatch(/cycle/);
    expect(check([], [roadmap([node("a"), node("b", ["zzz"])])])[0]).toMatch(/unknown node/);
    expect(check([], [roadmap([node("a", [], { topic: "nope" }), node("b")])])[0]).toMatch(
      /unknown topic/,
    );
    expect(check([], [roadmap([node("a", [], { problems: ["ghost"] }), node("b")])])[0]).toMatch(
      /unknown problem/,
    );
    expect(check([], [roadmap([node("a", [], { topic: undefined }), node("b")])])[0]).toMatch(
      /nothing to measure/,
    );
    expect(
      check(
        [],
        [roadmap([node("a", [], { unlock_threshold: 0.8, master_threshold: 0.6 }), node("b")])],
      )[0],
    ).toMatch(/below the unlock/);
    expect(
      check([], [roadmap([node("a", [], { topic: undefined, quiz_subject: "os" }), node("b")])])[0],
    ).toMatch(/no quiz questions/);
  });
});
