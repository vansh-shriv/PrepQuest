import { describe, expect, it } from "vitest";
import {
  BEHAVIORAL_RUBRIC,
  CS_RUBRIC,
  HLD_RUBRIC,
  INTERVIEW_TYPES,
  LLD_RUBRIC,
  RESUME_RUBRIC,
  TEMPLATES,
  analyzeSpeech,
  callbackLines,
  cosine,
  countFillers,
  countLikeFillers,
  countNumbers,
  decideNext,
  describePack,
  extractFacts,
  getRubric,
  hintBudgetFor,
  inventedFacts,
  layoutSegments,
  levelFromBand,
  ownershipRatio,
  pickVerbal,
  planLevel,
  questionCountFor,
  segmentKeyForQuestion,
  starCompleteness,
  toVerbalQuestion,
  withWeights,
  type BankCandidate,
  type MachineFacts,
  type PackStyle,
} from "./index.js";

describe("templates and rubrics", () => {
  it("every type has a template, a rubric whose weights total 100, and segments that fill the time", () => {
    expect(INTERVIEW_TYPES).toHaveLength(7);
    for (const type of INTERVIEW_TYPES) {
      const t = TEMPLATES[type];
      expect(t.type).toBe(type);
      const rubric = getRubric(t.rubricId)!;
      expect(rubric, type).toBeDefined();
      expect(
        rubric.dimensions.reduce((s, d) => s + d.weight, 0),
        type,
      ).toBe(100);
      const segs = layoutSegments(t, t.defaultMinutes);
      expect(segs.at(-1)!.endMs).toBe(t.defaultMinutes * 60_000);
      expect(t.minMinutes).toBeLessThanOrEqual(t.defaultMinutes);
      expect(t.maxMinutes).toBeGreaterThanOrEqual(t.defaultMinutes);
    }
    for (const r of [RESUME_RUBRIC, CS_RUBRIC, BEHAVIORAL_RUBRIC, LLD_RUBRIC, HLD_RUBRIC]) {
      expect(new Set(r.dimensions.map((d) => d.key)).size).toBe(r.dimensions.length);
    }
  });

  it("only coding rounds have an editor and hints; design and verbal rounds are text only", () => {
    expect(TEMPLATES.dsa).toMatchObject({ usesEditor: true, hasHints: true });
    for (const t of ["project", "resume", "cs", "behavioral", "lld", "hld"] as const) {
      expect(TEMPLATES[t]).toMatchObject({ usesEditor: false, hasHints: false });
    }
    expect(TEMPLATES.cs.source).toBe("bank");
    expect(TEMPLATES.project.needsResume && TEMPLATES.resume.needsResume).toBe(true);
  });

  it("scales the question count with the time, and groups short questions into segments", () => {
    expect(questionCountFor(TEMPLATES.cs, 30)).toBe(4);
    expect(questionCountFor(TEMPLATES.cs, 15)).toBe(2);
    expect(questionCountFor(TEMPLATES.behavioral, 30)).toBe(3);
    expect(questionCountFor(TEMPLATES.hld, 60)).toBe(1);
    const keys = Array.from({ length: 4 }, (_, i) => segmentKeyForQuestion(TEMPLATES.cs, i, 4));
    expect(keys).toEqual(["q1", "q1", "q2", "q2"]);
    expect(segmentKeyForQuestion(TEMPLATES.hld, 0, 1)).toBe("q1");
  });

  it("applies a pack's rubric weights and keeps the total at 100", () => {
    const base = getRubric("coding")!;
    const heavy = withWeights(base, { problem_solving: 0.5, communication: 0.3 });
    expect(heavy.dimensions.find((d) => d.key === "problem_solving")!.weight).toBe(50);
    expect(heavy.dimensions.find((d) => d.key === "communication")!.weight).toBe(30);
    expect(heavy.dimensions.reduce((s, d) => s + d.weight, 0)).toBeCloseTo(100, 0);
    // the original is untouched, and a missing pack changes nothing
    expect(base.dimensions[0]!.weight).toBe(25);
    expect(withWeights(base, null)).toBe(base);
    // weights given as percentages work too
    expect(withWeights(base, { problem_solving: 40 }).dimensions[0]!.weight).toBe(40);
    expect(withWeights(base, { nonsense: 1 })).toBe(base);
  });
});

