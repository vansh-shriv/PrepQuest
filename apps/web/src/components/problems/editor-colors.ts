/**
 * Monaco only accepts full 6- or 8-digit hex colors, but the CSS pipeline may minify `#ffffff` to `#fff`
 * (production builds do), and browsers can report `rgb(...)`. Convert whatever a design token resolves to
 * into `#rrggbb` (or `#rrggbbaa`), so the editor theme never crashes the page.
 */
export function toHex(color: string, fallback = "#000000"): string {
  const value = color.trim().toLowerCase();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(value);
  if (short) {
    const [, r, g, b, a] = short;
    return `#${r}${r}${g}${g}${b}${b}${a ? `${a}${a}` : ""}`;
  }
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(value)) return value;

  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(
    value,
  );
  if (rgb) {
    const byte = (n: string) => Math.min(255, Number(n)).toString(16).padStart(2, "0");
    let alpha = "";
    if (rgb[4] !== undefined) {
      const a = rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number(rgb[4]);
      if (a < 1)
        alpha = Math.round(Math.max(0, a) * 255)
          .toString(16)
          .padStart(2, "0");
    }
    return `#${byte(rgb[1]!)}${byte(rgb[2]!)}${byte(rgb[3]!)}${alpha}`;
  }
  return fallback;
}

/** Monaco token rules take the color without the leading `#`. */
export const toRuleColor = (color: string): string => toHex(color).slice(1, 7);

/** Appends an alpha channel (0-255) to a color. */
export function withAlpha(color: string, alpha: number): string {
  const hex = toHex(color).slice(0, 7);
  return `${hex}${Math.round(Math.min(255, Math.max(0, alpha)))
    .toString(16)
    .padStart(2, "0")}`;
}
