import type { DiffLine } from "@prepquest/shared";

const LINE_STYLE: Record<DiffLine["type"], string> = {
  same: "",
  add: "bg-[color-mix(in_srgb,var(--leaf)_25%,transparent)]",
  del: "bg-[color-mix(in_srgb,var(--danger)_25%,transparent)]",
};
const LINE_MARK: Record<DiffLine["type"], string> = { same: " ", add: "+", del: "-" };

export function CodeLines({
  lines,
  label = "Changes between the two attempts",
}: {
  lines: DiffLine[];
  label?: string;
}) {
  return (
    <pre
      className="m-0 max-h-96 overflow-auto bg-surface-alt p-2 text-sm"
      style={{ fontFamily: "var(--font-code)" }}
      aria-label={label}
    >
      {lines.map((l, i) => (
        <div key={i} className={LINE_STYLE[l.type]}>
          <span aria-hidden="true">{LINE_MARK[l.type]} </span>
          {l.type !== "same" ? (
            <span className="sr-only">{l.type === "add" ? "added: " : "removed: "}</span>
          ) : null}
          {l.text}
        </div>
      ))}
    </pre>
  );
}
