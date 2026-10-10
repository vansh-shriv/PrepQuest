import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
