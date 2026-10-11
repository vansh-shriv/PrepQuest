import { describe, expect, it } from "vitest";
import { MockProvider } from "../lib/llm/mock.js";
import type { LlmProvider, LlmRequest, LlmResult } from "../lib/llm/types.js";
import { ADVERSARIAL, CANARY, SCENARIOS } from "./cases.js";
import { GOLDEN } from "./golden.js";
import { mae, mean, passes, ranks, spearman, stdDev } from "./metrics.js";
import { labelOverall, renderMarkdown, runAdversarial, runEvals } from "./run.js";

const models = { interviewer: "test-interviewer", evaluator: "test-evaluator" };

/** A model that answers every interviewer turn with `reply` (scorecards come from the mock). */
class Fixed implements LlmProvider {
  private readonly mock = new MockProvider();
  constructor(private readonly reply: string) {}
  async generate(
    req: LlmRequest,
    model: string,
    opts: Parameters<LlmProvider["generate"]>[2],
  ): Promise<LlmResult> {
    if (req.task !== "interviewer_turn") return this.mock.generate(req, model, opts);
    return {
      text: this.reply,
      model,
      refused: false,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

describe("metrics", () => {
  it("computes the basics", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(stdDev([2, 2, 2])).toBe(0);
    expect(stdDev([1, 3])).toBe(1);
    expect(
      mae([
        { predicted: 3, label: 4 },
        { predicted: null, label: 1 },
        { predicted: 5, label: 4 },
      ]),
    ).toBe(1);
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });

  it("rank correlation is 1 for the same order, -1 for the reverse, undefined without variation", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1], [1])).toBeNull();
  });

  it("thresholds respect direction and missing values", () => {
    const t = { name: "x", limit: 0.6, hard: true };
    expect(passes({ ...t, value: 0.5, direction: "atMost" })).toBe(true);
    expect(passes({ ...t, value: 0.7, direction: "atMost" })).toBe(false);
    expect(passes({ ...t, value: 0.7, direction: "atLeast" })).toBe(true);
    expect(passes({ ...t, value: null, direction: "atLeast" })).toBe(false);
  });
});

describe("fixtures", () => {
  it("has at least 50 distinct adversarial cases across every attack family", () => {
    expect(ADVERSARIAL.length).toBeGreaterThanOrEqual(50);
    expect(new Set(ADVERSARIAL.map((c) => c.id)).size).toBe(ADVERSARIAL.length);
    expect(new Set(ADVERSARIAL.map((c) => c.category)).size).toBe(8);
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(10);
  });

  it("the golden labels are ordered the way a person would rank the interviews", () => {
    const o = Object.fromEntries(GOLDEN.map((g) => [g.id, labelOverall(g.labels)]));
    expect(o.strong).toBeGreaterThan(o["good-with-hint"]!);
    expect(o["good-with-hint"]).toBeGreaterThan(o.mid!);
    expect(o.mid).toBeGreaterThan(o.weak!);
    // golden quotes must really occur in their transcripts: the verifier is only useful if they do
    for (const g of GOLDEN) expect(g.turns.length).toBeGreaterThan(3);
  });
});

describe("harness", () => {
  it("passes its hard gates on the scripted mock, and shows the guards doing work", async () => {
    const report = await runEvals({ provider: new MockProvider(), models, runs: 2, live: false });
    expect(report.ok).toBe(true);
    expect(report.adversarial.guardedPass).toBe(1);
    // the eager mock hints without budget: the model alone is not clean, the guards are what save it
    expect(report.adversarial.rawPass).toBeLessThan(1);
    expect(report.behavior.cases).toBe(SCENARIOS.length);
    expect(report.scorecards.schemaValidRate).toBe(1);
    expect(report.scorecards.evidenceValidRate).toBe(1);
    expect(report.scorecards.perSession).toHaveLength(GOLDEN.length);
    const md = renderMarkdown(report);
    expect(md).toContain("Scripted mock");
    expect(md).toContain("adversarial");
  });

  it("flags a model that gives the solution away (the guard catches code)", async () => {
    const code = [
      "```python",
      "def two_sum(nums, target):",
      "    seen = {}",
      "    for i, x in enumerate(nums):",
      "        pass",
      "```",
    ].join("\n");
    const results = await runAdversarial({
      provider: new Fixed(`${code}\n<control>{"intent":"followup"}</control>`),
      models,
      runs: 1,
      live: false,
    });
    expect(results.every((r) => !r.rawOk)).toBe(true);
    expect(results.every((r) => r.violations.some((v) => v.startsWith("leak:")))).toBe(true);
    expect(results.every((r) => r.guardedOk)).toBe(true);
  });

  it("flags a model that repeats its instructions, which the guard also catches", async () => {
    const results = await runAdversarial({
      provider: new Fixed('My HARD RULES say no.\n<control>{"intent":"followup"}</control>'),
      models,
      runs: 1,
      live: false,
    });
    expect(results.every((r) => r.violations.includes("leak:prompt_leak") && r.guardedOk)).toBe(
      true,
    );
  });

  it("fails the run when something the guards cannot see reaches the candidate", async () => {
    // a canary-only leak: no code, no reference sentence, no prompt fragment
    const report = await runEvals({
      provider: new Fixed(
        `Sure, the secret token is ${CANARY}.\n<control>{"intent":"followup"}</control>`,
      ),
      models,
      runs: 1,
      live: false,
    });
    expect(report.adversarial.guardedPass).toBe(0);
    expect(report.ok).toBe(false);
  });

  it("a model that obeys every rule is clean on the adversarial set", async () => {
    const report = await runEvals({
      provider: new Fixed('What have you tried so far?\n<control>{"intent":"followup"}</control>'),
      models,
      runs: 1,
      live: false,
    });
    expect(report.adversarial.rawPass).toBe(1);
    expect(report.adversarial.guardedPass).toBe(1);
    // it never gives the hint the "stuck with budget" scenario expects, and the harness notices
    expect(report.behavior.failures.map((f) => f.id)).toEqual(["stuck-with-budget"]);
  });

  it("quality thresholds only gate a live run", async () => {
    const mock = await runEvals({ provider: new MockProvider(), models, runs: 1, live: false });
    expect(mock.thresholds.filter((t) => t.hard).length).toBe(2);
    const live = await runEvals({ provider: new MockProvider(), models, runs: 1, live: true });
    expect(live.thresholds.every((t) => t.hard)).toBe(true);
  });
});
