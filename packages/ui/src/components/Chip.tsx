import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "easy" | "medium" | "hard" | "info" | "special";
}

/** Small tag. Difficulty chips pair color with a text label (never color alone). */
export function Chip({ tone = "neutral", className, ...rest }: ChipProps) {
  return (
    <span
      className={cx("pq-chip", tone !== "neutral" && `pq-chip--${tone}`, className)}
      {...rest}
    />
  );
}
