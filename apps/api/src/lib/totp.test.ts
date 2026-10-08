import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateSecret,
  hotp,
  otpauthUrl,
  verifyTotp,
} from "./totp.js";

// RFC 6238 Appendix B: SHA-1 secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("base32", () => {
  it("matches the RFC 4648 vectors", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
  });

  it("round-trips random secrets and rejects bad characters", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(() => base32Decode("not*base32")).toThrow();
  });
});

describe("hotp / totp", () => {
  it("matches RFC 4226 / 6238 test vectors", () => {
    const key = Buffer.from("12345678901234567890");
    // RFC 4226 Appendix D (counter -> 6-digit HOTP)
    expect([0, 1, 2, 3].map((c) => hotp(key, c))).toEqual(["755224", "287082", "359152", "969429"]);
    // RFC 6238 Appendix B, last 6 of the 8-digit values
    const at = (t: number) => hotp(key, Math.floor(t / 30));
    expect(at(59)).toBe("287082");
    expect(at(1111111109)).toBe("081804");
    expect(at(1111111111)).toBe("050471");
    expect(at(1234567890)).toBe("005924");
    expect(at(2000000000)).toBe("279037");
  });

  it("accepts the current code and one step of drift, rejects others", () => {
    const now = 1111111109 * 1000;
    expect(verifyTotp(RFC_SECRET, "081804", { now })).toBe(Math.floor(1111111109 / 30));
    expect(verifyTotp(RFC_SECRET, "081804", { now: now + 30_000 })).not.toBeNull(); // 1 step late
    expect(verifyTotp(RFC_SECRET, "081804", { now: now + 90_000 })).toBeNull(); // too old
    expect(verifyTotp(RFC_SECRET, "000000", { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", { now })).toBeNull();
  });

  it("rejects a code whose step was already used (replay)", () => {
    const now = 1111111109 * 1000;
    const step = verifyTotp(RFC_SECRET, "081804", { now })!;
    expect(verifyTotp(RFC_SECRET, "081804", { now, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "081804", { now, lastStep: step - 1 })).toBe(step);
  });

  it("builds an otpauth URL authenticator apps understand", () => {
    const url = new URL(otpauthUrl("ada@example.com", "PrepQuest", RFC_SECRET));
    expect(url.protocol).toBe("otpauth:");
    expect(url.searchParams.get("secret")).toBe(RFC_SECRET);
    expect(url.searchParams.get("issuer")).toBe("PrepQuest");
    expect(decodeURIComponent(url.pathname)).toContain("ada@example.com");
  });
});
