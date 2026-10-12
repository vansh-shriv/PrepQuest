import type { PlanTaskDto } from "@prepquest/shared";

// Pure helpers for the plan and analytics screens (no I/O, unit tested).

export interface DayGroup {
  date: string;
  tasks: PlanTaskDto[];
  minutes: number;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parts = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

export const addDay = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "Today", "Tomorrow", "Yesterday" or "Wed 4 Mar". */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDay(today, 1)) return "Tomorrow";
  if (day === addDay(today, -1)) return "Yesterday";
  const p = parts(day);
  return `${WEEKDAY[p.wd]} ${p.d} ${MONTH[p.m - 1]}`;
}

export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Tasks grouped by day, days in order; finished-and-skipped tasks stay (the caller filters). */
export function groupByDay(tasks: readonly PlanTaskDto[]): DayGroup[] {
  const map = new Map<string, PlanTaskDto[]>();
  for (const t of tasks) map.set(t.date, [...(map.get(t.date) ?? []), t]);
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({
      date,
      tasks: list,
      minutes: list.filter((t) => t.status !== "skipped").reduce((a, t) => a + t.estMinutes, 0),
    }));
}

export interface PlanSplit {
  today: DayGroup | null;
  upcoming: DayGroup[];
  past: DayGroup[];
}

export function splitPlan(tasks: readonly PlanTaskDto[], today: string): PlanSplit {
  const days = groupByDay(tasks);
  return {
    today: days.find((d) => d.date === today) ?? null,
    upcoming: days.filter((d) => d.date > today),
    past: days.filter((d) => d.date < today).reverse(),
  };
}

/** Share of the plan's open work that is done, 0 to 100. */
export function progressPercent(tasks: readonly PlanTaskDto[]): number {
  const counted = tasks.filter((t) => t.status !== "skipped");
  if (counted.length === 0) return 0;
  return Math.round((counted.filter((t) => t.status === "done").length / counted.length) * 100);
}

/** An SVG polyline path for values on a fixed vertical range; null values break the line. */
export function linePath(
  values: readonly (number | null)[],
  width: number,
  height: number,
  min = 0,
  max = 100,
): string {
  const n = values.length;
  if (n === 0) return "";
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
  const y = (v: number) =>
    height - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * height;
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

/** "42 ± 18", or "Not enough data". */
export function scoreText(score: number | null, band: number | null): string {
  return score === null ? "Not enough data" : band === null ? String(score) : `${score} ± ${band}`;
}

/** A wide band means the number is a rough guess: say so plainly. */
export const isRough = (band: number | null): boolean => band !== null && band >= 12;
