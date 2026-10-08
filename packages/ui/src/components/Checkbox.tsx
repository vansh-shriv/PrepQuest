import { useId, type InputHTMLAttributes } from "react";
import { cx } from "../lib/cx";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  helper?: string;
}

/** Pixel checkbox: native input underneath (keyboard + screen reader), drawn box on top. */
export function Checkbox({ label, helper, id, className, ...rest }: CheckboxProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={cx("pq-check", className)}>
      <input id={inputId} type="checkbox" className="pq-check__input" {...rest} />
      <label htmlFor={inputId} className="pq-check__label">
        <span className="pq-check__box" aria-hidden="true" />
        <span>
          {label}
          {helper ? <span className="pq-check__helper">{helper}</span> : null}
        </span>
      </label>
    </div>
  );
}
