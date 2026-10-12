import { linePath } from "@/features/planning/plan-view";

export interface Series {
  label: string;
  values: (number | null)[];
  /** A design token, e.g. `var(--leaf)`. */
  color: string;
}

/** A small accessible line chart on a fixed 0-100 (or custom) range. Colors come from design tokens. */
export function LineChart({
  series,
  height = 120,
  min = 0,
  max = 100,
  ariaLabel,
}: {
  series: Series[];
  height?: number;
  min?: number;
  max?: number;
  ariaLabel: string;
}) {
  const width = 400;
  const n = Math.max(0, ...series.map((s) => s.values.length));
  if (n === 0) return <p className="m-0 text-sm text-ink-soft">Nothing to chart yet.</p>;
  return (
    <figure className="m-0 grid gap-1">
      <svg
        viewBox={`-4 -4 ${width + 8} ${height + 8}`}
        className="h-auto w-full border-[3px] border-ink bg-surface"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={height * f}
            y2={height * f}
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeDasharray="4 4"
          />
        ))}
        {series.map((s) => (
          <g key={s.label}>
            <path
              d={linePath(s.values, width, height, min, max)}
              fill="none"
              stroke={s.color}
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
            {s.values.map((v, i) =>
              v === null ? null : (
                <circle
                  key={i}
                  cx={n === 1 ? width / 2 : (i / (n - 1)) * width}
                  cy={height - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * height}
                  r={3}
                  fill={s.color}
                />
              ),
            )}
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-3 text-sm">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-4"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Vertical bars for a histogram. */
export function Bars({
  values,
  labels,
  ariaLabel,
}: {
  values: number[];
  labels: string[];
  ariaLabel: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div role="img" aria-label={ariaLabel} className="grid gap-1">
      <div className="flex h-16 items-end gap-1">
        {values.map((v, i) => (
          <span
            key={i}
            className="flex-1 bg-leaf"
            style={{
              height: `${v === 0 ? 4 : Math.max(12, (v / max) * 100)}%`,
              opacity: v === 0 ? 0.25 : 1,
            }}
            title={`${labels[i]}: ${v}`}
          />
        ))}
      </div>
      <div className="flex gap-1 text-[10px] text-ink-soft">
        {labels.map((l, i) => (
          <span key={i} className="flex-1 text-center">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
