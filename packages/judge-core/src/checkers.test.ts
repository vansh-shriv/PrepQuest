import { describe, expect, it } from "vitest";
import { check, normalizeExact } from "./checkers.js";

describe("exact checker", () => {
  const exact = { type: "exact" as const };
  it("ignores CRLF, trailing spaces and trailing blank lines", () => {
    expect(check(exact, "1\n2\n", "1  \r\n2\r\n\r\n\r\n").ok).toBe(true);
  });
  it("keeps leading whitespace and inner blank lines significant", () => {
    expect(check(exact, "a\n\nb", "a\nb").ok).toBe(false);
    expect(check(exact, "a b", " a b").ok).toBe(false);
  });
  it("explains the first difference", () => {
    expect(check(exact, "1\n2\n3", "1\n9\n3").message).toBe('Line 2: expected "2" but got "9".');
    expect(check(exact, "1\n2", "1").message).toContain("ends early");
    expect(check(exact, "1", "1\n2").message).toContain("Extra output");
  });
  it("normalises an empty output", () => {
    expect(normalizeExact("")).toEqual([]);
    expect(check(exact, "", "\n\n").ok).toBe(true);
  });
});

describe("token checkers", () => {
  it("tokens ignore whitespace layout", () => {
    expect(check({ type: "tokens" }, "1 2\n3", "1\n2   3\n").ok).toBe(true);
    expect(check({ type: "tokens" }, "1 2 3", "1 2").ok).toBe(false);
    expect(check({ type: "tokens" }, "1 2", "1 2 3").ok).toBe(false);
  });
  it("float accepts values within the tolerance only", () => {
    const f = { type: "float" as const, epsilon: 1e-6 };
    expect(check(f, "0.3333333", "0.33333333").ok).toBe(true);
    expect(check(f, "1e6", "1000000.5").ok).toBe(true); // relative tolerance
    expect(check(f, "0.5", "0.51").ok).toBe(false);
    expect(check(f, "abc", "abd").ok).toBe(false);
    expect(check(f, "1.0E-5", "0.00001").ok).toBe(true); // Java-style exponent
  });
  it("unordered compares sorted tokens", () => {
    expect(check({ type: "unordered" }, "3 1 2", "2 3 1").ok).toBe(true);
    expect(check({ type: "unordered" }, "3 1 2", "2 3 3").ok).toBe(false);
  });
  it("special checkers are not available yet", () => {
    expect(() => check({ type: "special" }, "", "")).toThrow();
  });
});
