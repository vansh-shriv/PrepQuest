import { describe, expect, it } from "vitest";
import {
  compareClaim,
  estimateGrowth,
  parseBigO,
  staticHints,
  type GrowthId,
  type ScaleSample,
} from "./complexity.js";
import { buildScaledInput, scaleIssues, type ScaleSpec } from "./scale.js";

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZES = [1000, 2000, 4000, 8000, 16000, 32000, 64000];
const SHAPE: Record<Exclude<GrowthId, "2n">, (n: number) => number> = {
  n: (n) => n,
  nlogn: (n) => n * Math.log2(n),
  n2: (n) => n * n,
  n3: (n) => n * n * n,
};

/** A run whose slowest size takes `peakMs`, with a start-up cost and timer noise of a few ms. */
function synth(id: keyof typeof SHAPE, seed: number, peakMs: number): ScaleSample[] {
  const r = rng(seed);
  const f = SHAPE[id];
  const last = SIZES[SIZES.length - 1]!;
  return SIZES.map((n) => {
    const ideal = 18 + (f(n) / f(last)) * peakMs;
    const noise = (r() - 0.5) * 6 + (r() - 0.5) * 0.06 * ideal;
    return { n, timeMs: Math.max(1, Math.round(ideal + noise)) };
  });
}

describe("estimateGrowth", () => {
  it("finds the true class among the plausible ones for noisy runs (>= 90%)", () => {
    let total = 0;
    let inside = 0;
    let exact = 0;
    for (const id of ["n", "nlogn", "n2"] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const res = estimateGrowth(synth(id, seed, id === "n" ? 400 : 1500));
        total++;
        if (res.status === "ok") {
          if (res.estimate.plausible.includes(id)) inside++;
          if (res.estimate.best === id) exact++;
        }
      }
    }
    expect(inside / total).toBeGreaterThanOrEqual(0.9);
    expect(exact / total).toBeGreaterThanOrEqual(0.7);
  });

  it("separates quadratic and cubic growth from linear", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const q = estimateGrowth(synth("n2", seed, 3000));
      expect(q.status === "ok" && q.estimate.plausible.includes("n")).toBe(false);
      const c = estimateGrowth(synth("n3", seed, 6000));
      expect(c.status === "ok" && c.estimate.best).toBe("n3");
    }
  });

  it("calls a run that barely changes too fast to judge", () => {
    const flat: ScaleSample[] = SIZES.map((n, i) => ({ n, timeMs: 20 + (i % 2) }));
    expect(estimateGrowth(flat).status).toBe("too_fast");
  });

  it("asks for more sizes when too few finished", () => {
    expect(estimateGrowth(synth("n", 1, 400).slice(0, 3)).status).toBe("not_enough_data");
  });
});

// timings of the reference solutions measured through the real judge (process sandbox, Python, three runs each)
const REAL: Record<string, { truth: GrowthId; series: string }> = {
  "edit-distance": { truth: "n2", series: "100:120 200:140 400:173 800:396 1600:1361 2400:3563" },
  "three-sum": {
    truth: "n2",
    series: "100:137 200:116 400:132 800:174 1200:260 1600:384 2000:537",
  },
  "two-sum": {
    truth: "n",
    series: "500:102 1000:105 2000:106 4000:111 8000:111 16000:114 32000:125 64000:156 128000:242",
  },
  "max-subarray-sum": {
    truth: "n",
    series:
      "500:117 1000:104 2000:105 4000:110 8000:117 16000:127 32000:142 64000:158 128000:215 256000:337",
  },
  "move-zeroes": {
    truth: "n",
    series:
      "1000:104 2000:104 4000:114 8000:117 16000:115 32000:129 64000:152 128000:217 256000:319 512000:568",
  },
  "merge-intervals": {
    truth: "nlogn",
    series: "500:104 1000:109 2000:110 4000:115 8000:127 16000:149 32000:205 64000:334",
  },
  "top-k-frequent": {
    truth: "n",
    series:
      "500:109 1000:113 2000:110 4000:108 8000:116 16000:110 32000:168 64000:135 128000:171 256000:241",
  },
  "valid-parentheses": {
    truth: "n",
    series: "20000:107 40000:105 80000:117 160000:124 320000:173 640000:175",
  },
  "product-except-self": {
    truth: "n",
    series:
      "500:105 1000:107 2000:108 4000:107 8000:116 16000:125 32000:146 64000:187 128000:299 256000:456",
  },
};

describe("estimateGrowth on real judge timings", () => {
  it.each(Object.entries(REAL))(
    "keeps the true class of %s among the plausible ones",
    (_slug, c) => {
      const samples = c.series.split(" ").map((p) => {
        const [n, t] = p.split(":");
        return { n: Number(n), timeMs: Number(t) };
      });
      const res = estimateGrowth(samples);
      expect(res.status).toBe("ok");
      if (res.status === "ok") expect(res.estimate.plausible).toContain(c.truth);
    },
  );

  it("leaves a run that hit the time limit out of the fit, so slow code is not mistaken for fast", () => {
    // measured on the real judge: nested loops, the last size ran out of time (its 6.4 s is only a lower bound)
    const series = "500:95 1000:133 2000:277 4000:820 8000:3000"
      .split(" ")
      .map((p) => ({ n: Number(p.split(":")[0]), timeMs: Number(p.split(":")[1]) }));
    const res = estimateGrowth([...series, { n: 16000, timeMs: 6400, censored: true }]);
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.estimate.best).toBe("n2");
      expect(res.estimate.plausible).not.toContain("n");
    }
  });

  it("does not call a noisy linear run quadratic with confidence", () => {
    const res = estimateGrowth(
      "500:105 1000:107 2000:115 4000:103 8000:114 16000:112 32000:114 64000:135 128000:188"
        .split(" ")
        .map((p) => ({ n: Number(p.split(":")[0]), timeMs: Number(p.split(":")[1]) })),
    );
    expect(res.status === "ok" && res.estimate.confidence).not.toBe("high");
    expect(res.status === "ok" && res.estimate.plausible).toContain("n");
  });
});

