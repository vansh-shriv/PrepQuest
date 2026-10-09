import type { ProblemListQuery } from "@prepquest/shared";

/** The problem list's filters live in the URL query string so every view is shareable (D1). */
export interface ListParams {
  q: string;
  topic: string[];
  pattern: string[];
  difficulty: string[];
  status: string[];
  sheet: string;
  topicMode: "any" | "all";
  sort: ProblemListQuery["sort"];
}

const csv = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

export function readParams(sp: URLSearchParams): ListParams {
  return {
    q: sp.get("q") ?? "",
    topic: csv(sp.get("topic")),
    pattern: csv(sp.get("pattern")),
    difficulty: csv(sp.get("difficulty")),
    status: csv(sp.get("status")),
    sheet: sp.get("sheet") ?? "",
    topicMode: sp.get("topicMode") === "all" ? "all" : "any",
    sort: (["difficulty", "acceptance", "recent"].includes(sp.get("sort") ?? "")
      ? sp.get("sort")
      : "default") as ProblemListQuery["sort"],
  };
}

/** Serialises only non-default values, so the URL stays short and clean. */
export function toQueryString(p: ListParams): string {
  const sp = new URLSearchParams();
  if (p.q.trim()) sp.set("q", p.q.trim());
  if (p.topic.length) sp.set("topic", p.topic.join(","));
  if (p.pattern.length) sp.set("pattern", p.pattern.join(","));
  if (p.difficulty.length) sp.set("difficulty", p.difficulty.join(","));
  if (p.status.length) sp.set("status", p.status.join(","));
  if (p.sheet) sp.set("sheet", p.sheet);
  if (p.topicMode === "all") sp.set("topicMode", "all");
  if (p.sort !== "default") sp.set("sort", p.sort);
  return sp.toString();
}

export function activeFilterCount(p: ListParams): number {
  return (
    p.topic.length +
    p.pattern.length +
    p.difficulty.length +
    p.status.length +
    (p.sheet ? 1 : 0) +
    (p.q.trim() ? 1 : 0)
  );
}

export const toggle = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
