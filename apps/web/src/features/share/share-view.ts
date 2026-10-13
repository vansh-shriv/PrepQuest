import type { PublicReportDto, ShareDto, ShareEntity, ShareOptions } from "@prepquest/shared";

// Pure helpers for the sharing screens (no I/O, unit tested).

export const ENTITY_LABEL: Record<ShareEntity, string> = {
  scorecard: "Interview scorecard",
  contest: "Contest result",
  readiness: "Readiness summary",
};

export const EXPIRY_OPTIONS = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "never", label: "Never" },
] as const;

/** The safest settings: a summary and scores only. */
export const DEFAULT_OPTIONS: ShareOptions = {
  hideTranscript: true,
  hideCode: true,
  hideCompany: true,
  hideName: false,
};

/** The full link to copy: the page address on this site plus the token path. */
export function shareUrl(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}${path}`;
}

/** One line on what a link shows, for the manage list. */
export function optionsText(o: ShareOptions): string {
  const hidden = [
    o.hideTranscript && "transcript quotes",
    o.hideCode && "code quotes",
    o.hideCompany && "company",
    o.hideName && "name",
  ].filter(Boolean);
  return hidden.length > 0 ? `Hides ${hidden.join(", ")}` : "Shows everything in the report";
}

export function statusText(s: Pick<ShareDto, "status" | "expiresAt">): string {
  if (s.status === "revoked") return "Revoked";
  if (s.status === "expired") return "Expired";
  return s.expiresAt ? `Expires ${new Date(s.expiresAt).toLocaleDateString()}` : "Never expires";
}

export function viewsText(views: number): string {
  return `${views} view${views === 1 ? "" : "s"}`;
}

/** The card heading for the public report. */
export function reportHeading(kind: ShareEntity): string {
  return kind === "scorecard"
    ? "Mock interview scorecard"
    : kind === "contest"
      ? "Contest result"
      : "Placement readiness";
}

/** The line link previews show under the title. */
export function reportDescription(p: PublicReportDto["payload"]): string {
  if (p.kind === "scorecard")
    return `${p.overall === null ? "Scored" : `${p.overall}/100`}${p.band ? ` (${p.band})` : ""} in a ${p.minutes}-minute AI mock interview on PrepQuest.`;
  if (p.kind === "contest") return `Placed #${p.rank} of ${p.of} in a PrepQuest coding contest.`;
  return p.score === null
    ? "A placement readiness summary from PrepQuest."
    : `Placement readiness ${p.score}/100 on PrepQuest.`;
}
