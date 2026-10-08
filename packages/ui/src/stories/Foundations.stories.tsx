import type { Meta, StoryObj } from "@storybook/react-vite";
import { SPRITE_NAMES, Sprite } from "../index";

const meta: Meta = { title: "Foundations" };
export default meta;

const TOKENS = [
  "bg",
  "surface",
  "surface-alt",
  "ink",
  "ink-soft",
  "shadow",
  "sky",
  "sky-light",
  "folder",
  "folder-dark",
  "leaf",
  "leaf-dark",
  "lime",
  "olive",
  "sun",
  "coin",
  "blossom",
  "cursor",
  "danger",
];

export const Palette: StoryObj = {
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 16,
      }}
    >
      {TOKENS.map((t) => (
        <div
          key={t}
          className="pq-box"
          style={{ background: `var(--${t})`, height: 72, padding: 8 }}
        >
          <span
            className="pq-font-ui"
            style={{ background: "var(--surface)", color: "var(--ink)", padding: "0 4px" }}
          >
            {t}
          </span>
        </div>
      ))}
    </div>
  ),
};

export const Typography: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="pq-font-display" style={{ fontSize: 20 }}>
        PRESS START 2P: QUEST COMPLETE
      </div>
      <div className="pq-font-ui" style={{ fontSize: 16 }}>
        Silkscreen: ui labels and nav
      </div>
      <div className="pq-font-pixel" style={{ fontSize: 24 }}>
        VT323: short pixel body text
      </div>
      <p style={{ maxWidth: 560 }}>
        Inter for long reading such as problem statements, transcripts and editorials.
      </p>
      <code style={{ fontFamily: "var(--font-code)" }}>const code = "JetBrains Mono";</code>
    </div>
  ),
};

export const Sprites: StoryObj = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 32 }}>
      {SPRITE_NAMES.map((name) => (
        <figure key={name} style={{ margin: 0, textAlign: "center" }}>
          <Sprite name={name} scale={6} animate label={name} />
          <figcaption className="pq-font-ui">{name}</figcaption>
        </figure>
      ))}
    </div>
  ),
};

export const Elevation: StoryObj = {
  render: () => (
    <div
      className="pq-box pq-lift"
      style={{ background: "var(--surface)", padding: 24, maxWidth: 320 }}
    >
      Notched outline + hard offset shadow, no blur.
    </div>
  ),
};