describe("parseBigO", () => {
  it.each([
    ["O(n log n)", "nlogn"],
    ["O(N*logN)", "nlogn"],
    ["n^2", "n2"],
    ["O(n²)", "n2"],
    ["O(n³)", "n3"],
    ["O(2^n)", "2n"],
    ["O(log n)", "logn"],
    ["o(1)", "1"],
    ["O(n)", "n"],
  ])("reads %s", (text, id) => expect(parseBigO(text)).toBe(id));

  it("does not guess at classes it does not know", () => {
    expect(parseBigO("O(n*m)")).toBeNull();
    expect(parseBigO("fast")).toBeNull();
  });
});

describe("compareClaim", () => {
  const quad = estimateGrowth(synth("n2", 3, 3000));
  it("says what was measured against what was claimed", () => {
    const c = compareClaim("O(n log n)", quad, { line: 18, depth: 2 });
    expect(c.verdict).toBe("worse");
    expect(c.message).toContain("You claimed O(n log n)");
    expect(c.message).toContain("O(n²)");
    expect(c.message).toContain("line 18");
  });
  it("agrees when the claim is among the plausible classes", () => {
    expect(compareClaim("n^2", quad).verdict).toBe("matches");
  });
  it("notes a claim better than the measurement is not a bug in the code", () => {
    const lin = estimateGrowth(synth("n", 4, 800));
    expect(compareClaim("O(n^2)", lin).verdict).toBe("better");
  });
  it("cannot separate sublinear claims from O(n)", () => {
    const lin = estimateGrowth(synth("n", 5, 800));
    const c = compareClaim("O(log n)", lin);
    expect(c.verdict).toBe("inconclusive");
    expect(c.message).toContain("reading the input");
  });
  it("is honest when the run was too fast", () => {
    const c = compareClaim("O(n)", estimateGrowth(SIZES.map((n) => ({ n, timeMs: 20 }))));
    expect(c.verdict).toBe("inconclusive");
    expect(c.message).toContain("not a proof");
  });
});

describe("staticHints", () => {
  it("finds the nesting depth and the inner loop in Python", () => {
    const code = `def f(nums):\n    for i in range(len(nums)):\n        for j in range(i):\n            pass\n    return 0\n`;
    const h = staticHints("python", code);
    expect(h).toMatchObject({ maxLoopDepth: 2, deepestLine: 3, recursion: false, loopClass: "n2" });
  });
  it("sees sequential loops as depth 1", () => {
    const h = staticHints(
      "python",
      "def f(a):\n    for x in a:\n        pass\n    for y in a:\n        pass\n",
    );
    expect(h.maxLoopDepth).toBe(1);
  });
  it("finds nested loops and recursion in C++", () => {
    const code = `int fib(int n) {\n  if (n < 2) return n;\n  return fib(n - 1) + fib(n - 2);\n}\nint g(vector<int>& a) {\n  for (int i = 0; i < 3; i++) {\n    for (int j = 0; j < 3; j++) {\n      for (int k = 0; k < 3; k++) {}\n    }\n  }\n  return 0;\n}\n`;
    const h = staticHints("cpp", code);
    expect(h.maxLoopDepth).toBe(3);
    expect(h.deepestLine).toBe(8);
    expect(h.recursion).toBe(true);
    expect(h.loopClass).toBe("n3");
  });
  it("does not call a loop-free helper recursive", () => {
    const h = staticHints("java", "class S {\n  int a(int x) {\n    return x + 1;\n  }\n}\n");
    expect(h.recursion).toBe(false);
  });
});

describe("buildScaledInput", () => {
  const params = [
    { name: "nums", type: "int[]" },
    { name: "target", type: "int" },
  ];
  const spec: ScaleSpec = {
    sizes: [10, 20, 40, 80, 160],
    args: {
      nums: { kind: "ints", min: -5, max: 5 },
      target: { kind: "int", value: 1000 },
    },
  };
  it("writes the canonical text and is repeatable", () => {
    const a = buildScaledInput(spec, params, 6);
    expect(a).toBe(buildScaledInput(spec, params, 6));
    const lines = a.trimEnd().split("\n");
    expect(lines[0]).toBe("6");
    expect(lines[1]!.split(" ")).toHaveLength(6);
    expect(lines[2]).toBe("1000");
  });
  it("makes distinct values and a square grid", () => {
    const d = buildScaledInput(
      { sizes: [], args: { a: { kind: "ints", min: 0, max: 99, order: "distinct" } } },
      [{ name: "a", type: "int[]" }],
      50,
    );
    expect(new Set(d.split("\n")[1]!.split(" ")).size).toBe(50);
    const g = buildScaledInput(
      { sizes: [], args: { g: { kind: "grid", chars: "01" } } },
      [{ name: "g", type: "string[]" }],
      100,
    );
    expect(g.split("\n")[0]).toBe("10");
    expect(g.trimEnd().split("\n")).toHaveLength(11);
  });
  it("reports mismatches with the signature", () => {
    expect(scaleIssues(spec, params)).toEqual([]);
    const bad: ScaleSpec = { sizes: [10, 5], args: { nums: { kind: "string", alphabet: "ab" } } };
    const issues = scaleIssues(bad, params).join("|");
    expect(issues).toContain("at least 5 sizes");
    expect(issues).toContain("ascending");
    expect(issues).toContain('cannot make "nums"');
    expect(issues).toContain('no generator for parameter "target"');
  });
});
