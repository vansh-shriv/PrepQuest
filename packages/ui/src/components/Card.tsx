import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("pq-card pq-box pq-lift", className)} {...rest} />;
}

export interface WindowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  tone?: "olive" | "sky" | "coin" | "sun" | "blossom" | "danger";
  /** Renders a close button in the title bar. */
  onClose?: () => void;
  /** Id placed on the title element (for aria-labelledby). */
  titleId?: string;
}

/** Old-OS window: colored title bar with tiny control buttons. Used for panels, modals, tools. */
export function Window({
  title,
  tone = "olive",
  onClose,
  titleId,
  className,
  children,
  ...rest
}: WindowProps) {
  return (
    <div
      className={cx(
        "pq-window pq-box pq-lift",
        tone !== "olive" && `pq-window--${tone}`,
        className,
      )}
      {...rest}
    >
      <div className="pq-window__bar">
        <span className="pq-window__title" id={titleId}>
          {title}
        </span>
        <span className="pq-window__ctl">
          {onClose ? (
            <button type="button" onClick={onClose} aria-label="Close">
              x
            </button>
          ) : (
            <span aria-hidden="true">-</span>
          )}
        </span>
      </div>
      <div className="pq-window__body">{children}</div>
    </div>
  );
}
