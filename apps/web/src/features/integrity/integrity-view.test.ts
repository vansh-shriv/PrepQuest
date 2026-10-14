import { describe, expect, it } from "vitest";
import type { FlagListItem, MyIntegrityNotice } from "@prepquest/shared";
import {
  allowedDecisions,
  countsText,
  flagSummary,
  noticeHeadline,
  percent,
} from "./integrity-view";

describe("allowedDecisions", () => {
  it("lets any reviewer decide, dismiss or pass up a waiting flag", () => {
    expect(allowedDecisions("open", "reviewer")).toEqual(["confirm", "dismiss", "escalate"]);
    expect(allowedDecisions("appealed", "moderator")).toEqual(["confirm", "dismiss", "escalate"]);
  });
  it("leaves an escalated flag to an admin", () => {
    expect(allowedDecisions("escalated", "reviewer")).toEqual([]);
    expect(allowedDecisions("escalated", "admin")).toEqual(["confirm", "dismiss"]);
  });
  it("offers the opposite of a decision already made, and no escalation", () => {
    expect(allowedDecisions("confirmed", "reviewer")).toEqual(["dismiss"]);
    expect(allowedDecisions("dismissed", "reviewer")).toEqual(["confirm"]);
  });
});

describe("text", () => {
  it("shows a score as a percentage", () => {
    expect(percent(0.9712)).toBe("97%");
    expect(percent(null)).toBe("-");
  });
  it("summarises a row", () => {
    const f = {
      kind: "similarity",
      score: 0.9,
      user: { handle: "ada", displayName: "Ada" },
      contest: { slug: "c", title: "Friday round" },
    } as FlagListItem;
    expect(flagSummary(f)).toBe("Code similarity 90% · ada · Friday round");
  });
  it("words the learner's notices", () => {
    expect(noticeHeadline({ status: "confirmed" } as MyIntegrityNotice)).toMatch(/decision/);
    expect(noticeHeadline({ status: "appealed" } as MyIntegrityNotice)).toMatch(/being reviewed/);
    expect(noticeHeadline({ status: "dismissed" } as MyIntegrityNotice)).toMatch(/accepted/);
  });
  it("lists behaviour counts", () => {
    expect(countsText({ paste: 6, blur: 20 })).toBe(
      "6 paste events, 20 times the window lost focus",
    );
    expect(countsText(null)).toBeNull();
  });
});
