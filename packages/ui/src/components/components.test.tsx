import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityHeatmap, buildHeatmap, heatLevel } from "./ActivityHeatmap";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Chip } from "./Chip";
import { Select, Textarea } from "./Field";
import { StatusBox } from "./StatusBox";
import { Input } from "./Input";
import { LoadingBar, StageBar } from "./LoadingBar";
import { Sprite } from "./Sprite";
import { Tabs } from "./Tabs";
import { VerdictBanner, type VerdictCode } from "./VerdictBanner";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("Button", () => {
  it("defaults to type=button and primary styling", () => {
    const out = html(<Button>Go</Button>);
    expect(out).toContain('type="button"');
    expect(out).not.toContain("pq-btn--accent");
  });

  it("is disabled and busy while loading, with an accessible label", () => {
    const out = html(<Button loading>Go</Button>);
    expect(out).toContain("disabled");
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Loading");
  });
});

describe("LoadingBar", () => {
  it("fills blocks proportionally and exposes progressbar semantics", () => {
    const out = html(<LoadingBar value={50} segments={10} />);
    expect(out).toContain('aria-valuenow="50"');
    expect(out.match(/data-on="true"/g)).toHaveLength(5);
  });

  it("clamps out-of-range values", () => {
    expect(html(<LoadingBar value={500} segments={4} />).match(/data-on="true"/g)).toHaveLength(4);
  });

  it("omits aria-valuenow when indeterminate", () => {
    const out = html(<LoadingBar />);
    expect(out).not.toContain("aria-valuenow");
    expect(out).toContain("pq-loading--indeterminate");
  });
});

describe("StageBar", () => {
  it("marks the current stage", () => {
    const out = html(<StageBar stages={["Queued", "Running", "Done"]} current={1} />);
    expect(out).toMatch(/aria-current="step"[^>]*>Running/);
  });
});

describe("Input", () => {
  it("links label, helper text and error state", () => {
    const out = html(<Input label="Email" error="Required" id="e" />);
    expect(out).toContain('for="e"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="e-note"');
    expect(out).toContain('role="alert"');
  });
});

describe("Sprite", () => {
  it("is aria-hidden unless labelled", () => {
    expect(html(<Sprite name="coin" />)).toContain('aria-hidden="true"');
    const labelled = html(<Sprite name="coin" label="XP coin" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="XP coin"');
  });

  it("scales the svg by art pixel size", () => {
    expect(html(<Sprite name="coin" scale={4} />)).toContain('width="48"');
  });
});

describe("Tabs", () => {
  it("renders the first tab selected with only its panel", () => {
    const out = html(
      <Tabs
        items={[
          { id: "a", label: "A", content: "panel-a" },
          { id: "b", label: "B", content: "panel-b" },
        ]}
      />,
    );
    expect(out).toContain(">panel-a<");
    expect(out).not.toContain(">panel-b<");
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1);
  });
});

describe("Chip", () => {
  it("adds tone class", () => {
    expect(html(<Chip tone="hard">Hard</Chip>)).toContain("pq-chip--hard");
  });
});

describe("Checkbox", () => {
  it("is a real labelled checkbox input", () => {
    const out = html(
      <Checkbox label="Show my bio" helper="Visible to everyone" defaultChecked id="b" />,
    );
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('for="b"');
    expect(out).toContain("Show my bio");
    expect(out).toContain("checked");
  });
});

describe("StatusBox", () => {
  it("announces its state and uses a distinct class per state", () => {
    for (const [status, label] of [
      ["unseen", "Not started"],
      ["attempted", "Attempted"],
      ["solved", "Solved"],
    ] as const) {
      const out = html(<StatusBox status={status} />);
      expect(out).toContain(`aria-label="${label}"`);
      expect(out).toContain(`pq-status--${status}`);
    }
  });
});

describe("Select and Textarea", () => {
  it("are labelled form controls with linked error text", () => {
    const select = html(
      <Select label="Sort" id="s" error="Pick one">
        <option>a</option>
      </Select>,
    );
    expect(select).toContain('for="s"');
    expect(select).toContain('aria-invalid="true"');
    expect(select).toContain('aria-describedby="s-note"');
    const area = html(<Textarea label="Statement" id="t" mono helper="Markdown" />);
    expect(area).toContain("pq-textarea--mono");
    expect(area).toContain('aria-describedby="t-note"');
  });
});

