import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { InterviewSessionDto, ReadinessDto, ScorecardDto } from "@prepquest/shared";
import { drawable, OG_HEIGHT, OG_WIDTH, renderOgPng, textWidth } from "./og-image.js";
import {
  buildContestReport,
  buildReadinessReport,
  buildScorecardReport,
  clean,
  nameTerms,
  redactContact,
  scrub,
  type Privacy,
} from "./report.js";

const privacy = (over: Partial<Privacy["options"]> = {}): Privacy => ({
  options: { hideTranscript: true, hideCode: true, hideCompany: true, hideName: false, ...over },
  companyTerms: ["Initech", "Initech Labs"],
  nameTerms: nameTerms("Ada Lovelace", "ada_l"),
});

describe("scrubbing text", () => {
  it("replaces whole words only, ignoring case, longest term first", () => {
    expect(
      scrub(
        "I met INITECH Labs and initech staff; Initechnology is fine",
        ["Initech", "Initech Labs"],
        "X",
      ),
    ).toBe("I met X and X staff; Initechnology is fine");
    expect(scrub("nothing here", [], "X")).toBe("nothing here");
    expect(scrub("a.b is (not) special", ["a.b", "(not)"], "X")).toBe("X is X special");
  });
  it("always removes emails, links and phone numbers", () => {
    const t = redactContact(
      "Mail ada@example.com or see https://linkedin.com/in/ada, call +91 98765 43210 or (555) 123-4567.",
    );
    expect(t).not.toMatch(/@|linkedin|9876|4567/);
    expect(t).toContain("[email]");
    expect(t).toContain("[link]");
    expect(t.match(/\[phone\]/g)).toHaveLength(2);
  });
  it("keeps dates and ordinary numbers", () => {
    expect(
      redactContact("On 2026-03-10 I solved 12 problems in 45 minutes (2025-2026)."),
    ).toContain("2026-03-10");
  });
  it("hides the learner's name and handle when asked, and the company when asked", () => {
    const p = privacy({ hideName: true });
    expect(clean("Ada Lovelace (ada_l) did well at Initech.", p)).toBe(
      "the candidate (the candidate) did well at the company.",
    );
    expect(clean("Ada did well at Initech.", privacy())).toBe("Ada did well at the company.");
    expect(clean("Ada did well at Initech.", privacy({ hideCompany: false }))).toBe(
      "Ada did well at Initech.",
    );
  });
});

const session: Pick<
  InterviewSessionDto,
  "title" | "type" | "level" | "role" | "company" | "minutes"
> = {
  title: "Coding interview for Initech",
  type: "dsa",
  level: "intern",
  role: "SDE at Initech",
  company: "Initech",
  minutes: 30,
};

const card = {
  overall: 74,
  band: "Ready",
  summary: "Ada reasoned well. Reach her at ada@example.com. Good fit for Initech.",
  strengths: [
    {
      text: "Clear hash map plan",
      evidence: [
        { type: "turn", ref: 3, quote: "I would use a hash map at Initech scale" },
        { type: "code", ref: "1", quote: "seen[target - x] = j" },
      ],
    },
  ],
  redFlags: [
    {
      category: "communication",
      severity: "low",
      text: "Went quiet while coding",
      evidence: [{ type: "turn", ref: 5, quote: "uh" }],
      remedy: "Narrate",
    },
  ],
  nextActions: [{ kind: "topic", ref: "x", title: "Private thing", why: "y" }],
  coverage: null,
  helpful: null,
  rubric: { id: "coding", version: "1" },
  model: null,
  scores: [
    {
      dimension: "communication",
      name: "Communication",
      score: 4,
      weight: 20,
      justification: "Talked through each step.",
      evidence: [
        { type: "turn", ref: 3, quote: "first the brute force" },
        { type: "code", ref: "1", quote: "for i in range(n)" },
      ],
    },
  ],
} as unknown as ScorecardDto;

describe("scorecard report", () => {
  it("shares a summary and scores only by default: no quotes, no company, no private next steps", () => {
    const r = buildScorecardReport(card, session, privacy());
    expect(r.company).toBeNull();
    expect(r.title).toBe("Coding interview for the company");
    expect(r.role).toBe("SDE at the company");
    expect(r.summary).toBe("Ada reasoned well. Reach her at [email]. Good fit for the company.");
    expect(r.scores[0]!.quotes).toEqual([]);
    expect(r.strengths[0]!.quotes).toEqual([]);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/Initech|ada@example|remedy|Private thing|nextActions|evidence/);
  });
  it("includes transcript quotes and code quotes only when each is allowed", () => {
    const withTranscript = buildScorecardReport(card, session, privacy({ hideTranscript: false }));
    expect(withTranscript.scores[0]!.quotes).toEqual(["first the brute force"]);
    expect(withTranscript.strengths[0]!.quotes).toEqual([
      "I would use a hash map at the company scale",
    ]);
    const withCode = buildScorecardReport(card, session, privacy({ hideCode: false }));
    expect(withCode.scores[0]!.quotes).toEqual(["for i in range(n)"]);
    const both = buildScorecardReport(
      card,
      session,
      privacy({ hideTranscript: false, hideCode: false }),
    );
    expect(both.scores[0]!.quotes).toHaveLength(2);
  });
  it("shows the company when the learner chooses to", () => {
    const r = buildScorecardReport(card, session, privacy({ hideCompany: false }));
    expect(r.company).toBe("Initech");
    expect(r.title).toContain("Initech");
  });
  it("never carries the learner's name when it is hidden", () => {
    const r = buildScorecardReport(card, session, privacy({ hideName: true }));
    expect(JSON.stringify(r)).not.toMatch(/Ada|ada_l|Lovelace/);
  });
});

