import { describe, expect, it } from "vitest";
import { toHex, toRuleColor, withAlpha } from "./editor-colors";

describe("toHex", () => {
  it("expands the shorthand a CSS minifier produces (the production crash)", () => {
    expect(toHex("#fff")).toBe("#ffffff");
    expect(toHex(" #0A5 ")).toBe("#00aa55");
    expect(toHex("#abcd")).toBe("#aabbccdd");
  });

  it("passes full hex through, lowercased", () => {
    expect(toHex("#1A1A1A")).toBe("#1a1a1a");
    expect(toHex("#12345678")).toBe("#12345678");
  });

  it("converts rgb()/rgba() forms", () => {
    expect(toHex("rgb(255, 0, 128)")).toBe("#ff0080");
    expect(toHex("rgb(0 0 0)")).toBe("#000000");
    expect(toHex("rgba(0, 0, 0, 0.5)")).toBe("#00000080");
    expect(toHex("rgb(10 20 30 / 50%)")).toBe("#0a141e80");
    expect(toHex("rgba(1, 2, 3, 1)")).toBe("#010203");
  });

  it("falls back for anything unusable instead of throwing", () => {
    expect(toHex("")).toBe("#000000");
    expect(toHex("var(--x)")).toBe("#000000");
    expect(toHex("not a color", "#123456")).toBe("#123456");
  });
});

describe("rule and alpha helpers", () => {
  it("toRuleColor drops the # and any alpha", () => {
    expect(toRuleColor("#fff")).toBe("ffffff");
    expect(toRuleColor("#11223344")).toBe("112233");
  });

  it("withAlpha always yields an 8-digit hex", () => {
    expect(withAlpha("#fff", 170)).toBe("#ffffffaa");
    expect(withAlpha("rgb(0, 0, 0)", 0)).toBe("#00000000");
    expect(withAlpha("#123456", 999)).toBe("#123456ff");
  });
});
