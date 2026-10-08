"use client";

import { useEffect, useState } from "react";
import { Button } from "./Button";

export const THEMES = ["cream", "night", "contrast"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "pq-theme";
const READABLE_KEY = "pq-readable";

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: theme still applies for this page view */
  }
}

/** Inline script (run before paint) that applies the saved theme, avoiding a flash. */
export const THEME_INIT_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("${STORAGE_KEY}"),r=localStorage.getItem("${READABLE_KEY}");if(t)d.setAttribute("data-theme",t);if(r==="true")d.setAttribute("data-readable","true")}catch(e){}`;

/** Applies a theme choice to the page and remembers it on this device. "system" follows the OS. */
export function applyTheme(choice: Theme | "system", readable: boolean): void {
  const theme: Theme =
    choice === "system"
      ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "night"
        : "cream"
      : choice;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-readable", String(readable));
  write(STORAGE_KEY, theme);
  write(READABLE_KEY, String(readable));
}

export interface ThemeSwitcherProps {
  /** Called after the user changes theme or readable mode (e.g. to save it to their account). */
  onChange?: (value: { theme: Theme; readable: boolean }) => void;
}

export function ThemeSwitcher({ onChange }: ThemeSwitcherProps) {
  const [theme, setTheme] = useState<Theme>("cream");
  const [readable, setReadable] = useState(false);

  // reflect what the page is actually showing (set by the init script or the account preference)
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current && (THEMES as readonly string[]).includes(current)) setTheme(current as Theme);
    setReadable(document.documentElement.getAttribute("data-readable") === "true");
  }, []);

  const choose = (next: { theme: Theme; readable: boolean }) => {
    setTheme(next.theme);
    setReadable(next.readable);
    applyTheme(next.theme, next.readable);
    onChange?.(next);
  };

  return (
    <div className="pq-theme-switch" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <Button
          key={t}
          size="sm"
          variant={t === theme ? "accent" : "ghost"}
          aria-pressed={t === theme}
          onClick={() => choose({ theme: t, readable })}
        >
          {t}
        </Button>
      ))}
      <Button
        size="sm"
        variant={readable ? "accent" : "ghost"}
        aria-pressed={readable}
        onClick={() => choose({ theme, readable: !readable })}
      >
        Readable
      </Button>
    </div>
  );
}