describe("contest and readiness reports", () => {
  it("keeps the result and drops handles and problem titles", () => {
    const r = buildContestReport(
      "Friday round",
      { scoring: "icpc", total: 12 },
      {
        rank: 3,
        handle: "ada_l",
        displayName: "Ada",
        solved: 2,
        penalty: 55,
        score: 0,
        isMe: true,
        cells: [
          { label: "A", solved: true, wrong: 1, minute: 12, score: 0, pending: 0 },
          { label: "B", solved: false, wrong: 2, minute: null, score: 0, pending: 0 },
        ],
      },
    );
    expect(r).toMatchObject({ rank: 3, of: 12, solved: 2, penalty: 55 });
    expect(JSON.stringify(r)).not.toMatch(/ada_l|Ada/);
  });
  it("shows the score and components but not the plan, levers or dates", () => {
    const readiness = {
      target: "initech-sde",
      targetTitle: "Initech SDE",
      score: 62,
      band: 6,
      label: "On the way",
      coverage: 0.8,
      components: [
        {
          key: "dsa",
          label: "DSA",
          source: "x",
          weight: 40,
          score: 0.7,
          confidence: 1,
          points: 28,
          headroom: 12,
        },
      ],
      limiting: [],
      levers: [{ action: "secret", gain: 3, component: "dsa" }],
      eta: { goal: 70, date: "2026-05-01", pointsPerDay: 1, message: "m", onTrack: true },
      placementDate: "2026-06-01",
      needsDiagnostic: false,
      note: "n",
    } as unknown as ReadinessDto;
    const r = buildReadinessReport(readiness, privacy());
    expect(r.target).toBe("Target hidden");
    expect(JSON.stringify(r)).not.toMatch(/secret|2026-05|2026-06|Initech/);
    expect(buildReadinessReport(readiness, privacy({ hideCompany: false })).target).toBe(
      "Initech SDE",
    );
  });
});

/** Reads the header and the pixels of a PNG that this module wrote (truecolor, 8 bit, no filter). */
function decode(png: Buffer) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let off = 8;
  const idat: Buffer[] = [];
  let width = 0;
  let height = 0;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    const body = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    }
    if (type === "IDAT") idat.push(body);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const pixel = (x: number, y: number) => {
    const i = y * (width * 3 + 1) + 1 + x * 3;
    return [raw[i]!, raw[i + 1]!, raw[i + 2]!];
  };
  return { width, height, raw, pixel };
}

describe("report image", () => {
  const base = {
    heading: "Mock interview scorecard",
    title: "Coding interview",
    big: "74",
    unit: "/100",
    sub: "Ready",
    footer: "Ada",
  };
  it("is a valid 1200x630 PNG", () => {
    const img = decode(renderOgPng(base));
    expect(img.width).toBe(OG_WIDTH);
    expect(img.height).toBe(OG_HEIGHT);
    expect(img.raw.length).toBe((OG_WIDTH * 3 + 1) * OG_HEIGHT);
    expect(img.pixel(5, 5)).toEqual([30, 36, 51]); // outside the frame
    expect(img.pixel(600, 80)).toEqual([243, 233, 210]); // on the panel
  });
  it("draws the big number in colour by tone, and is deterministic", () => {
    const good = renderOgPng({ ...base, tone: "good" });
    expect(good.equals(renderOgPng({ ...base, tone: "good" }))).toBe(true);
    expect(good.equals(renderOgPng({ ...base, tone: "weak" }))).toBe(false);
    expect(good.equals(renderOgPng({ ...base, big: "75", tone: "good" }))).toBe(false);
    const px = decode(good);
    // somewhere inside the first digit is the green of a good score
    let green = false;
    for (let y = 330; y < 330 + 7 * 16 && !green; y++)
      for (let x = 84; x < 84 + 5 * 16; x++)
        if (px.pixel(x, y).join() === "76,154,79") {
          green = true;
          break;
        }
    expect(green).toBe(true);
  });
  it("copes with long, empty and unusual text", () => {
    const long = renderOgPng({
      ...base,
      title:
        "An extremely long interview title that keeps going and going well past two lines of the card",
      lines: ["one", "two", "three", "four", "five"],
      footer: "x".repeat(200),
    });
    expect(decode(long).height).toBe(OG_HEIGHT);
    expect(
      decode(renderOgPng({ ...base, title: "", big: "", sub: "", lines: [], footer: "" })).width,
    ).toBe(OG_WIDTH);
    expect(drawable("Café – ÅÖ 99% <b>")).toBe("CAFE   AO 99%  B ");
    expect(textWidth("AB", 4)).toBe(48);
  });
});
