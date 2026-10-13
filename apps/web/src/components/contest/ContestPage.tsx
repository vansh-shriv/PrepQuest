"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClasses, Chip, LoadingBar, Window } from "@prepquest/ui";
import type {
  ContestDetailDto,
  ContestMeDto,
  StandingRowDto,
  StandingsResponse,
} from "@prepquest/shared";
import {
  cellText,
  countdown,
  durationText,
  PHASE_LABEL,
  phaseHeadline,
  summaryText,
  VERDICT_TEXT,
} from "@/features/contest/contest-view";
import { api, ApiError } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";
import { Markdown } from "../problems/Markdown";

const POLL_MS = 5000;

/** One contest: the clock, the problems, the standings, and a virtual replay once it is over. */
export function ContestPage() {
  const { slug } = useParams<{ slug: string }>();
  const code = useSearchParams().get("code") ?? undefined;
  const query = code ? `?code=${encodeURIComponent(code)}` : "";
  const [contest, setContest] = useState<ContestDetailDto | null>(null);
  const [table, setTable] = useState<StandingsResponse | null>(null);
  const [me, setMe] = useState<ContestMeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const deadline = useRef(0);

  const load = useCallback(async () => {
    try {
      const c = await api<ContestDetailDto>(`/contests/${slug}${query}`);
      setContest(c);
      deadline.current = Date.now() + c.secondsLeft * 1000;
      setLeft(c.secondsLeft);
      const [s, m] = await Promise.all([
        api<StandingsResponse>(`/contests/${slug}/standings${query}`),
        api<ContestMeDto>(`/contests/${slug}/me`).catch(() => null),
      ]);
      setTable(s);
      setMe(m);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  }, [slug, query]);

  useEffect(() => {
    void load();
  }, [load]);

  // the clock only displays; when it reaches zero the page asks the server what changed
  useEffect(() => {
    if (!contest || contest.phase === "past") return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) void load();
    }, 500);
    return () => clearInterval(t);
  }, [contest, load]);

  // standings follow the verdicts while the contest runs
  useEffect(() => {
    if (contest?.phase !== "running" && me?.participation?.kind !== "virtual") return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [contest?.phase, me?.participation?.kind, load]);

  const register = useSubmit(async () => {
    await api(`/contests/${slug}/register`, {
      method: "POST",
      json: code ? { inviteCode: code } : {},
    });
    await load();
  });
  const virtual = useSubmit(async () => {
    await api(`/contests/${slug}/virtual`, { method: "POST" });
    await load();
  });

  if (error && !contest) return <FormError message={error} />;
  if (!contest) return <LoadingBar label="Loading the contest" />;

  const running = contest.phase === "running" || me?.participation?.kind === "virtual";
  const link = (problemSlug: string) => `/problems/${problemSlug}?contest=${contest.slug}`;

  return (
    <div className="grid max-w-5xl gap-6" data-testid="contest">
      <div>
        <Link href="/contests" className="text-sm underline">
          All contests
        </Link>
        <h1 className="pq-font-display m-0 flex flex-wrap items-center gap-3 text-lg leading-relaxed">
          {contest.title}
          <Chip tone={contest.phase === "running" ? "easy" : "neutral"}>
            {PHASE_LABEL[contest.phase]}
          </Chip>
          <Chip>{contest.scoring === "icpc" ? "ICPC scoring" : "points scoring"}</Chip>
        </h1>
        <p className="m-0 mt-1 text-sm text-ink-soft">
          {new Date(contest.startsAt).toLocaleString()} · {durationText(contest.durationMinutes)} ·{" "}
          {contest.participants} joined
          {contest.freezeMinutes > 0
            ? ` · standings freeze for the last ${contest.freezeMinutes} min`
            : ""}
        </p>
      </div>

      <Window title={phaseHeadline(contest.phase, left)} tone="sun">
        <div className="grid gap-3">
          {contest.description && <Markdown>{contest.description}</Markdown>}
          <p
            className="pq-font-pixel m-0 text-2xl"
            role="timer"
            aria-label="Contest clock"
            data-testid="contest-clock"
          >
            {contest.phase === "past" ? "Over" : countdown(left)}
          </p>
          {me?.participation?.kind === "virtual" && (
            <p className="m-0" data-testid="virtual-banner">
              Virtual run: {countdown(me.participation.secondsLeft)} on your own clock. It does not
              change the real standings.
            </p>
          )}
          <FormError message={register.error ?? virtual.error} />
          <div className="flex flex-wrap gap-3">
            {contest.canRegister && (
              <Button
                variant="accent"
                loading={register.pending}
                onClick={() => void register.run()}
              >
                {contest.phase === "running" ? "Join now" : "Register"}
              </Button>
            )}
            {contest.registered && contest.phase !== "past" && <Chip tone="easy">registered</Chip>}
            {contest.phase === "past" && !me?.participation && (
              <Button loading={virtual.pending} onClick={() => void virtual.run()}>
                Start a virtual run
              </Button>
            )}
          </div>
          {contest.inviteCode && (
            <p className="m-0 text-sm" data-testid="invite-code">
              Invite code: <code>{contest.inviteCode}</code>. Share the link name{" "}
              <code>{contest.slug}</code> with it.
            </p>
          )}
        </div>
      </Window>

      {contest.problems ? (
        <Window title="Problems" tone="sky">
          <ul className="m-0 grid list-none gap-2 p-0" data-testid="contest-problems">
            {contest.problems.map((p) => (
              <li key={p.slug} className="flex flex-wrap items-center gap-2">
                <strong>{p.label}</strong>
                {running && (contest.registered || me?.participation) ? (
                  <Link href={link(p.slug)} className="underline">
                    {p.title}
                  </Link>
                ) : (
                  <span>{p.title}</span>
                )}
                <Chip tone={p.difficulty}>{p.difficulty}</Chip>
                {contest.scoring === "points" && (
                  <span className="text-sm text-ink-soft">{p.points} points</span>
                )}
                {p.solved && <Chip tone="easy">solved</Chip>}
              </li>
            ))}
          </ul>
        </Window>
      ) : (
        <Window title="Problems">
          <p className="m-0">{contest.problemCount} problems, revealed when the contest starts.</p>
        </Window>
      )}

      {table && <Standings table={table} />}

      {me && me.virtual && (
        <Window title="Your virtual run" tone="olive">
          <p className="m-0" data-testid="virtual-result">
            {summaryText(me.virtual, contest.scoring)}: you would have placed{" "}
            <strong>#{me.virtual.wouldRank}</strong> of {me.virtual.of}.
          </p>
        </Window>
      )}

      {me && me.submissions.length > 0 && (
        <Window title="Your submissions">
          <ul className="m-0 grid list-none gap-1 p-0" data-testid="contest-submissions">
            {me.submissions.map((s) => (
              <li key={s.id}>
                <strong>{s.label}</strong> {VERDICT_TEXT[s.verdict] ?? s.verdict}{" "}
                <span className="text-sm text-ink-soft">
                  {s.language} · {new Date(s.at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </Window>
      )}

      <div>
        <Link href="/contests" className={buttonClasses({ variant: "ghost" })}>
          Back to contests
        </Link>
      </div>
    </div>
  );
}

function Standings({ table }: { table: StandingsResponse }) {
  const rows: StandingRowDto[] = table.rows;
  const outside = table.me && !rows.some((r) => r.isMe) ? table.me : null;
  return (
    <Window title="Standings" tone="sky">
      <div className="grid gap-2">
        {table.frozen && (
          <p className="m-0 text-sm" role="status" data-testid="frozen-note">
            The standings are frozen: attempts from the last minutes show as ? until the contest
            ends.
          </p>
        )}
        {rows.length === 0 ? (
          <p className="m-0">Nobody has joined yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-left text-sm"
              aria-label="Standings"
              data-testid="standings"
            >
              <thead>
                <tr>
                  <th scope="col" className="px-2 py-1">
                    #
                  </th>
                  <th scope="col" className="px-2 py-1">
                    Player
                  </th>
                  <th scope="col" className="px-2 py-1">
                    {table.scoring === "icpc" ? "Solved" : "Score"}
                  </th>
                  {table.scoring === "icpc" && (
                    <th scope="col" className="px-2 py-1">
                      Penalty
                    </th>
                  )}
                  {table.problems.map((p) => (
                    <th key={p.label} scope="col" className="px-2 py-1">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...rows, ...(outside ? [outside] : [])].map((r) => (
                  <tr key={r.handle} className={r.isMe ? "bg-surface-alt" : undefined}>
                    <td className="px-2 py-1">{r.rank}</td>
                    <td className="px-2 py-1">
                      {r.displayName} <span className="text-ink-soft">@{r.handle}</span>
                    </td>
                    <td className="px-2 py-1">{table.scoring === "icpc" ? r.solved : r.score}</td>
                    {table.scoring === "icpc" && <td className="px-2 py-1">{r.penalty}</td>}
                    {r.cells.map((c) => (
                      <td
                        key={c.label}
                        className="px-2 py-1"
                        data-testid={`cell-${r.handle}-${c.label}`}
                      >
                        {cellText(c, table.scoring)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {table.total > table.pageSize && (
          <p className="m-0 text-sm text-ink-soft">
            Showing the top {table.pageSize} of {table.total}.
          </p>
        )}
      </div>
    </Window>
  );
}
