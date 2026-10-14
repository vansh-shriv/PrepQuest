import type {
  FlagDetail,
  FlagKind,
  FlagListItem,
  FlagSeverityValue,
  FlagStatus,
  MyIntegrityNotice,
} from "@prepquest/shared";

// Pure helpers for the integrity screens (no I/O, unit tested).

export const KIND_LABEL: Record<FlagKind, string> = {
  similarity: "Code similarity",
  paste: "Pasting",
  focus: "Tab changes",
};

export const SEVERITY_LABEL: Record<FlagSeverityValue, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const STATUS_LABEL: Record<FlagStatus, string> = {
  open: "Waiting for review",
  confirmed: "Confirmed",
  dismissed: "Dismissed",
  escalated: "Escalated to an admin",
  appealed: "Appealed",
};

/** What a learner is told about each kind of flag, in plain words. */
export const NOTICE_TEXT: Record<FlagKind, string> = {
  similarity: "A reviewer found your accepted solution very close to another participant's.",
  paste: "A reviewer found an unusual amount of pasting during the contest.",
  focus: "A reviewer found an unusual number of window changes during the contest.",
};

export const STATUS_FILTERS: Array<{ value: FlagStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "open", label: "Waiting" },
  { value: "appealed", label: "Appeals" },
  { value: "escalated", label: "Escalated" },
  { value: "confirmed", label: "Confirmed" },
  { value: "dismissed", label: "Dismissed" },
];

/** Which decisions this role may make on a flag in this state. */
export function allowedDecisions(
  status: FlagStatus,
  role: string | undefined,
): Array<"confirm" | "dismiss" | "escalate"> {
  if (status === "escalated") return role === "admin" ? ["confirm", "dismiss"] : [];
  const out: Array<"confirm" | "dismiss" | "escalate"> = [];
  if (status !== "confirmed") out.push("confirm");
  if (status !== "dismissed") out.push("dismiss");
  if (status === "open" || status === "appealed") out.push("escalate");
  return out;
}

export const DECISION_LABEL = {
  confirm: "Confirm",
  dismiss: "Dismiss",
  escalate: "Escalate to an admin",
} as const;

export function percent(score: number | null): string {
  return score === null ? "-" : `${Math.round(score * 100)}%`;
}

/** The learner's own line for a notice. */
export function noticeHeadline(n: MyIntegrityNotice): string {
  if (n.status === "dismissed") return "Your appeal was accepted";
  if (n.status === "appealed") return "Your appeal is being reviewed";
  return "A fair-play review reached a decision";
}

/** A one-line summary of a queue row. */
export function flagSummary(f: FlagListItem): string {
  const score = f.score === null ? "" : ` ${percent(f.score)}`;
  return `${KIND_LABEL[f.kind]}${score} · ${f.user.handle}${f.contest ? ` · ${f.contest.title}` : ""}`;
}

/** Counts shown to a reviewer next to a behaviour flag. */
export function countsText(counts: FlagDetail["counts"]): string | null {
  if (!counts) return null;
  return `${counts.paste} paste events, ${counts.blur} times the window lost focus`;
}
