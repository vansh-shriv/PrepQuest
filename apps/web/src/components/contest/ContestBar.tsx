"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Chip } from "@prepquest/ui";
import type { ContestMeDto } from "@prepquest/shared";
import { countdown } from "@/features/contest/contest-view";
import { api } from "@/lib/api";

/**
 * Pinned above the editor while a contest problem is open: the clock (the server decides when it ends), a
 * way back, and the focus-loss and paste counts the integrity review reads.
 */
export function ContestBar({ slug }: { slug: string }) {
  const [left, setLeft] = useState<number | null>(null);
  const [kind, setKind] = useState<"live" | "virtual" | null>(null);
  const deadline = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    api<ContestMeDto>(`/contests/${slug}/me`)
      .then((me) => {
        if (!alive) return;
        if (me.participation) {
          deadline.current = Date.now() + me.participation.secondsLeft * 1000;
          setKind(me.participation.kind);
          setLeft(me.participation.secondsLeft);
        } else setLeft(0);
      })
      .catch(() => alive && setLeft(0));
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    if (deadline.current === null) return;
    const t = setInterval(
      () => setLeft(Math.max(0, Math.ceil((deadline.current! - Date.now()) / 1000))),
      500,
    );
    return () => clearInterval(t);
  }, [kind]);

  useEffect(() => {
    const send = (type: "blur" | "paste") =>
      void api(`/contests/${slug}/events`, { method: "POST", json: { type } }).catch(
        () => undefined,
      );
    const onBlur = () => send("blur");
    const onPaste = () => send("paste");
    window.addEventListener("blur", onBlur);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("paste", onPaste);
    };
  }, [slug]);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-b-[3px] border-ink bg-sun px-3 py-1 text-[#1a1a1a]"
      data-testid="contest-bar"
    >
      <span className="flex items-center gap-2">
        <Chip>{kind === "virtual" ? "virtual contest" : "contest"}</Chip>
        <span className="text-sm">Hints and editorials are off. Only your submissions count.</span>
      </span>
      <span className="flex items-center gap-3">
        {left !== null && (
          <span className="pq-font-pixel text-xl" role="timer" aria-label="Contest time left">
            {left > 0 ? countdown(left) : "Time is up"}
          </span>
        )}
        <Link href={`/contests/${slug}`} className="text-sm underline">
          Standings
        </Link>
      </span>
    </div>
  );
}
