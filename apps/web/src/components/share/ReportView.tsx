import { Chip, Window } from "@prepquest/ui";
import type {
  ContestReport,
  PublicReportDto,
  ReadinessReport,
  ScorecardReport,
} from "@prepquest/shared";
import { reportHeading } from "@/features/share/share-view";

/** The shared report as a pixel report card. Pure rendering: it has no state and talks to nobody. */
export function ReportView({ report }: { report: PublicReportDto }) {
  const p = report.payload;
  return (
    <article className="grid gap-5" data-testid="shared-report" aria-label={report.title}>
      <header className="grid gap-1">
        <p className="pq-font-ui m-0 text-xs uppercase">{reportHeading(report.entityType)}</p>
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">{report.title}</h1>
        <p className="m-0 text-sm text-ink-soft">
          {report.owner} · {new Date(report.createdAt).toLocaleDateString()}
        </p>
      </header>
      {p.kind === "scorecard" && <Scorecard r={p} />}
      {p.kind === "contest" && <Contest r={p} />}
      {p.kind === "readiness" && <Readiness r={p} />}
    </article>
  );
}

function Scorecard({ r }: { r: ScorecardReport }) {
  return (
    <>
      <Window title="Overall" tone="sun">
        <div className="grid gap-2">
          <p className="pq-font-display m-0 text-3xl" data-testid="report-score">
            {r.overall === null ? "-" : r.overall}
            <span className="text-base text-ink-soft"> / 100</span>
          </p>
          {r.band && <Chip tone="info">{r.band}</Chip>}
          <p className="m-0 text-sm text-ink-soft">
            {r.interviewType} · {r.level} · {r.minutes} min
            {r.role ? ` · ${r.role}` : ""}
            {r.company ? ` · ${r.company}` : ""}
          </p>
          {r.summary && <p className="m-0">{r.summary}</p>}
        </div>
      </Window>

      <Window title="Scores" tone="sky">
        <ul className="m-0 grid list-none gap-4 p-0" aria-label="Scores">
          {r.scores.map((s) => (
            <li key={s.name} className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{s.name}</strong>
                <span data-testid="report-dimension">
                  {s.score === null ? "not scored" : `${s.score} / 5`}
                </span>
              </div>
              <p className="m-0 text-sm">{s.justification}</p>
              {s.quotes.map((q) => (
                <blockquote key={q} className="m-0 border-l-4 pl-3 text-sm italic">
                  {q}
                </blockquote>
              ))}
            </li>
          ))}
        </ul>
      </Window>

      {r.strengths.length > 0 && (
        <Window title="Strengths" tone="olive">
          <ul className="m-0 grid list-none gap-2 p-0">
            {r.strengths.map((s) => (
              <li key={s.text}>
                {s.text}
                {s.quotes.map((q) => (
                  <blockquote key={q} className="m-0 mt-1 border-l-4 pl-3 text-sm italic">
                    {q}
                  </blockquote>
                ))}
              </li>
            ))}
          </ul>
        </Window>
      )}

      {r.redFlags.length > 0 && (
        <Window title="To work on" tone="danger">
          <ul className="m-0 grid list-none gap-2 p-0">
            {r.redFlags.map((f) => (
              <li key={f.text}>
                <Chip tone={f.severity === "high" ? "hard" : "medium"}>{f.severity}</Chip> {f.text}
              </li>
            ))}
          </ul>
        </Window>
      )}
    </>
  );
}

function Contest({ r }: { r: ContestReport }) {
  return (
    <Window title="Result" tone="sun">
      <div className="grid gap-3">
        <p className="pq-font-display m-0 text-3xl" data-testid="report-rank">
          #{r.rank}
          <span className="text-base text-ink-soft"> of {r.of}</span>
        </p>
        <p className="m-0">
          {r.scoring === "icpc"
            ? `${r.solved} solved, ${r.penalty} min penalty`
            : `${r.score} points`}
        </p>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Problems">
          {r.problems.map((p) => (
            <li key={p.label}>
              <Chip tone={p.solved ? "easy" : "neutral"}>
                {p.label}:{" "}
                {p.solved ? `solved${p.minute !== null ? ` at ${p.minute}'` : ""}` : "not solved"}
                {p.wrong > 0 ? ` (${p.wrong} wrong)` : ""}
              </Chip>
            </li>
          ))}
        </ul>
      </div>
    </Window>
  );
}

function Readiness({ r }: { r: ReadinessReport }) {
  return (
    <>
      <Window title={r.target} tone="sun">
        <div className="grid gap-2">
          <p className="pq-font-display m-0 text-3xl" data-testid="report-score">
            {r.score === null ? "-" : r.score}
            <span className="text-base text-ink-soft"> / 100</span>
          </p>
          <p className="m-0">
            {r.label}
            {r.band !== null ? ` (plus or minus ${r.band})` : ""}
          </p>
          <p className="m-0 text-sm text-ink-soft">
            Based on {Math.round(r.coverage * 100)}% of the evidence a full picture needs.
          </p>
        </div>
      </Window>
      <Window title="What it is made of" tone="sky">
        <ul className="m-0 grid list-none gap-2 p-0">
          {r.components.map((c) => (
            <li key={c.label} className="flex flex-wrap items-center gap-2">
              <strong>{c.label}</strong>
              <span>{c.score === null ? "no data" : `${Math.round(c.score * 100)} / 100`}</span>
              <span className="text-sm text-ink-soft">weight {c.weight}%</span>
            </li>
          ))}
        </ul>
      </Window>
    </>
  );
}
