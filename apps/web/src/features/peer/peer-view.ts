import type { PeerReputationDto, PeerSessionState } from "@prepquest/shared";

// Pure helpers for the peer pages: dates in the browser's own time zone, the clock, short labels.

const pad = (n: number) => String(n).padStart(2, "0");

/** `<input type="datetime-local">` value for a date, in the local time zone. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The ISO instant a `datetime-local` value means (local time zone). Null for an empty or invalid value. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A sensible first window: starts at the next quarter hour that is at least an hour away, lasts two hours. */
export function defaultWindow(now: Date): { from: string; to: string } {
  const quarter = 15 * 60_000;
  const start = new Date(Math.ceil((now.getTime() + 60 * 60_000) / quarter) * quarter);
  return {
    from: toLocalInput(start),
    to: toLocalInput(new Date(start.getTime() + 2 * 60 * 60_000)),
  };
}

export function whenLabel(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

/** `mm:ss` of a duration; never negative. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function reputationText(r: PeerReputationDto): string {
  if (r.label === "new") return "New: not enough sessions to judge yet";
  const rating = r.rating !== null ? `${r.rating.toFixed(1)} of 5` : "no ratings";
  const label = { reliable: "Reliable", mixed: "Mixed", unreliable: "Often misses sessions" }[
    r.label
  ];
  return `${label}: ${rating}, ${r.sessions} session${r.sessions === 1 ? "" : "s"}, ${r.noShows} no-show${r.noShows === 1 ? "" : "s"}`;
}

export const STATE_TEXT: Record<PeerSessionState, string> = {
  scheduled: "Booked",
  live: "Running",
  completed: "Finished",
  cancelled: "Cancelled",
  no_show: "Partner did not show",
};

/** The invite link a friend opens. */
export const inviteUrl = (origin: string, token: string) => `${origin}/peer/join/${token}`;

/** The token from a pasted invite link or a bare token. */
export function tokenFromInput(input: string): string {
  const t = input.trim();
  const m = t.match(/\/peer\/join\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? t;
}