const facts = (over: Partial<MachineFacts> = {}): MachineFacts => ({
  type: "cs",
  elapsedMs: 10 * 60_000,
  plannedMs: 30 * 60_000,
  inStateMs: 60_000,
  turnsInState: 1,
  approachStated: false,
  hasRun: false,
  ac: false,
  candidateDone: false,
  questionIndex: 0,
  questionCount: 4,
  warmupMs: 3 * 60_000,
  followupCap: 3,
  minMsForNext: 3 * 60_000,
  ...over,
});

describe("verbal rounds in the state machine", () => {
  it("presenting a question leads to follow-ups for every verbal type", () => {
    for (const type of ["project", "resume", "cs", "behavioral", "lld", "hld"] as const) {
      expect(decideNext("PROBLEM", undefined, facts({ type })).state).toBe("FOLLOWUP");
    }
  });

  it("moves on after the follow-up cap, or wraps up on the last question or when time is short", () => {
    expect(decideNext("FOLLOWUP", undefined, facts({ turnsInState: 2 })).state).toBe("FOLLOWUP");
    expect(decideNext("FOLLOWUP", undefined, facts({ turnsInState: 3 }))).toMatchObject({
      state: "PROBLEM",
      nextQuestion: true,
      forced: true,
    });
    expect(
      decideNext("FOLLOWUP", undefined, facts({ turnsInState: 3, questionIndex: 3 })),
    ).toMatchObject({
      state: "WRAPUP",
    });
    // 10 minutes left: another question fits a project round (8 min) but not a design-sized one (12 min)
    const f = facts({ turnsInState: 3, elapsedMs: 20 * 60_000, minMsForNext: 8 * 60_000 });
    expect(decideNext("FOLLOWUP", undefined, f).state).toBe("PROBLEM");
    expect(decideNext("FOLLOWUP", undefined, { ...f, minMsForNext: 12 * 60_000 }).state).toBe(
      "WRAPUP",
    );
  });

  it("uses the template's own minimum time for the next question", () => {
    // 4 minutes left: enough for a short CS question (3 min), not for a project one (8 min)
    const f = facts({ elapsedMs: 22 * 60_000, plannedMs: 26 * 60_000 });
    expect(decideNext("FOLLOWUP", "PROBLEM", f).state).toBe("PROBLEM");
    expect(decideNext("FOLLOWUP", "PROBLEM", { ...f, minMsForNext: undefined }).state).toBe(
      "FOLLOWUP",
    );
  });

  it("design rounds have no follow-up cap: the interviewer keeps probing until the time guard", () => {
    expect(
      decideNext(
        "FOLLOWUP",
        undefined,
        facts({ type: "hld", followupCap: 0, turnsInState: 30, questionCount: 1 }),
      ).state,
    ).toBe("FOLLOWUP");
  });
});

const pack: PackStyle = {
  slug: "p",
  title: "P",
  level: "sde1",
  topic_weights: { graphs: 0.9, arrays: 0.5 },
  difficulty_band: { easy: 0.1, medium: 0.6, hard: 0.3 },
  interview_style: {
    bar: "high",
    follow_up_depth: 3,
    hint_policy: "sparse",
    behavioral_weight: 0.3,
    notes: "Precise.",
  },
  rubric_weights: { problem_solving: 0.4, communication: 0.2 },
  behavioral_competencies: ["ownership", "failure"],
  cs_topics: ["os", "dbms"],
};

