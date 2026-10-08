import { useId, type InputHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { Sprite } from "./Sprite";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helper?: string;
  error?: string;
}

export function Input({ label, helper, error, id, className, ...rest }: InputProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const noteId = `${inputId}-note`;
  const note = error ?? helper;

  return (
    <div className={cx("pq-field", className)}>
      <label className="pq-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="pq-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        {...rest}
      />
      {note ? (
        <span
          id={noteId}
          className={cx("pq-help", error && "pq-help--error")}
          role={error ? "alert" : undefined}
        >
          {error ? "! " : ""}
          {note}
        </span>
      ) : null}
    </div>
  );
}

export interface SearchPillProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export function SearchPill({ label = "Search", className, ...rest }: SearchPillProps) {
  return (
    <label className={cx("pq-search", className)}>
      <span className="pq-sr-only">{label}</span>
      <Sprite name="magnifier" scale={2} />
      <input type="search" placeholder={label} {...rest} />
    </label>
  );
}
