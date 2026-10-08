import type { CSSProperties } from "react";
import { SPRITES, toRuns, type SpriteName } from "../sprites/art";
import { cx } from "../lib/cx";

export interface SpriteProps {
  name: SpriteName;
  /** CSS pixels per art pixel. Default 3. */
  scale?: number;
  /** Plays the sprite's built-in stepped animation, if it has one. */
  animate?: boolean;
  /** Accessible description. Omit for decorative sprites (they get aria-hidden). */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function Sprite({ name, scale = 3, animate = false, label, className, style }: SpriteProps) {
  const art = SPRITES[name];
  const cols = Math.max(...art.rows.map((r) => r.length));
  const rows = art.rows.length;
  const animation = animate && "animation" in art ? art.animation : undefined;

  return (
    <svg
      className={cx("pq-sprite", animation, className)}
      width={cols * scale}
      height={rows * scale}
      viewBox={`0 0 ${cols} ${rows}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={style}
    >
      {toRuns(art).map((r) => (
        <rect
          key={`${r.x}-${r.y}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={1}
          style={{ fill: r.color }}
        />
      ))}
    </svg>
  );
}
