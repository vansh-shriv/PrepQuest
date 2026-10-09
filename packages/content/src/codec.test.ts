import { describe, expect, it } from "vitest";
import {
  CodecError,
  encodeInput,
  encodeOutput,
  encodeValue,
  parseInput,
  parseOutput,
} from "./codec.js";
import { signatureSchema, type Signature } from "./types.js";

const sig = (params: Array<[string, string]>, returns: string): Signature =>
  signatureSchema.parse({
    function: "solve",
    params: params.map(([name, type]) => ({ name, type })),
    returns,
  });

describe("encodeValue", () => {
  it("encodes scalars", () => {
    expect(encodeValue("int", -7)).toBe("-7\n");
    expect(encodeValue("long", 9007199254740991)).toBe("9007199254740991\n");
    expect(encodeValue("bool", true)).toBe("true\n");
    expect(encodeValue("double", 0.5)).toBe("0.5\n");
    expect(encodeValue("string", "a b, c")).toBe("a b, c\n");
    expect(encodeValue("string", "")).toBe("\n");
  });

  it("encodes arrays with a length line, and empty arrays with an empty line", () => {
    expect(encodeValue("int[]", [3, -1, 4])).toBe("3\n3 -1 4\n");
    expect(encodeValue("int[]", [])).toBe("0\n\n");
    expect(encodeValue("bool[]", [true, false])).toBe("2\ntrue false\n");
  });

  it("encodes string arrays one per line, preserving spaces and empties", () => {
    expect(encodeValue("string[]", ["ab cd", "", "x"])).toBe("3\nab cd\n\nx\n");
  });

  it("encodes 2D arrays as `k v1..vk` rows", () => {
    expect(encodeValue("int[][]", [[1, 2], [], [5]])).toBe("3\n2 1 2\n0\n1 5\n");
    expect(encodeValue("int[][]", [])).toBe("0\n");
  });

  it("rejects out-of-range, wrong-typed and unsafe values", () => {
    expect(() => encodeValue("int", 2 ** 31)).toThrow(/outside the int range/);
    expect(() => encodeValue("int", 1.5)).toThrow(CodecError);
    expect(() => encodeValue("long", 2 ** 60)).toThrow(/exact up to 2\^53/);
    expect(() => encodeValue("int[]", [1, "2"])).toThrow(/\[1\]/);
    expect(() => encodeValue("string", "two\nlines")).toThrow(/line breaks/);
    expect(() => encodeValue("bool", 1)).toThrow(CodecError);
    expect(() => encodeValue("int[]", 5)).toThrow(/expected an array/);
    expect(() => encodeValue("double", Number.NaN)).toThrow(CodecError);
  });
});

describe("encodeInput / parseInput round trip", () => {
  const s = sig(
    [
      ["nums", "int[]"],
      ["target", "int"],
      ["words", "string[]"],
      ["grid", "int[][]"],
      ["text", "string"],
    ],
    "long[]",
  );
  const args = [[2, 7, 11], -9, ["a b", ""], [[1], [2, 3]], "hello world"];

  it("round-trips every supported shape", () => {
    expect(parseInput(s, encodeInput(s, args))).toEqual(args);
  });

  it("concatenates arguments in signature order", () => {
    const text = encodeInput(
      sig(
        [
          ["a", "int"],
          ["b", "int[]"],
        ],
        "int",
      ),
      [5, [1, 2]],
    );
    expect(text).toBe("5\n2\n1 2\n");
  });

  it("round-trips empty and single-element edge shapes", () => {
    const e = sig(
      [
        ["a", "int[]"],
        ["s", "string"],
        ["m", "int[][]"],
      ],
      "int",
    );
    const input = [[], "", []];
    expect(parseInput(e, encodeInput(e, input))).toEqual(input);
    expect(parseInput(e, encodeInput(e, [[1], " ", [[]]]))).toEqual([[1], " ", [[]]]);
  });

  it("checks the argument count", () => {
    expect(() => encodeInput(s, [1])).toThrow(/expected 5 argument/);
  });
});

describe("parseInput strictness", () => {
  const s = sig(
    [
      ["a", "int[]"],
      ["k", "int"],
    ],
    "int",
  );

  it("accepts input with or without a final newline and tolerates trailing blank lines", () => {
    expect(parseInput(s, "2\n1 2\n3")).toEqual([[1, 2], 3]);
    expect(parseInput(s, "2\n1 2\n3\n\n\n")).toEqual([[1, 2], 3]);
  });

  it("reports precise problems", () => {
    expect(() => parseInput(s, "2\n1 2 3\n4\n")).toThrow(/expected 2 value\(s\), found 3/);
    expect(() => parseInput(s, "x\n1\n4\n")).toThrow(/length "x"/);
    expect(() => parseInput(s, "1\n1\n")).toThrow(/unexpected end of input/);
    expect(() => parseInput(s, "1\n1\n4\nextra\n")).toThrow(/unexpected extra data at line 4/);
    expect(() => parseInput(s, "1\n99999999999\n4\n")).toThrow(/out of range for int/);
    expect(() => parseInput(s, "1\r\n1\r\n4\r\n")).toThrow(/carriage returns/);
    expect(() => parseInput(s, "1\n1.5\n4\n")).toThrow(/not an integer/);
  });

  it("validates 2D rows and bool tokens", () => {
    const m = sig([["m", "int[][]"]], "int");
    expect(() => parseInput(m, "1\n3 1 2\n")).toThrow(/k values/);
    expect(parseInput(m, "2\n0\n2 4 5\n")).toEqual([[[], [4, 5]]]);
    const b = sig([["f", "bool"]], "bool");
    expect(() => parseInput(b, "True\n")).toThrow(/true\/false/);
  });
});

describe("output encoding", () => {
  it("round-trips return values", () => {
    const s = sig([["x", "int"]], "int[][]");
    const out = [[1, 2], [3]];
    expect(parseOutput(s, encodeOutput(s, out))).toEqual(out);
    const strOut = sig([["x", "int"]], "string");
    expect(parseOutput(strOut, encodeOutput(strOut, ""))).toBe("");
  });
});

describe("signatureSchema", () => {
  it("rejects bad identifiers, duplicate params and unknown types", () => {
    expect(
      signatureSchema.safeParse({
        function: "Bad",
        params: [{ name: "a", type: "int" }],
        returns: "int",
      }).success,
    ).toBe(false);
    expect(
      signatureSchema.safeParse({
        function: "f",
        params: [
          { name: "a", type: "int" },
          { name: "a", type: "int" },
        ],
        returns: "int",
      }).success,
    ).toBe(false);
    expect(
      signatureSchema.safeParse({
        function: "f",
        params: [{ name: "a", type: "map" }],
        returns: "int",
      }).success,
    ).toBe(false);
    expect(signatureSchema.safeParse({ function: "f", params: [], returns: "int" }).success).toBe(
      false,
    );
  });
});
