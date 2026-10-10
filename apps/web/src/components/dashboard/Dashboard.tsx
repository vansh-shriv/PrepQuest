"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ActivityHeatmap,
  buttonClasses,
  Chip,
  LoadingBar,
  Sprite,
  Window,
  type SpriteName,
} from "@prepquest/ui";
import { DASHBOARD_RANGES, type DashboardDto, type DashboardRange } from "@prepquest/shared";
import { api } from "@/lib/api";

const PLANT: Record<DashboardDto["skills"][number]["stage"], SpriteName> = {
  seed: "plantSeed",
  sprout: "plantSprout",
  bud: "plantBud",
  bloom: "plantBloom",
};
const RANGE_LABEL: Record<DashboardRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};
const VERDICT_TONE = { AC: "easy", WA: "hard", RE: "hard", CE: "hard", IE: "info" } as const;

export const sunflowerFor = (streak: number): SpriteName =>
  streak <= 0 ? "sunflowerSeed" : streak < 4 ? "sunflowerBud" : "sunflower";

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="pq-font-ui text-xs uppercase text-ink-soft">{label}</span>
      <span className="pq-font-pixel text-3xl leading-none">{value}</span>
      {note ? <span className="text-xs text-ink-soft">{note}</span> : null}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div
      className="flex h-10 items-end gap-[2px]"
      role="img"
      aria-label={`Problems accepted per day over the last 30 days: ${total} in total`}
    >
      {values.map((v, i) => (
        <span
          key={i}
          className="w-[6px] bg-leaf"
          style={{
            height: `${Math.max(v === 0 ? 4 : 12, (v / max) * 100)}%`,
            opacity: v === 0 ? 0.25 : 1,
          }}
          title={`${v} solved`}
        />
      ))}
    </div>
  );
}

function DifficultyBar({ easy, medium, hard }: { easy: number; medium: number; hard: number }) {
  const total = easy + medium + hard;
  if (total === 0) return <p className="m-0 text-sm text-ink-soft">No solved problems yet.</p>;
  const part = (n: number, color: string, label: string) =>
    n > 0 ? (
      <span
        className="grid min-w-6 place-items-center text-xs text-[#1a1a1a]"
        style={{ width: `${(n / total) * 100}%`, background: color }}
        title={`${label}: ${n}`}
      >
        {n}
      </span>
    ) : null;
  return (
    <div
      className="flex h-6 overflow-hidden border-[3px] border-ink"
      role="img"
      aria-label={`Easy ${easy}, medium ${medium}, hard ${hard}`}
    >
      {part(easy, "var(--leaf)", "Easy")}
      {part(medium, "var(--sun)", "Medium")}
      {part(hard, "var(--danger)", "Hard")}
    </div>
  );
}

