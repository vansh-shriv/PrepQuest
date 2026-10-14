import { describe, expect, it } from "vitest";
import {
  bestMatch,
  buildIcs,
  canOpen,
  feedbackNudges,
  leftover,
  noShowDue,
  overlapMs,
  peerClock,
  reputation,
  type PeerOffer,
} from "./peer.js";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 14, 12, 0);
const offer = (
  id: string,
  startMin: number,
  endMin: number,
  o: Partial<PeerOffer> = {},
): PeerOffer => ({
  userId: id,
  window: { startsAt: NOW + startMin * MIN, endsAt: NOW + endMin * MIN },
  prefs: { topics: ["dsa"], difficulty: 2, language: "python" },
  rating: null,
  noShowRate: 0,
  ...o,
});

describe("matching", () => {
  const me = offer("me", 60, 240);

  it("needs a shared topic and enough common time", () => {
    expect(overlapMs(me.window, offer("x", 200, 300).window)).toBe(40 * MIN);
    const opts = { minutes: 60, now: NOW };
    expect(bestMatch(me, [offer("x", 200, 300)], opts)).toBeNull(); // 40 min is not 60
    const cs = offer("y", 60, 240, { prefs: { topics: ["cs"], difficulty: 2, language: null } });
    expect(bestMatch(me, [cs], opts)).toBeNull();
    expect(bestMatch(me, [offer("z", 100, 240)], opts)).toMatchObject({
      userId: "z",
      topic: "dsa",
      startsAt: NOW + 100 * MIN,
    });
  });

  it("never matches someone with oneself, a blocked person, or a start with no lead time", () => {
    const opts = { minutes: 40, now: NOW };
    expect(bestMatch(me, [me], opts)).toBeNull();
    expect(bestMatch(me, [offer("b", 60, 240)], { ...opts, blocked: new Set(["b"]) })).toBeNull();
    // both are free from now+10 min but the lead time pushes the start to now+30
    const soon = bestMatch(offer("m", 10, 200), [offer("s", 10, 200)], opts);
    expect(soon!.startsAt).toBe(NOW + 30 * MIN);
  });

  it("prefers a close difficulty, the same language and a reliable partner, and is stable on ties", () => {
    const opts = { minutes: 40, now: NOW };
    const far = offer("far", 60, 240, {
      prefs: { topics: ["dsa"], difficulty: 3, language: "python" },
    });
    const near = offer("near", 60, 240);
    expect(bestMatch(me, [far, near], opts)!.userId).toBe("near");
    const flaky = offer("flaky", 60, 240, { noShowRate: 0.5 });
    const steady = offer("steady", 60, 240, { rating: 4.6 });
    expect(bestMatch(me, [flaky, steady], opts)!.userId).toBe("steady");
    const a = offer("a", 60, 240);
    const b = offer("b", 60, 240);
    expect(bestMatch(me, [b, a], opts)!.userId).toBe("a");
    expect(bestMatch(me, [a, b], opts)!.userId).toBe("a");
  });

  it("keeps what is left of a window after a session, dropping slivers", () => {
    const w = { startsAt: 0, endsAt: 300 * MIN };
    expect(leftover(w, 100 * MIN, 60)).toEqual([
      { startsAt: 0, endsAt: 100 * MIN },
      { startsAt: 160 * MIN, endsAt: 300 * MIN },
    ]);
    expect(leftover(w, 10 * MIN, 280)).toEqual([]);
  });
});

describe("the two halves", () => {
  const base = { startedAt: NOW, minutes: 60, firstCandidate: "a" as const };
  it("swaps roles at half time and runs out at the end", () => {
    expect(peerClock({ ...base, now: NOW + 10 * MIN })).toMatchObject({
      half: 1,
      candidate: "a",
      interviewer: "b",
      halfRemainingMs: 20 * MIN,
      questionIndex: 0,
    });
    expect(peerClock({ ...base, now: NOW + 30 * MIN })).toMatchObject({
      half: 2,
      candidate: "b",
      interviewer: "a",
      halfRemainingMs: 30 * MIN,
      questionIndex: 1,
    });
    expect(peerClock({ ...base, now: NOW + 61 * MIN })).toMatchObject({
      half: "over",
      remainingMs: 0,
    });
  });

  it("opens shortly before the start and not after the end; a no-show is due after 15 minutes", () => {
    const at = NOW + 60 * MIN;
    expect(canOpen(at, 60, at - 11 * MIN)).toBe(false);
    expect(canOpen(at, 60, at - 9 * MIN)).toBe(true);
    expect(canOpen(at, 60, at + 60 * MIN)).toBe(false);
    expect(noShowDue(at, at + 14 * MIN)).toBe(false);
    expect(noShowDue(at, at + 15 * MIN)).toBe(true);
  });
});

describe("reputation", () => {
  it("judges nobody before three sessions", () => {
    expect(reputation({ sessions: 1, noShows: 1, helpfulness: [1], punctuality: [1] }).label).toBe(
      "new",
    );
  });
  it("pulls the rating to a prior and labels reliable, mixed and unreliable", () => {
    const good = reputation({
      sessions: 5,
      noShows: 0,
      helpfulness: [5, 5, 4, 5],
      punctuality: [5, 5, 5, 5],
    });
    expect(good).toMatchObject({ label: "reliable", noShowRate: 0 });
    expect(good.rating!).toBeGreaterThan(4.5);
    expect(
      reputation({ sessions: 4, noShows: 0, helpfulness: [2, 3, 3, 2], punctuality: [3, 3, 3, 3] })
        .label,
    ).toBe("mixed");
    expect(reputation({ sessions: 3, noShows: 2, helpfulness: [5], punctuality: [5] }).label).toBe(
      "unreliable",
    );
    expect(
      reputation({ sessions: 0, noShows: 0, helpfulness: [], punctuality: [] }).rating,
    ).toBeNull();
  });
});

describe("feedback nudges", () => {
  const long =
    "You explained the hash map idea clearly at the start, but when you coded the loop you skipped the empty input check, so try listing edge cases first.";
  it("flags short, vague and uniform feedback and passes concrete feedback", () => {
    expect(feedbackNudges({ ratings: {}, comments: "Good job" }).map((n) => n.code)).toEqual([
      "short",
    ]);
    expect(
      feedbackNudges({
        ratings: {},
        comments:
          "It was a really nice session and you did well overall in everything that we talked about today",
      }).map((n) => n.code),
    ).toEqual(["no-specifics"]);
    expect(
      feedbackNudges({
        ratings: { punctuality: 5, helpfulness: 5, preparedness: 5 },
        comments: long,
      }).map((n) => n.code),
    ).toEqual(["uniform"]);
    expect(
      feedbackNudges({
        ratings: { punctuality: 5, helpfulness: 4, preparedness: 3 },
        comments: long,
      }),
    ).toEqual([]);
  });
});

describe("calendar file", () => {
  it("is a valid event with escaped text, a reminder, CRLF lines folded at 75 characters", () => {
    const ics = buildIcs({
      uid: "abc",
      startsAt: Date.UTC(2026, 9, 14, 15, 30),
      minutes: 60,
      title: "Peer mock; DSA, with Sam",
      description: "x".repeat(200),
      url: "https://prepquest.dev/peer/abc",
      stampedAt: NOW,
    });
    expect(ics).toContain("DTSTART:20261014T153000Z");
    expect(ics).toContain("DTEND:20261014T163000Z");
    expect(ics).toContain("SUMMARY:Peer mock\\; DSA\\, with Sam");
    expect(ics).toContain("TRIGGER:-PT15M");
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
});
