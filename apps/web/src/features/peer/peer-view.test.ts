import { describe, expect, it } from "vitest";
import {
  clockText,
  defaultWindow,
  fromLocalInput,
  inviteUrl,
  reputationText,
  toLocalInput,
  tokenFromInput,
  whenLabel,
} from "./peer-view";

describe("peer view helpers", () => {
  it("round-trips a local date-time and rejects junk", () => {
    const d = new Date(2026, 9, 14, 18, 30);
    expect(toLocalInput(d)).toBe("2026-10-14T18:30");
    expect(fromLocalInput("2026-10-14T18:30")).toBe(d.toISOString());
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("not a date")).toBeNull();
  });

  it("proposes a window at least an hour away on a quarter hour, two hours long", () => {
    const now = new Date(2026, 9, 14, 12, 7);
    const w = defaultWindow(now);
    expect(w.from).toBe("2026-10-14T13:15");
    expect(w.to).toBe("2026-10-14T15:15");
  });

  it("formats the clock and the time label", () => {
    expect(clockText(90_500)).toBe("01:31");
    expect(clockText(-5)).toBe("00:00");
    expect(clockText(0)).toBe("00:00");
    expect(whenLabel("2026-10-14T15:30:00Z", "UTC")).toMatch(/Wed.*14 Oct.*15:30/);
  });

  it("says plainly what a reputation means", () => {
    expect(
      reputationText({ sessions: 1, noShows: 0, noShowRate: 0, rating: 4, label: "new" }),
    ).toMatch(/not enough sessions/);
    expect(
      reputationText({ sessions: 4, noShows: 1, noShowRate: 0.2, rating: 4.46, label: "reliable" }),
    ).toBe("Reliable: 4.5 of 5, 4 sessions, 1 no-show");
  });

  it("takes a token from a pasted link", () => {
    expect(inviteUrl("https://x.dev", "abc_DEF-123")).toBe("https://x.dev/peer/join/abc_DEF-123");
    expect(tokenFromInput(" https://x.dev/peer/join/abc_DEF-123 ")).toBe("abc_DEF-123");
    expect(tokenFromInput("abc_DEF-123")).toBe("abc_DEF-123");
  });
});