describe("company packs", () => {
  it("caps hints by policy and nudges the level by at most one step", () => {
    expect(hintBudgetFor(3, pack)).toBe(1);
    expect(hintBudgetFor(0, pack)).toBe(0);
    expect(hintBudgetFor(3, null)).toBe(3);
    expect(
      hintBudgetFor(3, {
        ...pack,
        interview_style: { ...pack.interview_style, hint_policy: "generous" },
      }),
    ).toBe(3);
    expect(levelFromBand(pack.difficulty_band)).toBe(4);
    expect(planLevel(2, pack)).toBe(3); // wants 4, moves one step
    expect(planLevel(4, pack)).toBe(4);
    expect(planLevel(5, pack)).toBe(5); // a high bar never lowers the choice
    expect(planLevel(3, null)).toBe(3);
  });

  it("says in plain words what the pack changes", () => {
    const dsa = describePack(pack, "dsa").join(" ");
    expect(dsa).toMatch(/graphs, arrays/);
    expect(dsa).toMatch(/Hints: sparse/);
    expect(dsa).toMatch(/problem solving 40%/);
    expect(describePack(pack, "behavioral").join(" ")).toMatch(/ownership, failure/);
    expect(describePack(pack, "cs").join(" ")).toMatch(/os, dbms/);
  });
});

const cand = (
  slug: string,
  topic: string,
  competency: string | null,
  difficulty = 3,
): BankCandidate => ({
  slug,
  category: competency ? "behavioral" : "cs",
  topic,
  competency,
  difficulty,
  text: `Question ${slug}`,
  referenceAnswer: "ref",
  followups: ["f"],
  rubricPoints: ["a", "b"],
});

