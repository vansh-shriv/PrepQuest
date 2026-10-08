import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HibpBreachChecker } from "./breach.js";
import { SecretBox } from "./encryption.js";

describe("SecretBox (AES-256-GCM)", () => {
  const box = new SecretBox(randomBytes(32).toString("base64"));

  it("round-trips and never repeats a ciphertext", () => {
    const a = box.encrypt("JBSWY3DPEHPK3PXP");
    const b = box.encrypt("JBSWY3DPEHPK3PXP");
    expect(a).not.toBe(b);
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(box.decrypt(a)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("detects tampering and wrong keys", () => {
    const ct = box.encrypt("secret");
    const parts = ct.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => box.decrypt(parts.join("."))).toThrow();
    expect(() => new SecretBox(randomBytes(32).toString("base64")).decrypt(ct)).toThrow();
  });

  it("rejects keys of the wrong length", () => {
    expect(() => new SecretBox(Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("HibpBreachChecker", () => {
  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  const respond = (body: string, status = 200) =>
    (async () => new Response(body, { status })) as typeof fetch;

  it("flags a password whose hash suffix is in the range response, sending only the prefix", async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      seen.push(url);
      return new Response(
        "0018A45C4D1DEF81644B54AB7F969B88D65:1\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824",
      );
    }) as unknown as typeof fetch;
    const checker = new HibpBreachChecker(fetchFn);
    expect(await checker.isBreached("password")).toBe(true);
    expect(seen).toEqual(["https://api.pwnedpasswords.com/range/5BAA6"]);
  });

  it("passes unknown passwords and ignores zero-count padding rows", async () => {
    const padded = "1E4C9B93F3F0682250B6CF8331B7EE68FD8:0\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3";
    expect(await new HibpBreachChecker(respond(padded)).isBreached("password")).toBe(false);
  });

  it("fails open and reports on errors and bad statuses", async () => {
    const errors: unknown[] = [];
    const failing = new HibpBreachChecker(respond("boom", 503), (e) => errors.push(e));
    expect(await failing.isBreached("password")).toBe(false);
    const throwing = new HibpBreachChecker(
      (async () => {
        throw new Error("offline");
      }) as typeof fetch,
      (e) => errors.push(e),
    );
    expect(await throwing.isBreached("password")).toBe(false);
    expect(errors).toHaveLength(2);
  });
});
