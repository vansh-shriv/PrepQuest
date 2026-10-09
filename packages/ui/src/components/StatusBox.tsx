import { cx } from "../lib/cx";

export type ProblemStatusLike = "unseen" | "attempted" | "solved";

const LABEL: Record<ProblemStatusLike, string> = {
  unseen: "Not started",
  attempted: "Attempted",
  solved: "Solved",
};

/**
 * Pixel progress square: empty, half-filled or checked. Color is never the only signal: the shape
 * differs and the state is announced to screen readers.
 */
export function StatusBox({
  status,
  className,
}: {
  status: ProblemStatusLike;
  className?: string;
}) {
  return (
    <span
      className={cx("pq-status", `pq-status--${status}`, className)}
      role="img"
      aria-label={LABEL[status]}
    />
  );
}
