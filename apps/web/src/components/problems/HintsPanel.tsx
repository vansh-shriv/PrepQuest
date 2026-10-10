"use client";

import { useEffect, useState } from "react";
import { Button, Chip, LoadingBar } from "@prepquest/ui";
import type { HintsResponse, HintTierView, HintUnlocked } from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";
import { Markdown } from "./Markdown";

const TIER_NAME: Record<number, string> = { 1: "Nudge", 2: "Approach", 3: "Pseudocode" };

/** Seconds left until `iso` (never negative); re-renders once a second while it is in the future. */
export function useSecondsUntil(iso: string | undefined): number {
  const target = iso ? Date.parse(iso) : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target || target <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= target) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [target]);
  return target ? Math.max(0, Math.ceil((target - now) / 1000)) : 0;
}

export const formatClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function Tier({
  tier,
  busy,
  onShow,
}: {
  tier: HintTierView;
  busy: boolean;
  onShow: (tier: number) => void;
}) {
  const wait = useSecondsUntil(
    tier.locked?.reason === "cooldown" ? tier.locked.unlockAt : undefined,
  );
  const waiting = tier.locked?.reason === "cooldown" && wait > 0;
  const blockedByOrder = tier.locked?.reason === "previous_tier";

  return (
    <li className="pq-card pq-box grid gap-2" data-testid={`hint-${tier.tier}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pq-font-ui text-sm uppercase">
          Hint {tier.tier}: {TIER_NAME[tier.tier] ?? ""}
        </span>
        {tier.viewed ? <Chip tone="info">viewed</Chip> : null}
      </div>
      {tier.viewed && tier.bodyMd ? (
        <Markdown>{tier.bodyMd}</Markdown>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={waiting || blockedByOrder || busy}
            loading={busy}
            onClick={() => onShow(tier.tier)}
          >
            Show hint {tier.tier}
          </Button>
          {waiting ? (
            <span className="pq-font-pixel text-lg" data-testid="hint-countdown">
              Available in {formatClock(wait)}
            </span>
          ) : blockedByOrder ? (
            <span className="text-sm text-ink-soft">
              View hint {tier.locked?.missingTier} first.
            </span>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** Tiered hints (D4). The server decides what is unlocked; this only shows it. */
export function HintsPanel({ slug }: { slug: string }) {
  const [data, setData] = useState<HintsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    api<HintsResponse>(`/problems/${slug}/hints`)
      .then(setData)
      .catch(() => setFailed(true));

  useEffect(() => {
    setData(null);
    setFailed(false);
    void load();
  }, [slug]);

  // when a countdown ends the tier becomes available: refresh so the server's answer is what we show
  useEffect(() => {
    const times = (data?.tiers ?? [])
      .map((t) => (t.locked?.reason === "cooldown" ? Date.parse(t.locked.unlockAt ?? "") : 0))
      .filter((t) => t > Date.now());
    if (times.length === 0) return;
    const timer = setTimeout(() => void load(), Math.min(...times) - Date.now() + 500);
    return () => clearTimeout(timer);
  }, [data]);

  const show = async (tier: number) => {
    setBusy(tier);
    setMessage(null);
    try {
      await api<HintUnlocked>(`/problems/${slug}/hints/${tier}/unlock`, {
        method: "POST",
        json: {},
      });
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't load that hint.");
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (failed) return <p className="m-0 p-2">Couldn&apos;t load hints.</p>;
  if (!data) return <LoadingBar label="Loading hints" />;
  if (data.tiers.length === 0) {
    return (
      <p className="m-0 p-2">
        This problem has no hints yet. Try the Notes tab to think it through.
      </p>
    );
  }
  return (
    <div className="grid gap-3 p-1">
      <p className="m-0 text-sm text-ink-soft">
        Hints unlock one at a time{data.mode === "strict" ? ", after a short wait" : ""}. Each hint
        you view takes 10% off the XP for solving this problem.
      </p>
      {message ? (
        <p role="alert" className="m-0 text-danger">
          {message}
        </p>
      ) : null}
      <ul className="m-0 grid list-none gap-3 p-0" aria-label="Hints">
        {data.tiers.map((t) => (
          <Tier key={t.tier} tier={t} busy={busy === t.tier} onShow={(n) => void show(n)} />
        ))}
      </ul>
    </div>
  );
}
