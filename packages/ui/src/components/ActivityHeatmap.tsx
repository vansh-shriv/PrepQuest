import { cx } from "../lib/cx";

export interface HeatDay {
  day: string;
  count: number;
}

export interface HeatCell {
  day: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export const heatLevel = (count: number): HeatCell["level"] =>
  count <= 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Cells for the last `weeks` weeks ending on `today`, oldest first, laid out by week (columns start on
 * Sunday). Days before the first column's start and after `today` are padded with `null`.
 */
export function buildHeatmap(
  today: string,
  weeks: number,
  data: readonly HeatDay[],
): Array<Array<HeatCell | null>> {
  const counts = new Map(data.map((d) => [d.day, d.count]));
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const start = addDays(today, -(dow + (weeks - 1) * 7));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = addDays(start, w * 7 + d);
      if (day > today) return null;
      const count = counts.get(day) ?? 0;
      return { day, count, level: heatLevel(count) };
    }),
  );
}

export interface ActivityHeatmapProps {
  /** The player's local "today" (`YYYY-MM-DD`). */
  today: string;
  data: readonly HeatDay[];
  weeks?: number;
  className?: string;
}

/** Activity calendar: one square per day, darker for more solved problems. Counts are in the tooltips and the label. */
export function ActivityHeatmap({ today, data, weeks = 26, className }: ActivityHeatmapProps) {
  const columns = buildHeatmap(today, weeks, data);
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const activeDays = data.filter((d) => d.count > 0).length;
  return (
    <div
      className={cx("pq-heat", className)}
      role="img"
      aria-label={`Activity over the last ${weeks} weeks: ${total} problems solved on ${activeDays} days`}
    >
      {columns
        .flat()
        .map((cell, i) =>
          cell ? (
            <span
              key={cell.day}
              className="pq-heat__cell"
              data-level={cell.level}
              title={`${cell.day}: ${cell.count} solved`}
            />
          ) : (
            <span key={`pad-${i}`} className="pq-heat__cell pq-heat__cell--pad" />
          ),
        )}
    </div>
  );
}
