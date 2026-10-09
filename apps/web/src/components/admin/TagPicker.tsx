"use client";

import { Checkbox } from "@prepquest/ui";

/** A checkbox list for choosing tags. Keeps tags that are already selected even if they have no facet entry. */
export function TagPicker({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  options: Array<{ slug: string; name: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  error?: string | undefined;
}) {
  const all = [...options];
  for (const v of value) if (!all.some((o) => o.slug === v)) all.push({ slug: v, name: v });
  return (
    <fieldset className="m-0 grid gap-0 border-0 p-0">
      <legend className="pq-label mb-1 p-0">{label}</legend>
      <div className="grid max-h-56 gap-0 overflow-auto sm:grid-cols-2">
        {all.map((o) => (
          <Checkbox
            key={o.slug}
            label={o.name}
            checked={value.includes(o.slug)}
            onChange={() =>
              onChange(
                value.includes(o.slug) ? value.filter((x) => x !== o.slug) : [...value, o.slug],
              )
            }
          />
        ))}
      </div>
      {error ? (
        <span role="alert" className="pq-help pq-help--error">
          ! {error}
        </span>
      ) : null}
    </fieldset>
  );
}
