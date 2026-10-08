import { cx } from "../lib/cx";

export interface LoadingBarProps {
  /** 0-100. Omit for an indeterminate (marching) bar. */
  value?: number;
  label?: string;
  segments?: number;
  size?: "sm" | "md";
  className?: string;
}

/** The LOADING bar: lime blocks fill in discrete steps. */
export function LoadingBar({
  value,
  label,
  segments = 10,
  size = "md",
  className,
}: LoadingBarProps) {
  const determinate = typeof value === "number";
  const clamped = determinate ? Math.min(100, Math.max(0, value)) : undefined;
  const on =
    clamped === undefined ? Math.ceil(segments / 2) : Math.round((clamped / 100) * segments);

  return (
    <div
      className={cx(
        "pq-loading",
        !determinate && "pq-loading--indeterminate",
        size === "sm" && "pq-loading--sm",
        className,
      )}
      role="progressbar"
      aria-label={label ?? "Loading"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      {label ? <span className="pq-loading__label">{label}</span> : null}
      <div className="pq-loading__track">
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} className="pq-loading__block" data-on={i < on} />
        ))}
      </div>
    </div>
  );
}

export interface StageBarProps {
  stages: readonly string[];
  /** Index of the current stage. Stages before it are complete. */
  current: number;
  label?: string;
}

/** Judge-style stage bar: QUEUED, COMPILING, RUNNING, DONE. Announces stage changes politely. */
export function StageBar({ stages, current, label }: StageBarProps) {
  const safe = Math.min(Math.max(current, 0), stages.length - 1);
  const value = stages.length > 1 ? (safe / (stages.length - 1)) * 100 : 100;
  return (
    <div>
      <LoadingBar value={value} label={label} segments={stages.length * 3} />
      <div className="pq-stages" aria-live="polite">
        {stages.map((s, i) => (
          <span key={s} aria-current={i === safe ? "step" : undefined}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
