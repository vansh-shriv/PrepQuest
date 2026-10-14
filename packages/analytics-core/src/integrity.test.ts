import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aiStyleMarker,
  behaviorSignals,
  fingerprint,
  hashSet,
  linesOfRanges,
  normalizeTokens,
  raise,
  similarity,
  similaritySeverity,
  type CodeLanguage,
} from "./integrity.js";

const PROBLEMS = path.resolve(import.meta.dirname, "../../../content/problems");
const EXT: Record<CodeLanguage, string> = { python: "py", cpp: "cpp", java: "java" };

function solution(slug: string, language: CodeLanguage): string | null {
  const file = path.join(PROBLEMS, slug, "solutions", `ref.${EXT[language]}`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

const slugs = readdirSync(PROBLEMS).filter((d) =>
  existsSync(path.join(PROBLEMS, d, "signature.json")),
);

/** The same program with every name changed, new comments and different spacing. */
function disguise(language: CodeLanguage, code: string): string {
  const kw = new Set(normalizeTokens(language, code).filter((t) => /^[a-z]+$/.test(t)));
  let n = 0;
  const names = new Map<string, string>();
  const renamed = code.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (w) => {
    if (kw.has(w) || ["self", "True", "False", "None"].includes(w)) return w;
    if (!names.has(w)) names.set(w, `v${n++}`);
    return names.get(w)!;
  });
  const note = language === "python" ? "# my own notes here" : "// my own notes here";
  return renamed
    .split("\n")
    .map((l) => (l.trim() ? `${l}  ${note}` : l))
    .join("\n\n");
}

describe("normalizeTokens", () => {
  it("ignores names, numbers, strings, comments and spacing", () => {
    const a = normalizeTokens("python", "x = foo(1, 'a')  # note\n");
    const b = normalizeTokens("python", 'total   =   bar(99,\n  "zzz")');
    expect(a).toEqual(b);
  });
  it("keeps the shape of the program", () => {
    expect(normalizeTokens("python", "for i in a:\n  pass")).not.toEqual(
      normalizeTokens("python", "while a:\n  pass"),
    );
  });
  it("skips block comments and docstrings", () => {
    expect(normalizeTokens("cpp", "int a; /* hidden */ a++;")).toEqual(
      normalizeTokens("cpp", "int b; b++;"),
    );
    expect(normalizeTokens("python", '"""doc"""\nx = 1')).toEqual(["S", "I", "=", "N"]);
  });
});

describe("similarity on real solutions", () => {
  const python = slugs.flatMap((s) => {
    const code = solution(s, "python");
    return code ? [{ slug: s, code }] : [];
  });

  it("finds a copy whose names, comments and spacing were changed", () => {
    let flagged = 0;
    let tested = 0;
    for (const { code } of python) {
      const a = fingerprint("python", code);
      const b = fingerprint("python", disguise("python", code));
      if (Math.min(a.tokenCount, b.tokenCount) < 60) continue;
      tested++;
      const s = similarity(a, b);
      if (!s.trivial && s.score >= 0.9) flagged++;
    }
    expect(tested).toBeGreaterThan(5);
    expect(flagged).toBe(tested);
  });

  it("finds copies in C++ and Java too", () => {
    for (const language of ["cpp", "java"] as const) {
      let checked = 0;
      for (const slug of slugs) {
        const code = solution(slug, language);
        if (!code) continue;
        const a = fingerprint(language, code);
        const b = fingerprint(language, disguise(language, code));
        if (Math.min(a.tokenCount, b.tokenCount) < 60) continue;
        const s = similarity(a, b);
        if (s.trivial) continue;
        checked++;
        expect(s.score, `${slug} ${language}`).toBeGreaterThanOrEqual(0.9);
      }
      expect(checked).toBeGreaterThan(3);
    }
  });

  it("does not flag unrelated solutions (precision)", () => {
    let pairs = 0;
    let falseAlarms = 0;
    for (let i = 0; i < python.length; i++) {
      for (let j = i + 1; j < python.length; j++) {
        const s = similarity(
          fingerprint("python", python[i]!.code),
          fingerprint("python", python[j]!.code),
        );
        if (s.trivial) continue;
        pairs++;
        if (similaritySeverity(s.score)) falseAlarms++;
      }
    }
    expect(pairs).toBeGreaterThan(10);
    expect(falseAlarms).toBe(0);
  });

  it("does not flag different approaches to the same problem", () => {
    let compared = 0;
    for (const slug of slugs) {
      const file = path.join(PROBLEMS, slug, "editorial.json");
      if (!existsSync(file)) continue;
      const doc = JSON.parse(readFileSync(file, "utf8")) as {
        approaches: Array<{ code: { python?: string | { file: string } } }>;
      };
      const codes = doc.approaches.flatMap((a) => {
        const c = a.code.python;
        if (typeof c === "string") return [c];
        if (c && existsSync(path.join(PROBLEMS, slug, c.file)))
          return [readFileSync(path.join(PROBLEMS, slug, c.file), "utf8")];
        return [];
      });
      for (let i = 0; i < codes.length; i++) {
        for (let j = i + 1; j < codes.length; j++) {
          const s = similarity(fingerprint("python", codes[i]!), fingerprint("python", codes[j]!));
          if (s.trivial) continue;
          compared++;
          expect(similaritySeverity(s.score), slug).toBeNull();
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(0);
  });

  it("calls tiny programs trivial instead of matching them", () => {
    const tiny = "class Solution:\n    def f(self, n):\n        return n * 2\n";
    const s = similarity(fingerprint("python", tiny), fingerprint("python", tiny));
    expect(s.trivial).toBe(true);
    expect(s.score).toBe(0);
  });

  it("ignores what comes from the starter code", () => {
    const code = python.find((p) => fingerprint("python", p.code).tokenCount > 80)!.code;
    const own = hashSet("python", code);
    const s = similarity(fingerprint("python", code), fingerprint("python", code), own);
    expect(s.trivial).toBe(true);
  });

  it("maps matched token ranges back to lines", () => {
    const code = "def f(a):\n    t = 0\n    for x in a:\n        t += x\n    return t\n";
    expect(linesOfRanges("python", code, [{ from: 0, to: 2 }])).toEqual([1]);
    expect(linesOfRanges("python", code, [{ from: 9, to: 16 }])).toEqual([3, 4]);
  });

  it("reports which tokens matched", () => {
    const code = python.find((p) => fingerprint("python", p.code).tokenCount > 80)!.code;
    const s = similarity(
      fingerprint("python", code),
      fingerprint("python", disguise("python", code)),
    );
    expect(s.ranges.length).toBeGreaterThan(0);
    expect(s.ranges[0]!.to).toBeGreaterThanOrEqual(s.ranges[0]!.from);
  });
});

describe("severity and behaviour", () => {
  it("needs a clear match before a similarity is a flag", () => {
    expect(similaritySeverity(0.5)).toBeNull();
    expect(similaritySeverity(0.86)).toBe("medium");
    expect(similaritySeverity(0.97)).toBe("high");
  });
  it("treats a few pastes or tab changes as normal", () => {
    expect(behaviorSignals({ paste: 2, blur: 8 })).toEqual({ paste: null, focus: null });
    expect(behaviorSignals({ paste: 5, blur: 20 })).toEqual({ paste: "low", focus: "low" });
    expect(behaviorSignals({ paste: 12, blur: 50 })).toEqual({ paste: "medium", focus: "medium" });
  });
  it("raises a severity by one level and stops at high", () => {
    expect(raise("low")).toBe("medium");
    expect(raise("high")).toBe("high");
  });
  it("marks a heavily commented answer weakly", () => {
    const body = Array.from(
      { length: 5 },
      (_, i) => `    # First we walk through the list and track item number ${i}.\n    x = ${i}`,
    ).join("\n");
    expect(aiStyleMarker("python", `def f():\n${body}\n`).marked).toBe(true);
    expect(aiStyleMarker("python", "def f():\n    # fine\n    return 1\n").marked).toBe(false);
  });
});
