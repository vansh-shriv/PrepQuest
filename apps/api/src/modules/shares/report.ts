import type {
  ContestReport,
  EvidenceDto,
  InterviewSessionDto,
  ReadinessDto,
  ReadinessReport,
  ScorecardDto,
  ScorecardReport,
  ShareOptions,
  StandingRowDto,
  StandingsResponse,
} from "@prepquest/shared";

// Shareable reports (U5): the payload is built once, when the link is made, and already filtered. Nothing
// else about the learner can reach the viewer. Pure functions (no I/O), unit tested.

const COMPANY_WORDS = "the company";
const NAME_WORDS = "the candidate";
export const ANONYMOUS_OWNER = "A PrepQuest learner";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace whole-word, case-insensitive matches of the terms. */
export function scrub(text: string, terms: readonly string[], replacement: string): string {
  const live = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].sort(
    (a, b) => b.length - a.length,
  );
  if (live.length === 0) return text;
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${live.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  return text.replace(re, replacement);
}

/** Emails, links and phone numbers never leave in a shared report, whatever the options. */
export function redactContact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]")
    .replace(/(?<![\w.])\+?\d[\d\s().-]{7,}\d(?![\w])/g, (m) =>
      m.replace(/\D/g, "").length >= 9 ? "[phone]" : m,
    );
}

export interface Privacy {
  options: ShareOptions;
  companyTerms: string[];
  nameTerms: string[];
}

/** The words of a display name (3+ letters) and the handle: what hiding the name has to scrub. */
export function nameTerms(displayName: string, handle: string): string[] {
  return [displayName, handle, ...displayName.split(/\s+/).filter((w) => w.length >= 3)];
}

export function clean(text: string, p: Privacy): string {
  let out = redactContact(text);
  if (p.options.hideCompany) out = scrub(out, p.companyTerms, COMPANY_WORDS);
  if (p.options.hideName) out = scrub(out, p.nameTerms, NAME_WORDS);
  return out;
}

function quotes(evidence: readonly EvidenceDto[], p: Privacy): string[] {
  const out: string[] = [];
  for (const e of evidence) {
    if (e.type === "turn" && p.options.hideTranscript) continue;
    if (e.type === "code" && p.options.hideCode) continue;
    const q = clean(e.quote.trim().slice(0, 240), p);
    if (q && !out.includes(q)) out.push(q);
    if (out.length === 3) break;
  }
  return out;
}

export function buildScorecardReport(
  review: ScorecardDto,
  session: Pick<InterviewSessionDto, "title" | "type" | "level" | "role" | "company" | "minutes">,
  p: Privacy,
): ScorecardReport {
  const company = p.options.hideCompany ? null : session.company;
  return {
    kind: "scorecard",
    title: clean(session.title, p),
    interviewType: session.type,
    level: session.level,
    role: session.role ? clean(session.role, p) : null,
    company,
    minutes: session.minutes,
    overall: review.overall,
    band: review.band,
    summary: review.summary ? clean(review.summary, p) : null,
    scores: review.scores.map((s) => ({
      name: s.name,
      score: s.score,
      weight: s.weight,
      justification: clean(s.justification, p),
      quotes: quotes(s.evidence, p),
    })),
    strengths: review.strengths.map((s) => ({
      text: clean(s.text, p),
      quotes: quotes(s.evidence, p),
    })),
    redFlags: review.redFlags.map((f) => ({
      category: f.category,
      severity: f.severity,
      text: clean(f.text, p),
    })),
  };
}

export function buildContestReport(
  title: string,
  standings: Pick<StandingsResponse, "scoring" | "total">,
  row: StandingRowDto,
): ContestReport {
  return {
    kind: "contest",
    title,
    scoring: standings.scoring,
    rank: row.rank,
    of: standings.total,
    solved: row.solved,
    penalty: row.penalty,
    score: row.score,
    problems: row.cells.map((c) => ({
      label: c.label,
      solved: c.solved,
      minute: c.minute,
      wrong: c.wrong,
    })),
  };
}

export function buildReadinessReport(r: ReadinessDto, p: Privacy): ReadinessReport {
  return {
    kind: "readiness",
    title: "Placement readiness",
    target: p.options.hideCompany ? "Target hidden" : r.targetTitle,
    label: r.label,
    score: r.score,
    band: r.band,
    coverage: r.coverage,
    components: r.components.map((c) => ({ label: c.label, score: c.score, weight: c.weight })),
  };
}
