import { describe, expect, it } from "vitest";
import type { ScorecardReport } from "@prepquest/shared";
import {
  DEFAULT_OPTIONS,
  optionsText,
  reportDescription,
  reportHeading,
  shareUrl,
  statusText,
  viewsText,
} from "./share-view";

describe("share text", () => {
  it("joins the origin and the token path once", () => {
    expect(shareUrl("https://prepquest.app/", "/r/abc")).toBe("https://prepquest.app/r/abc");
    expect(shareUrl("http://localhost:3000", "/r/abc")).toBe("http://localhost:3000/r/abc");
  });
  it("says what a link hides", () => {
    expect(optionsText(DEFAULT_OPTIONS)).toBe("Hides transcript quotes, code quotes, company");
    expect(optionsText({ ...DEFAULT_OPTIONS, hideName: true })).toMatch(/name$/);
    expect(
      optionsText({ hideTranscript: false, hideCode: false, hideCompany: false, hideName: false }),
    ).toBe("Shows everything in the report");
  });
  it("describes a link's status and views", () => {
    expect(statusText({ status: "revoked", expiresAt: null })).toBe("Revoked");
    expect(statusText({ status: "expired", expiresAt: "2026-01-01T00:00:00Z" })).toBe("Expired");
    expect(statusText({ status: "active", expiresAt: null })).toBe("Never expires");
    expect(statusText({ status: "active", expiresAt: "2026-03-10T12:00:00Z" })).toMatch(
      /^Expires /,
    );
    expect(viewsText(1)).toBe("1 view");
    expect(viewsText(0)).toBe("0 views");
  });
  it("names each kind of report", () => {
    expect(reportHeading("contest")).toBe("Contest result");
    expect(reportHeading("readiness")).toBe("Placement readiness");
    expect(reportHeading("scorecard")).toMatch(/scorecard/);
  });
  it("writes the line a link preview shows", () => {
    const base: ScorecardReport = {
      kind: "scorecard",
      title: "T",
      interviewType: "dsa",
      level: "intern",
      role: null,
      company: null,
      minutes: 30,
      overall: null,
      band: null,
      summary: null,
      scores: [],
      strengths: [],
      redFlags: [],
    };
    expect(reportDescription({ ...base, overall: 74, band: "Ready" })).toBe(
      "74/100 (Ready) in a 30-minute AI mock interview on PrepQuest.",
    );
    expect(reportDescription({ ...base, overall: null, band: null })).toMatch(
      /^Scored in a 30-minute/,
    );
    expect(
      reportDescription({
        kind: "contest",
        title: "T",
        scoring: "icpc",
        rank: 2,
        of: 9,
        solved: 1,
        penalty: 3,
        score: 0,
        problems: [],
      }),
    ).toBe("Placed #2 of 9 in a PrepQuest coding contest.");
    expect(
      reportDescription({
        kind: "readiness",
        title: "T",
        target: "x",
        label: "l",
        score: 61,
        band: 5,
        coverage: 1,
        components: [],
      }),
    ).toBe("Placement readiness 61/100 on PrepQuest.");
  });
});