describe("question selection from the bank", () => {
  const pool = [
    cand("os-1", "os", null),
    cand("os-2", "os", null),
    cand("db-1", "dbms", null),
    cand("cn-1", "cn", null),
    cand("oop-1", "oop", null),
  ];
  const rng = () => 0.5;

  it("varies topics inside one interview and avoids recent questions", () => {
    const picks = pickVerbal(pool, {
      count: 4,
      level: 3,
      random: rng,
      recentSlugs: new Set(["db-1"]),
    });
    expect(picks).toHaveLength(4); // the repeated os topic is used before the recently asked question
    expect(new Set(picks.map((p) => p.topic)).size).toBe(3);
    expect(picks.map((p) => p.slug)).not.toContain("db-1");
  });

  it("only uses the topics asked for", () => {
    const picks = pickVerbal(pool, {
      count: 3,
      level: 3,
      random: rng,
      allowedTopics: ["os", "cn"],
    });
    expect(picks.map((p) => p.topic).sort()).toEqual(["cn", "os", "os"]);
  });

  it("skips semantic duplicates unless nothing else is left", () => {
    const dup = (c: BankCandidate) => c.slug === "cn-1" || c.slug === "os-1";
    const picks = pickVerbal(pool, { count: 3, level: 3, random: rng, isSemanticDuplicate: dup });
    expect(picks.map((p) => p.slug)).not.toContain("cn-1");
    expect(picks.map((p) => p.slug)).not.toContain("os-1");
    expect(
      pickVerbal(pool.slice(0, 1), {
        count: 1,
        level: 3,
        random: rng,
        isSemanticDuplicate: () => true,
      }),
    ).toHaveLength(1);
  });

  it("brings a weak question back with some probability, and rotates competencies across sessions", () => {
    const behav = [
      cand("b1", "ownership", "ownership"),
      cand("b2", "failure", "failure"),
      cand("b3", "leadership", "leadership"),
    ];
    const always = pickVerbal(behav, {
      count: 1,
      level: 3,
      random: () => 0.1,
      weakSlugs: new Set(["b2"]),
      retryWeakShare: 0.5,
    });
    expect(always[0]!.slug).toBe("b2");
    const never = pickVerbal(behav, {
      count: 1,
      level: 3,
      random: () => 0.9,
      weakSlugs: new Set(["b2"]),
      retryWeakShare: 0.5,
    });
    expect(never[0]!.slug).not.toBe("b2");
    const rotated = pickVerbal(behav, {
      count: 2,
      level: 3,
      random: rng,
      recentCompetencies: new Set(["ownership", "failure"]),
    });
    expect(rotated.map((p) => p.competency)).toContain("leadership");
  });

  it("turns a bank question into a plan question with a confidential reference", () => {
    const q = toVerbalQuestion(cand("os-1", "os", null), "q1");
    expect(q).toMatchObject({
      kind: "verbal",
      sourceRef: "bank:os-1",
      category: "cs",
      reference: "ref",
      segmentKey: "q1",
    });
  });

  it("measures embedding similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([], [1])).toBe(0);
  });

  it("writes at most two recent callbacks, only for weak questions", () => {
    const lines = callbackLines([
      { questionText: "Explain deadlocks", weak: true, daysAgo: 2, topic: "os" },
      { questionText: "Explain ACID", weak: false, daysAgo: 1, topic: "dbms" },
      { questionText: "Tell me about a failure", weak: true, daysAgo: 30, topic: null },
      { questionText: "Another", weak: true, daysAgo: 5, topic: "cn" },
      { questionText: "Ancient", weak: true, daysAgo: 400, topic: "x" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/topic of os/);
    expect(lines.join(" ")).not.toMatch(/ACID|Ancient/);
    expect(callbackLines([])).toEqual([]);
  });
});

describe("STAR helpers", () => {
  it("computes the share of I among I and we", () => {
    expect(ownershipRatio("I built it and I tested it")).toBe(1);
    expect(ownershipRatio("We built it and our team shipped it")).toBe(0);
    expect(ownershipRatio("I wrote the parser while we reviewed it")).toBe(0.5);
    expect(ownershipRatio("Built it quickly")).toBeNull();
  });

  it("counts concrete numbers", () => {
    expect(countNumbers("Cut latency by 40% for 10k users in 3 weeks")).toBe(3);
    expect(countNumbers("It went well")).toBe(0);
  });

  it("scores completeness out of 100", () => {
    expect(starCompleteness({ s: 2, t: 2, a: 2, r: 2 })).toBe(100);
    expect(starCompleteness({ s: 1, t: 0, a: 2, r: 1 })).toBe(50);
  });

  it("finds facts a rewrite invents, and allows bracketed suggestions", () => {
    const said =
      "I rewrote the billing job at Acme and cut the runtime by 40% for about 2 weeks of work.";
    const honest =
      "Situation: the billing job at Acme was slow. Action: I rewrote it. Result: runtime fell by 40%. [added suggestion: say what the cost was]";
    expect(inventedFacts(honest, [said])).toEqual([]);
    const lying =
      "I rewrote the billing job at Acme and cut the runtime by 90%, saving Initech 3 million dollars.";
    const bad = inventedFacts(lying, [said]);
    expect(bad).toEqual(expect.arrayContaining(["90%", "initech"]));
    expect(bad).not.toContain("acme");
    // a suggestion in brackets may contain new numbers: it is flagged as an addition, not a fact
    expect(inventedFacts("I cut it by 40%. [added suggestion: mention 5 users]", [said])).toEqual(
      [],
    );
    expect(extractFacts("Then I used Redis and Kafka at 5k rps.")).toEqual(
      expect.arrayContaining(["redis", "kafka"]),
    );
  });
});

describe("speech analytics", () => {
  it("counts fillers without mistaking the verb 'like'", () => {
    expect(countLikeFillers("I would like to use a map, it looks like a graph problem")).toBe(0);
    expect(countLikeFillers("so it is, like, a map, and then like we scan")).toBe(2);
    const c = countFillers("Um, basically I think, you know, it is um sort of a hash map");
    expect(c).toMatchObject({ um: 2, basically: 1, "you know": 1, "sort of": 1 });
  });

  it("typed interviews have no pace, but fillers and hedges are still counted", () => {
    const a = analyzeSpeech([
      { seq: 2, offsetMs: 60_000, text: "I think maybe a hash map, basically", modality: "text" },
      { seq: 4, offsetMs: 180_000, text: "Probably O(n), I guess", modality: "text" },
    ]);
    expect(a.basis).toBe("text");
    expect(a.wpm).toBeNull();
    expect(a.fillerCounts.basically).toBe(1);
    expect(a.hedgingRate).toBeGreaterThan(0);
    expect(a.words).toBe(11);
  });

  it("measures pace from word timestamps and flags fast speech", () => {
    const words = Array.from({ length: 60 }, (_, i) => ({
      w: `w${i}`,
      startMs: i * 300,
      endMs: i * 300 + 250,
    }));
    const a = analyzeSpeech([
      { seq: 2, offsetMs: 10_000, text: words.map((w) => w.w).join(" "), words, modality: "voice" },
    ]);
    expect(a.basis).toBe("voice");
    expect(a.wpm).toBe(Math.round((60 / 17_950) * 60_000));
    expect(a.wpm!).toBeGreaterThan(170);
    expect(a.flags.join(" ")).toMatch(/quickly/);
    expect(a.series[0]).toMatchObject({ seq: 2, words: 60 });
  });

  it("tells a thinking pause (code was changing) from dead air", () => {
    const words = [
      { w: "so", startMs: 0, endMs: 200 },
      { w: "first", startMs: 300, endMs: 600 },
      { w: "I", startMs: 700, endMs: 800 },
      { w: "will", startMs: 900, endMs: 1100 },
      { w: "scan", startMs: 1200, endMs: 1500 },
      { w: "then", startMs: 7000, endMs: 7300 }, // 5.5 s gap while code changed
      { w: "check", startMs: 7400, endMs: 7700 },
      { w: "the", startMs: 7800, endMs: 7900 },
      { w: "map", startMs: 8000, endMs: 8300 },
      { w: "next", startMs: 14_000, endMs: 14_300 }, // 5.7 s of silence, nothing happening
    ];
    const a = analyzeSpeech(
      [
        {
          seq: 6,
          offsetMs: 100_000,
          text: words.map((w) => w.w).join(" "),
          words,
          modality: "voice",
        },
      ],
      { codeActivityMs: [103_000] },
    );
    expect(a.longPauses.map((p) => p.kind)).toEqual(["thinking", "dead_air"]);
    expect(a.longPauses[0]!.lengthMs).toBe(5500);
  });

  it("ignores malformed timestamps and says nothing about too little speech", () => {
    const a = analyzeSpeech([
      {
        seq: 1,
        offsetMs: 0,
        text: "hello there",
        words: [{ w: "hello", startMs: 5, endMs: 1 }],
        modality: "voice",
      },
    ]);
    expect(a.wpm).toBeNull();
    expect(a.flags).toEqual([]);
  });
});

describe("problem selection shaped by a pack", () => {
  const pool = [
    { problemId: "1", slug: "arr", title: "A", difficulty: "easy" as const, tags: ["arrays"] },
    {
      problemId: "2",
      slug: "gra",
      title: "G",
      difficulty: "medium" as const,
      tags: ["graphs", "bfs"],
    },
    {
      problemId: "3",
      slug: "dyn",
      title: "D",
      difficulty: "hard" as const,
      tags: ["dynamic-programming"],
    },
  ];
  it("prefers the topics a pack weighs and the tiers its band favours", async () => {
    const { pickProblems } = await import("./index.js");
    const g = pickProblems(pool, {
      count: 1,
      level: 3,
      random: () => 0.5,
      topicWeights: { graphs: 0.9, bfs: 0.8 },
    });
    expect(g[0]!.slug).toBe("gra");
    const d = pickProblems(pool, {
      count: 1,
      level: 4,
      random: () => 0.5,
      topicWeights: { "dynamic-programming": 0.9 },
      tierBand: { easy: 0, medium: 0.1, hard: 0.9 },
    });
    expect(d[0]!.slug).toBe("dyn");
  });
});
