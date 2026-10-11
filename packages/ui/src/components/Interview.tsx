import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Sprite } from "./Sprite";

// Interview components (doc 07): the pixel timer, the interviewer avatar, chat bubbles and the
// score visuals. Presentational only: all timing and scoring come from the server.

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  return `${String(m).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface InterviewTimerProps {
  remainingMs: number;
  totalMs: number;
  segments: readonly { key: string; name: string; startMs: number; endMs: number }[];
  paused?: boolean;
  className?: string;
}

/** Digital clock plus a segment bar. Colour shifts at 10, 5 and 1 minute (never colour alone: the text says it too). */
export function InterviewTimer({
  remainingMs,
  totalMs,
  segments,
  paused,
  className,
}: InterviewTimerProps) {
  const elapsed = Math.max(0, totalMs - remainingMs);
  const level =
    remainingMs <= 60_000
      ? "crit"
      : remainingMs <= 300_000
        ? "warn"
        : remainingMs <= 600_000
          ? "soon"
          : "ok";
  const levelText = { ok: "", soon: "10 min left", warn: "5 min left", crit: "Under 1 min" }[level];
  return (
    <div className={cx("pq-timer", `pq-timer--${level}`, className)}>
      <div className="pq-timer__row">
        <span className="pq-timer__clock" role="timer" aria-label="Time remaining">
          {formatClock(remainingMs)}
        </span>
        {paused ? (
          <span className="pq-timer__flag">PAUSED</span>
        ) : levelText ? (
          <span className="pq-timer__flag">{levelText}</span>
        ) : null}
      </div>
      <div className="pq-timer__bar" aria-hidden="true">
        {segments.map((s) => {
          const len = s.endMs - s.startMs;
          const done = Math.min(1, Math.max(0, (elapsed - s.startMs) / Math.max(1, len)));
          return (
            <span
              key={s.key}
              className="pq-timer__seg"
              style={{ flexGrow: len }}
              data-current={elapsed >= s.startMs && elapsed < s.endMs ? "true" : undefined}
              title={s.name}
            >
              <span className="pq-timer__fill" style={{ width: `${done * 100}%` }} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

export interface InterviewerAvatarProps {
  name: string;
  subtitle?: string;
  state?: "idle" | "typing" | "speaking";
  className?: string;
}

export function InterviewerAvatar({
  name,
  subtitle,
  state = "idle",
  className,
}: InterviewerAvatarProps) {
  return (
    <div className={cx("pq-avatar", className)} data-state={state}>
      <div className="pq-avatar__frame">
        <Sprite name="interviewer" scale={4} className="pq-avatar__sprite" />
      </div>
      <div className="pq-avatar__meta">
        <strong className="pq-avatar__name">{name}</strong>
        {subtitle ? <span className="pq-avatar__sub">{subtitle}</span> : null}
        <span className="pq-avatar__status" role="status">
          {state === "typing" ? "typing..." : state === "speaking" ? "speaking" : ""}
        </span>
      </div>
    </div>
  );
}

export interface ChatBubbleProps {
  who: "interviewer" | "candidate" | "system";
  children: ReactNode;
  time?: string;
  /** Still arriving: shows a blinking block cursor. */
  streaming?: boolean;
  /** A hint was given in this reply. */
  hint?: boolean;
  className?: string;
}

export function ChatBubble({ who, children, time, streaming, hint, className }: ChatBubbleProps) {
  return (
    <div
      className={cx("pq-bubble", `pq-bubble--${who}`, className)}
      data-streaming={streaming ? "true" : undefined}
    >
      <div className="pq-bubble__text">
        {children}
        {streaming ? <span className="pq-bubble__cursor" aria-hidden="true" /> : null}
      </div>
      {(time || hint) && (
        <div className="pq-bubble__meta">
          {hint ? <span className="pq-bubble__hint">HINT</span> : null}
          {time ? <time>{time}</time> : null}
        </div>
      )}
    </div>
  );
}

export interface ScoreBarProps {
  label: string;
  /** 1-5, or null when there was not enough evidence. */
  score: number | null;
  weight?: number;
  className?: string;
}

/** Five pixel blocks; an empty bar with "n/a" for a dimension without evidence. */
export function ScoreBar({ label, score, weight, className }: ScoreBarProps) {
  return (
    <div className={cx("pq-scorebar", className)}>
      <span className="pq-scorebar__label">
        {label}
        {weight !== undefined ? <small> {Math.round(weight * 100)}%</small> : null}
      </span>
      <span
        className="pq-scorebar__track"
        role="img"
        aria-label={
          score === null ? `${label}: not enough evidence` : `${label}: ${score} out of 5`
        }
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className="pq-scorebar__block"
            data-on={score !== null && n <= score ? "true" : undefined}
          />
        ))}
      </span>
      <span className="pq-scorebar__value">{score === null ? "n/a" : `${score}/5`}</span>
    </div>
  );
}

export interface RadarScoreProps {
  axes: readonly { label: string; value: number | null }[];
  size?: number;
  className?: string;
}

/** Radar chart on a 0-5 scale with stepped (pixel) rings. Missing values are drawn at the centre. */
export function RadarScore({ axes, size = 320, className }: RadarScoreProps) {
  const n = axes.length;
  const c = size / 2;
  const r = size / 2 - 70;
  const point = (i: number, v: number): [number, number] => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [c + Math.cos(a) * r * (v / 5), c + Math.sin(a) * r * (v / 5)];
  };
  const ring = (v: number) => axes.map((_, i) => point(i, v).join(",")).join(" ");
  const shape = axes.map((a, i) => point(i, a.value ?? 0).join(",")).join(" ");
  const summary = axes.map((a) => `${a.label} ${a.value ?? "n/a"}`).join(", ");
  return (
    <svg
      className={cx("pq-radar", className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Radar chart: ${summary}`}
      shapeRendering="crispEdges"
    >
      {[1, 2, 3, 4, 5].map((v) => (
        <polygon key={v} points={ring(v)} className="pq-radar__ring" />
      ))}
      {axes.map((a, i) => {
        const [x, y] = point(i, 5);
        const [lx, ly] = point(i, 5.9);
        const anchor = lx < c - 4 ? "end" : lx > c + 4 ? "start" : "middle";
        return (
          <g key={a.label}>
            <line x1={c} y1={c} x2={x} y2={y} className="pq-radar__axis" />
            <text
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="pq-radar__label"
            >
              {a.label}
            </text>
          </g>
        );
      })}
      <polygon points={shape} className="pq-radar__shape" />
      {axes.map((a, i) => {
        const [x, y] = point(i, a.value ?? 0);
        return a.value === null ? null : (
          <rect key={a.label} x={x - 3} y={y - 3} width={6} height={6} className="pq-radar__dot" />
        );
      })}
    </svg>
  );
}
