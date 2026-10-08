import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { Input } from "./Input";
import { LoadingBar, StageBar } from "./LoadingBar";
import { Sprite } from "./Sprite";
import { Tabs } from "./Tabs";

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
