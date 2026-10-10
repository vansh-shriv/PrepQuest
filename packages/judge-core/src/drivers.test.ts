import { describe, expect, it } from "vitest";
import { buildSources } from "./drivers.js";
import type { Signature } from "./types.js";

const sig: Signature = {
  function: "solve",
  params: [
    { name: "nums", type: "int[]" },
    { name: "words", type: "string[]" },
    { name: "grid", type: "long[][]" },
    { name: "flag", type: "bool" },
    { name: "x", type: "double" },
  ],
  returns: "int[][]",
};

describe("buildSources", () => {
  it("python appends the driver after the user's code", () => {
    const [file] = buildSources("python", "class Solution:\n    pass", sig);
    expect(file?.name).toBe("main.py");
    expect(file?.content.startsWith("class Solution:\n    pass\n")).toBe(true);
    expect(file?.content).toContain('"fn":"solve"');
    expect(file?.content).toContain('"int[]"');
  });
  it("c++ keeps the user's line numbers and reads each parameter in order", () => {
    const [file] = buildSources("cpp", "class Solution {};", sig);
    expect(file?.name).toBe("main.cpp");
    expect(file?.content).toMatch(/#line 1 "main.cpp"\nclass Solution \{\};/);
    expect(file?.content).toContain("vector<int> a0; pq::read(a0);");
    expect(file?.content).toContain("vector<string> a1; pq::read(a1);");
    expect(file?.content).toContain("vector<vector<long long>> a2; pq::read(a2);");
    expect(file?.content).toContain("pq_solution.solve(a0, a1, a2, a3, a4)");
  });
  it("java writes the user's class and a separate Main that calls it", () => {
    const files = buildSources("java", "class Solution {}", sig);
    expect(files.map((f) => f.name)).toEqual(["Solution.java", "Main.java"]);
    expect(files[1]?.content).toContain("new Solution().solve(a0, a1, a2, a3, a4)");
    expect(files[1]?.content).toContain("static long[][] rd_long_2()");
    expect(files[1]?.content).toContain("static void wr_int_2(StringBuilder sb, int[][] v)");
  });
});
