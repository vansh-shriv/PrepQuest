import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Sprite } from "./Sprite";
import type { SpriteName } from "../sprites/art";

export type VerdictCode = "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | "OLE" | "IE";

const INFO: Record<VerdictCode, { title: string; sprite: SpriteName }> = {
  AC: { title: "Accepted", sprite: "verdictAc" },
  WA: { title: "Wrong answer", sprite: "verdictWa" },
  TLE: { title: "Time limit exceeded", sprite: "verdictTle" },
  MLE: { title: "Memory limit exceeded", sprite: "verdictMle" },
  RE: { title: "Runtime error", sprite: "verdictRe" },
  CE: { title: "Compile error", sprite: "verdictCe" },
  OLE: { title: "Output limit exceeded", sprite: "verdictMle" },
  IE: { title: "Our bad", sprite: "verdictIe" },
};

export const verdictTitle = (v: VerdictCode) => INFO[v].title;

export interface VerdictBannerProps {
  verdict: VerdictCode;
  /** One line under the title, e.g. which test failed. */
  detail?: ReactNode;
  /** Small caps line, e.g. "7 / 12 passed · 18 ms". */
  meta?: ReactNode;
  className?: string;
}

/** The result banner: icon + label + detail, so the verdict never relies on color alone. */
export function VerdictBanner({ verdict, detail, meta, className }: VerdictBannerProps) {
  const info = INFO[verdict];
  return (
    <div
      role="status"
      aria-label={`Verdict: ${info.title}`}
      data-verdict={verdict}
      className={cx("pq-verdict pq-box", `pq-verdict--${verdict.toLowerCase()}`, className)}
    >
      <Sprite name={info.sprite} scale={4} />
      <div>
        <p className="pq-verdict__title">{info.title}</p>
        {detail ? <p className="pq-verdict__detail">{detail}</p> : null}
        {meta ? <p className="pq-verdict__meta">{meta}</p> : null}
      </div>
    </div>
  );
}
