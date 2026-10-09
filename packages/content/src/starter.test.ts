import { describe, expect, it } from "vitest";
import { generateStarter } from "./starter.js";
import { signatureSchema } from "./types.js";

const twoSum = signatureSchema.parse({
  function: "twoSum",
  params: [
    { name: "nums", type: "int[]" },
    { name: "target", type: "int" },
  ],
  returns: "int[]",
});

describe("generateStarter", () => {
  it("python", () => {
    expect(generateStarter("python", twoSum)).toBe(
      "class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        pass\n",
    );
  });

  it("java", () => {
    const code = generateStarter("java", twoSum);
    expect(code).toContain("public int[] twoSum(int[] nums, int target)");
    expect(code).toContain("return new int[0];");
  });

  it("c++ passes arrays by reference and returns values", () => {
    const code = generateStarter("cpp", twoSum);
    expect(code).toContain("vector<int> twoSum(vector<int>& nums, int target)");
    expect(code).toContain("#include <bits/stdc++.h>");
  });

  it("maps every type", () => {
    const sig = signatureSchema.parse({
      function: "mix",
      params: [
        { name: "a", type: "long" },
        { name: "b", type: "string[]" },
        { name: "c", type: "int[][]" },
        { name: "d", type: "bool" },
        { name: "e", type: "double" },
      ],
      returns: "string",
    });
    expect(generateStarter("cpp", sig)).toContain(
      "string mix(long long a, vector<string>& b, vector<vector<int>>& c, bool d, double e)",
    );
    expect(generateStarter("java", sig)).toContain(
      "public String mix(long a, String[] b, int[][] c, boolean d, double e)",
    );
    expect(generateStarter("java", sig)).toContain('return "";');
    expect(generateStarter("python", sig)).toContain(
      "def mix(self, a: int, b: list[str], c: list[list[int]], d: bool, e: float) -> str:",
    );
    const arr = signatureSchema.parse({
      function: "f",
      params: [{ name: "x", type: "int" }],
      returns: "int[][]",
    });
    expect(generateStarter("java", arr)).toContain("return new int[0][0];");
  });
});
