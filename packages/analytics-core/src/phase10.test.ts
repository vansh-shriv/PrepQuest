import { describe, expect, it } from "vitest";
import {
  buildQueue,
  curatedList,
  depths,
  easeAfter,
  gradeAnswer,
  graphIssues,
  heatmap,
  newCard,
  nextNode,
  nodeStatuses,
  overallQuizSkill,
  overlap,
  quizXp,
  retention,
  review,
  scoreAttempt,
  solveQuality,
  subjectSkills,
  type CardState,
  type QueueCard,
} from "./index.js";

const card: CardState = { ease: 2.5, intervalDays: 6, repetitions: 3, lapses: 0 };

describe("spaced repetition", () => {
  it("a failed review goes back to one day and lowers the ease by 0.2", () => {
    const r = review(card, 1, "2026-03-10");
    expect(r.intervalDays).toBe(1);
    expect(r.ease).toBe(2.3);
    expect(r.lapses).toBe(1);
    expect(r.repetitions).toBe(0);
    expect(r.dueOn).toBe("2026-03-11");
  });

  it("the ease never drops under 1.3", () => {
    let c: CardState = { ...card, ease: 1.4 };
    for (let i = 0; i < 5; i++) c = review(c, 0, "2026-03-10");
    expect(c.ease).toBe(1.3);
    expect(easeAfter(1.3, 3)).toBe(1.3);
  });

  it("passes step 1 day, 3 days, then interval x ease", () => {
    const first = newCard(4, "2026-03-01");
    expect(first.dueOn).toBe("2026-03-02");
    const second = review(first, 4, "2026-03-02");
    expect(second.intervalDays).toBe(3);
    expect(second.dueOn).toBe("2026-03-05");
    const third = review(second, 4, "2026-03-05");
    expect(third.intervalDays).toBe(Math.round(3 * third.ease));
    expect(third.intervalDays).toBeGreaterThan(3);
  });

  it("an easy answer grows the ease, a hard one shrinks it", () => {
    expect(easeAfter(2.5, 5)).toBe(2.6);
    expect(easeAfter(2.5, 4)).toBe(2.5);
    expect(easeAfter(2.5, 3)).toBe(2.36);
  });

  it("derives quality from what happened in the solve", () => {
    expect(
      solveQuality({
        failedAttempts: 0,
        hintTiers: 0,
        minutes: 10,
        expectedMinutes: 20,
        rating: "easy",
      }),
    ).toBe(5);
    expect(solveQuality({ failedAttempts: 0, hintTiers: 0 })).toBe(4);
    expect(solveQuality({ failedAttempts: 0, hintTiers: 1 })).toBe(3);
    expect(
      solveQuality({ failedAttempts: 0, hintTiers: 0, minutes: 40, expectedMinutes: 20 }),
    ).toBe(3);
    expect(solveQuality({ failedAttempts: 2, hintTiers: 0 })).toBe(3);
    expect(solveQuality({ failedAttempts: 5, hintTiers: 0 })).toBe(2);
    expect(solveQuality({ failedAttempts: 0, hintTiers: 0, rating: "again" })).toBe(1);
    // rating easy cannot rescue a hinted solve
    expect(solveQuality({ failedAttempts: 0, hintTiers: 2, rating: "easy" })).toBe(3);
  });

  const mk = (id: string, dueOn: string, extra: Partial<QueueCard> = {}): QueueCard => ({
    id,
    dueOn,
    suspended: false,
    ease: 2.5,
    lapses: 0,
    ...extra,
  });

  it("the queue is capped, most overdue first, and carries the rest over", () => {
    const cards = [
      mk("a", "2026-03-10"),
      mk("b", "2026-03-05"),
      mk("c", "2026-03-08"),
      mk("d", "2026-03-11"),
      mk("future", "2026-03-12"),
      mk("paused", "2026-03-01", { suspended: true }),
    ];
    const q = buildQueue(cards, { today: "2026-03-10", cap: 3, doneToday: 0 });
    expect(q.due.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(q.waiting).toBe(0);
    const many = buildQueue(cards, { today: "2026-03-12", cap: 2, doneToday: 0 });
    expect(many.due).toHaveLength(2);
    expect(many.waiting).toBe(3);
  });

  it("reviews already done today use up the cap", () => {
    const cards = [mk("a", "2026-03-10"), mk("b", "2026-03-10")];
    expect(buildQueue(cards, { today: "2026-03-10", cap: 5, doneToday: 5 }).due).toHaveLength(0);
    expect(buildQueue(cards, { today: "2026-03-10", cap: 5, doneToday: 4 }).due).toHaveLength(1);
  });

  it("equally overdue cards put the weakest first", () => {
    const q = buildQueue([mk("a", "2026-03-10"), mk("b", "2026-03-10", { lapses: 2, ease: 1.8 })], {
      today: "2026-03-10",
      cap: 5,
      doneToday: 0,
    });
    expect(q.due[0]?.id).toBe("b");
  });

  it("retention is the average quality", () => {
    expect(retention([])).toBeNull();
    expect(retention([5, 5])).toBe(1);
    expect(retention([5, 0])).toBe(0.5);
  });
});

describe("quiz grading", () => {
  it("grades each question type", () => {
    expect(gradeAnswer({ type: "single", answer: "b" }, "b")).toBe(true);
    expect(gradeAnswer({ type: "single", answer: "b" }, "a")).toBe(false);
    expect(gradeAnswer({ type: "tf", answer: false }, false)).toBe(true);
    expect(gradeAnswer({ type: "tf", answer: false }, "false")).toBe(false);
    expect(gradeAnswer({ type: "multi", answer: ["a", "c"] }, ["c", "a"])).toBe(true);
    expect(gradeAnswer({ type: "multi", answer: ["a", "c"] }, ["a"])).toBe(false);
    expect(gradeAnswer({ type: "multi", answer: ["a", "c"] }, ["a", "b", "c"])).toBe(false);
    expect(gradeAnswer({ type: "blank", answer: ["Deadlock", "a deadlock"] }, "  DEADLOCK ")).toBe(
      true,
    );
    expect(gradeAnswer({ type: "blank", answer: ["x"] }, "")).toBe(false);
    expect(gradeAnswer({ type: "output", answer: ["1\n2\n3"] }, "1 \n\n2\n 3\n")).toBe(true);
    expect(gradeAnswer({ type: "output", answer: ["1\n2"] }, "12")).toBe(false);
  });

  it("malformed responses are wrong, never errors", () => {
    expect(gradeAnswer({ type: "multi", answer: ["a"] }, null)).toBe(false);
    expect(gradeAnswer({ type: "blank", answer: ["x"] }, 5)).toBe(false);
    expect(gradeAnswer({ type: "single", answer: "a" }, undefined)).toBe(false);
  });

  it("scores an attempt, counting unanswered questions as wrong", () => {
    const s = scoreAttempt(
      [
        { correct: true, timeMs: 4000 },
        { correct: false, timeMs: 6000 },
        { correct: true, timeMs: 2000 },
      ],
      4,
    );
    expect(s).toEqual({ correct: 2, total: 4, percent: 50, medianSeconds: 4 });
  });

  it("pays XP only per first-time correct answer and caps it", () => {
    expect(quizXp(0)).toBe(0);
    expect(quizXp(5)).toBe(10);
    expect(quizXp(100)).toBe(30);
  });

  it("subject skill is recency weighted and honest about how little was answered", () => {
    const skills = subjectSkills([
      { subject: "os", correct: true, ageDays: 0 },
      { subject: "os", correct: false, ageDays: 90 },
      { subject: "dbms", correct: false, ageDays: 1 },
    ]);
    const os = skills.find((s) => s.subject === "os")!;
    expect(os.score).toBeGreaterThan(0.8);
    expect(os.confidence).toBeCloseTo(0.1);
    expect(overallQuizSkill([]).score).toBeNull();
    expect(overallQuizSkill(skills).confidence).toBeCloseTo(0.1);
  });
});

describe("roadmaps", () => {
  const nodes = [
    { id: "arrays", requires: [] },
    { id: "hashing", requires: ["arrays"] },
    { id: "two-pointers", requires: ["arrays"] },
    { id: "windows", requires: ["hashing", "two-pointers"] },
  ];

  it("accepts a DAG and rejects cycles, self edges and unknown prerequisites", () => {
    expect(graphIssues(nodes)).toEqual([]);
    expect(
      graphIssues([
        { id: "a", requires: ["b"] },
        { id: "b", requires: ["a"] },
      ])[0],
    ).toMatch(/cycle/);
    expect(graphIssues([{ id: "a", requires: ["a"] }])[0]).toMatch(/itself/);
    expect(graphIssues([{ id: "a", requires: ["zzz"] }])[0]).toMatch(/unknown/);
    expect(
      graphIssues([
        { id: "a", requires: [] },
        { id: "a", requires: [] },
      ])[0],
    ).toMatch(/duplicate/);
  });

  it("lays nodes out in layers", () => {
    const d = depths(nodes);
    expect([d.get("arrays"), d.get("hashing"), d.get("windows")]).toEqual([0, 1, 2]);
  });

  it("locks a node until every prerequisite is cleared", () => {
    const none = nodeStatuses(nodes, new Map());
    expect(none.map((s) => s.state)).toEqual(["open", "locked", "locked", "locked"]);
    const some = nodeStatuses(
      nodes,
      new Map([
        ["arrays", 0.7],
        ["hashing", 0.9],
      ]),
    );
    const by = Object.fromEntries(some.map((s) => [s.id, s]));
    expect(by.arrays?.state).toBe("cleared");
    expect(by.hashing?.state).toBe("mastered");
    expect(by["two-pointers"]?.state).toBe("open");
    expect(by.windows?.state).toBe("locked");
    expect(by.windows?.blockedBy).toEqual(["two-pointers"]);
  });

  it("uses a node's own thresholds", () => {
    const strict = [
      { id: "a", requires: [], unlockThreshold: 0.9 },
      { id: "b", requires: ["a"] },
    ];
    expect(nodeStatuses(strict, new Map([["a", 0.8]])).map((s) => s.state)).toEqual([
      "open",
      "locked",
    ]);
  });

  it("recommends the shallowest, weakest open node", () => {
    const st = nodeStatuses(nodes, new Map([["arrays", 0.7]]));
    expect(nextNode(nodes, st)).toBe("hashing");
    const all = new Map(nodes.map((n) => [n.id, 1]));
    expect(nextNode(nodes, nodeStatuses(nodes, all))).toBeNull();
  });
});

describe("company tracks", () => {
  const pack = {
    topic_weights: { graphs: 0.9, arrays: 0.5, strings: 0 },
    difficulty_band: { easy: 0.1, medium: 0.6, hard: 0.3 },
  };
  const problems = [
    { slug: "bfs", difficulty: "medium" as const, topics: ["graphs"] },
    { slug: "sum", difficulty: "easy" as const, topics: ["arrays"] },
    { slug: "palin", difficulty: "easy" as const, topics: ["strings"] },
    { slug: "dfs", difficulty: "medium" as const, topics: ["graphs"] },
  ];

  it("curates by topic weight and difficulty appetite, deterministically, dropping irrelevant problems", () => {
    const list = curatedList(problems, pack).map((p) => p.slug);
    expect(list).toEqual(["bfs", "dfs", "sum"]);
    expect(curatedList(problems, pack, 2)).toHaveLength(2);
    expect(curatedList([...problems].reverse(), pack).map((p) => p.slug)).toEqual(list);
  });

  it("overlap matches the plain set intersection", () => {
    const o = overlap(["a", "b", "c", "d"], ["c", "d", "e"]);
    expect(o.shared).toEqual(["c", "d"]);
    expect(o.onlyA).toEqual(["a", "b"]);
    expect(o.onlyB).toEqual(["e"]);
    expect(o.coversB).toBeCloseTo(2 / 3);
    expect(o.coversA).toBe(0.5);
    expect(overlap([], []).coversB).toBe(0);
  });

  it("builds a heatmap sorted by weight", () => {
    const h = heatmap(pack);
    expect(h[0]).toMatchObject({ topic: "graphs", heat: 5 });
    expect(h.at(-1)).toMatchObject({ topic: "strings", heat: 1 });
  });
});
