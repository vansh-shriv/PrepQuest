import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { LoadingBar } from "./LoadingBar";
import { Sprite } from "./Sprite";

export interface FolderCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  /** e.g. "12 / 40 solved" */
  meta?: string;
  /** 0-100 progress through the folder (sheet, track, deck). */
  progress?: number;
}

/** Folder-style card for sheets, tracks, decks and interview templates. */
export function FolderCard({
  title,
  meta,
  progress,
  className,
  type = "button",
  ...rest
}: FolderCardProps) {
  return (
    <button type={type} className={cx("pq-folder pq-box pq-lift", className)} {...rest}>
      <Sprite name="folder" scale={3} />
      <span className="pq-folder__title">{title}</span>
      {meta ? <span className="pq-folder__meta">{meta}</span> : null}
      {typeof progress === "number" ? (
        <LoadingBar value={progress} size="sm" label={`${title} progress`} />
      ) : null}
    </button>
  );
}