describe("VerdictBanner", () => {
  it("pairs every verdict with a text label and an icon, never color alone", () => {
    const codes: VerdictCode[] = ["AC", "WA", "TLE", "MLE", "RE", "CE", "OLE", "IE"];
    for (const code of codes) {
      const out = html(<VerdictBanner verdict={code} />);
      expect(out).toContain('role="status"');
      expect(out).toContain(`data-verdict="${code}"`);
      expect(out).toContain(`pq-verdict--${code.toLowerCase()}`);
      expect(out).toContain("<svg"); // sprite
      expect(out).toMatch(/pq-verdict__title">[^<]+</);
    }
  });

  it("shows detail and meta lines when given", () => {
    const out = html(<VerdictBanner verdict="WA" detail="Failed on test 4" meta="3 / 12 passed" />);
    expect(out).toContain("Wrong answer");
    expect(out).toContain("Failed on test 4");
    expect(out).toContain("3 / 12 passed");
    expect(html(<VerdictBanner verdict="IE" />)).toContain("Our bad");
  });
});

describe("ActivityHeatmap", () => {
  it("buckets counts into five levels", () => {
    expect([0, 1, 2, 3, 4, 6, 7, 40].map(heatLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("lays out whole weeks that end on today, padding the days after it", () => {
    // 2026-03-11 is a Wednesday
    const cols = buildHeatmap("2026-03-11", 3, [
      { day: "2026-03-11", count: 5 },
      { day: "2026-03-01", count: 1 },
    ]);
    expect(cols).toHaveLength(3);
    expect(cols.every((c) => c.length === 7)).toBe(true);
    expect(cols[0]?.[0]?.day).toBe("2026-02-22"); // the Sunday two weeks before this week's Sunday (Mar 8)
    expect(cols[1]?.[0]).toMatchObject({ day: "2026-03-01", count: 1, level: 1 });
    expect(cols[2]?.[3]).toMatchObject({ day: "2026-03-11", count: 5, level: 3 });
    expect(cols[2]?.slice(4)).toEqual([null, null, null]);
  });

  it("describes itself to screen readers", () => {
    const out = html(
      <ActivityHeatmap
        today="2026-03-11"
        weeks={4}
        data={[
          { day: "2026-03-10", count: 2 },
          { day: "2026-03-09", count: 1 },
        ]}
      />,
    );
    expect(out).toContain('role="img"');
    expect(out).toContain("3 problems solved on 2 days");
    expect(out).toContain('title="2026-03-10: 2 solved"');
  });
});

describe("Interview components", () => {
  const segments = [
    { key: "a", name: "Intro", startMs: 0, endMs: 300_000 },
    { key: "b", name: "Problem", startMs: 300_000, endMs: 1_200_000 },
  ];

  it("formats the clock and shifts the warning level", async () => {
    const { InterviewTimer, formatClock } = await import("./Interview");
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(-5)).toBe("00:00");
    const total = 1_200_000;
    expect(
      html(<InterviewTimer remainingMs={900_000} totalMs={total} segments={segments} />),
    ).toContain("pq-timer--ok");
    expect(
      html(<InterviewTimer remainingMs={500_000} totalMs={total} segments={segments} />),
    ).toContain("pq-timer--soon");
    const crit = html(<InterviewTimer remainingMs={30_000} totalMs={total} segments={segments} />);
    expect(crit).toContain("pq-timer--crit");
    expect(crit).toContain("Under 1 min"); // the level is also in words, not just colour
    expect(
      html(<InterviewTimer remainingMs={900_000} totalMs={total} segments={segments} paused />),
    ).toContain("PAUSED");
  });

  it("marks the segment that is running", async () => {
    const { InterviewTimer } = await import("./Interview");
    const out = html(
      <InterviewTimer remainingMs={800_000} totalMs={1_200_000} segments={segments} />,
    );
    expect(out.match(/data-current="true"/g)).toHaveLength(1);
  });

  it("renders a streaming bubble with a cursor and a hint flag", async () => {
    const { ChatBubble } = await import("./Interview");
    const out = html(
      <ChatBubble who="interviewer" streaming hint time="03:12">
        Hi
      </ChatBubble>,
    );
    expect(out).toContain("pq-bubble__cursor");
    expect(out).toContain("HINT");
    expect(out).toContain("03:12");
    expect(html(<ChatBubble who="candidate">Yo</ChatBubble>)).not.toContain("pq-bubble__cursor");
  });

  it("describes scores for assistive technology, including missing evidence", async () => {
    const { ScoreBar, RadarScore } = await import("./Interview");
    expect(html(<ScoreBar label="Testing" score={4} weight={0.1} />)).toContain(
      "Testing: 4 out of 5",
    );
    const none = html(<ScoreBar label="Testing" score={null} />);
    expect(none).toContain("not enough evidence");
    expect(none).toContain("n/a");
    const radar = html(
      <RadarScore
        axes={[
          { label: "A", value: 3 },
          { label: "B", value: null },
          { label: "C", value: 5 },
        ]}
      />,
    );
    expect(radar).toContain("Radar chart: A 3, B n/a, C 5");
    expect(radar.match(/<polygon/g)).toHaveLength(6); // five rings and the score shape
  });
});