/** The player's dashboard (A1): progress, streak, skills, what to do next. All numbers come from the server. */
export function Dashboard() {
  const [range, setRange] = useState<DashboardRange>("30d");
  const [data, setData] = useState<DashboardDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api<DashboardDto>(`/me/dashboard?range=${range}`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [range]);

  if (failed) {
    return (
      <p role="alert" className="m-0">
        Couldn&apos;t load your dashboard. Try again in a moment.
      </p>
    );
  }
  if (!data) return <LoadingBar label="Loading your dashboard" />;

  const { player, solved, accuracy } = data;
  const earned = data.badges.filter((b) => b.earnedAt);
  const empty = solved.total === 0 && accuracy.submissions === 0;

  return (
    <div className="grid gap-6" data-testid="dashboard">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Time range">
        <span className="pq-font-ui text-xs uppercase">Range</span>
        {DASHBOARD_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className={buttonClasses({ size: "sm", variant: r === range ? "accent" : "ghost" })}
            aria-pressed={r === range}
            onClick={() => setRange(r)}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Window title="Level" tone="coin">
          <div className="flex items-center gap-4">
            <Sprite name="coin" scale={4} animate label="XP coin" />
            <div className="grid flex-1 gap-2">
              <span className="pq-font-display text-sm" data-testid="level">
                LV {player.level.level}
              </span>
              <LoadingBar value={player.level.fraction * 100} size="sm" label="XP to next level" />
              <span className="pq-font-pixel text-xl" data-testid="xp">
                {player.xp} XP · {player.level.into}/{player.level.needed} to level{" "}
                {player.level.level + 1}
              </span>
            </div>
          </div>
        </Window>

        <Window title="Streak" tone="sun">
          <div className="flex items-center gap-4">
            <Sprite name={sunflowerFor(player.streak.current)} scale={4} label="Streak sunflower" />
            <div className="grid gap-1">
              <span className="pq-font-display text-sm" data-testid="streak">
                {player.streak.current} {player.streak.current === 1 ? "DAY" : "DAYS"}
              </span>
              <span className="pq-font-pixel text-xl">
                Best: {player.streak.best}
                {player.streak.freezes > 0 ? " · 1 grace day ready" : ""}
              </span>
              {data.countdown ? (
                <span className="text-sm text-ink-soft">
                  {data.countdown.daysLeft >= 0
                    ? `${data.countdown.daysLeft} days to your placement date`
                    : "Your placement date has passed"}
                </span>
              ) : null}
            </div>
          </div>
        </Window>
      </div>

      {empty ? (
        <Window title="Your first quest" tone="sky">
          <div className="flex flex-wrap items-center gap-4">
            <Sprite name="dino" scale={5} label="Dino" />
            <p className="pq-font-pixel m-0 flex-1 text-2xl">
              NOTHING HERE YET. RUN YOUR FIRST QUEST!
            </p>
          </div>
        </Window>
      ) : null}

      <Window title="Next best action" tone="olive">
        {data.next.length === 0 ? (
          <p className="m-0">
            You have solved everything in the bank. New problems are on the way.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0" aria-label="Recommended problems">
            {data.next.map((n, i) => (
              <li key={n.slug} className="flex flex-wrap items-center gap-3">
                <Chip tone={n.difficulty}>{n.difficulty}</Chip>
                <div className="grid flex-1 gap-0.5">
                  <span className="font-semibold">{n.title}</span>
                  <span className="text-sm text-ink-soft">{n.reason}</span>
                </div>
                <Link
                  href={`/problems/${n.slug}`}
                  className={buttonClasses({ size: "sm", variant: i === 0 ? "accent" : "ghost" })}
                >
                  Start
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Window>

      <div className="grid gap-6 md:grid-cols-2">
        <Window title="Problems solved" tone="olive">
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-6">
              <Stat label="Total" value={solved.total} />
              <Stat label={`In ${RANGE_LABEL[range].toLowerCase()}`} value={solved.inRange} />
            </div>
            <DifficultyBar easy={solved.easy} medium={solved.medium} hard={solved.hard} />
            <Sparkline values={solved.daily} />
          </div>
        </Window>

        <Window title="Accuracy" tone="olive">
          <div className="flex flex-wrap gap-6">
            <Stat
              label="Accepted"
              value={`${accuracy.acceptanceRate}%`}
              note={`${accuracy.accepted} of ${accuracy.submissions} submissions`}
            />
            <Stat label="First try" value={`${accuracy.firstTryRate}%`} note="of solved problems" />
            <Stat
              label="Attempts to solve"
              value={accuracy.avgAttemptsToAc || "-"}
              note="on average"
            />
          </div>
        </Window>
      </div>

      <Window title="Activity" tone="sky">
        <ActivityHeatmap today={player.today} data={data.heatmap} />
      </Window>

      <Window title="Skill plants" tone="olive">
        <ul
          className="m-0 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-3 md:grid-cols-4"
          aria-label="Topic skills"
        >
          {data.skills.map((s) => (
            <li
              key={s.topic}
              className="grid justify-items-center gap-1 text-center"
              data-testid="skill"
            >
              <Sprite name={PLANT[s.stage]} scale={4} label={`${s.name}: ${s.stage}`} />
              <span className="pq-font-ui text-xs uppercase">{s.name}</span>
              <span className="text-xs text-ink-soft">
                {s.attempted === 0
                  ? "not started"
                  : `${Math.round(s.mastery * 100)}% · ${s.solved}/${s.attempted} solved`}
              </span>
            </li>
          ))}
        </ul>
      </Window>

      {data.weakAreas.length > 0 ? (
        <Window title="Needs work" tone="blossom">
          <ul className="m-0 grid list-none gap-3 p-0" aria-label="Weak areas">
            {data.weakAreas.map((w) => (
              <li key={w.topic} className="grid gap-0.5">
                <span className="font-semibold">
                  {w.name}{" "}
                  <span className="text-sm text-ink-soft">({Math.round(w.mastery * 100)}%)</span>
                </span>
                {w.diagnosis ? <span className="text-sm">{w.diagnosis}</span> : null}
              </li>
            ))}
          </ul>
        </Window>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Window title="Sheets" tone="sky">
          {data.sheets.length === 0 ? (
            <p className="m-0">No sheets yet.</p>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0" aria-label="Sheet progress">
              {data.sheets.map((s) => (
                <li key={s.slug} className="grid gap-1">
                  <Link href={`/problems?sheet=${s.slug}`} className="font-semibold underline">
                    {s.title}
                  </Link>
                  <LoadingBar
                    size="sm"
                    value={s.total === 0 ? 0 : (s.solved / s.total) * 100}
                    label={`${s.solved} of ${s.total} solved`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Window>

        <Window title="Recent activity" tone="sky">
          {data.recent.length === 0 ? (
            <p className="m-0">Your submissions will show up here.</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="Recent submissions">
              {data.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <Chip tone={VERDICT_TONE[r.verdict as keyof typeof VERDICT_TONE] ?? "medium"}>
                    {r.verdict}
                  </Chip>
                  <Link href={`/submissions/${r.id}`} className="underline">
                    {r.problem.title}
                  </Link>
                  <time className="ml-auto text-xs text-ink-soft" dateTime={r.createdAt}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Window>
      </div>

      <Window title={`Badges (${earned.length}/${data.badges.length})`} tone="coin">
        <ul
          className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 md:grid-cols-3"
          aria-label="Badges"
        >
          {data.badges.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-3"
              style={{ opacity: b.earnedAt ? 1 : 0.45 }}
              data-earned={b.earnedAt ? "true" : "false"}
            >
              <Sprite name={b.sprite as SpriteName} scale={3} />
              <div className="grid">
                <span className="font-semibold">{b.name}</span>
                <span className="text-xs text-ink-soft">
                  {b.earnedAt
                    ? `Earned ${new Date(b.earnedAt).toLocaleDateString()}`
                    : b.description}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Window>
    </div>
  );
}
