import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Use `accent` for the single primary CTA on a screen. */
  variant?: "primary" | "accent" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

/** Class list for the button look. Use on links (`<Link className={buttonClasses()}>`) so a link never wraps a button. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: Pick<ButtonProps, "variant" | "size" | "className"> = {}): string {
  return cx(
    "pq-btn pq-box pq-lift",
    variant !== "primary" && `pq-btn--${variant}`,
    size !== "md" && `pq-btn--${size}`,
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <span className="pq-btn__loading" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="pq-sr-only">Loading</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
