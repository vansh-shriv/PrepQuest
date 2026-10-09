import { useId, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import type { ProblemStatusLike } from "./StatusBox";

interface FieldBase {
  label: string;
  helper?: string;
  error?: string;
}

function Note({ id, helper, error }: { id: string } & Pick<FieldBase, "helper" | "error">) {
  const note = error ?? helper;
  if (!note) return null;
  return (
    <span
      id={id}
      className={cx("pq-help", error && "pq-help--error")}
      role={error ? "alert" : undefined}
    >
      {error ? "! " : ""}
      {note}
    </span>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldBase {}

/** Native select (keyboard and screen-reader friendly) dressed in the pixel input style. */
export function Select({ label, helper, error, id, className, children, ...rest }: SelectProps) {
  const auto = useId();
  const selectId = id ?? auto;
  const noteId = `${selectId}-note`;
  return (
    <div className={cx("pq-field", className)}>
      <label className="pq-label" htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        className="pq-input pq-select"
        aria-invalid={error ? true : undefined}
        aria-describedby={helper || error ? noteId : undefined}
        {...rest}
      >
        {children}
      </select>
      <Note id={noteId} helper={helper} error={error} />
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldBase {
  /** Monospace for code and markdown source. */
  mono?: boolean;
}

export function Textarea({
  label,
  helper,
  error,
  id,
  className,
  mono,
  rows = 6,
  ...rest
}: TextareaProps) {
  const auto = useId();
  const areaId = id ?? auto;
  const noteId = `${areaId}-note`;
  return (
    <div className={cx("pq-field", className)}>
      <label className="pq-label" htmlFor={areaId}>
        {label}
      </label>
      <textarea
        id={areaId}
        rows={rows}
        className={cx("pq-input pq-textarea", mono && "pq-textarea--mono")}
        aria-invalid={error ? true : undefined}
        aria-describedby={helper || error ? noteId : undefined}
        {...rest}
      />
      <Note id={noteId} helper={helper} error={error} />
    </div>
  );
}

export type { ProblemStatusLike };
