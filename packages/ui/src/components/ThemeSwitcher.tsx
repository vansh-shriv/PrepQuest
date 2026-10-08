"use client";

import { useEffect, useState } from "react";
import { Button } from "./Button";

export const THEMES = ["cream", "night", "contrast"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "pq-theme";
const READABLE_KEY = "pq-readable";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: theme still applies for this page view */
  }
}

/** Inline script (run before paint) that applies the saved theme, avoiding a flash. */
export const THEME_INIT_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("${STORAGE_KEY}"),r=localStorage.getItem("${READABLE_KEY}");if(t)d.setAttribute("data-theme",t);if(r==="true")d.setAttribute("data-readable","true")}catch(e){}`;

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("cream");
  const [readable, setReadable] = useState(false);

  useEffect(() => {
    const saved = read(STORAGE_KEY);
    if (saved && (THEMES as readonly string[]).includes(saved)) setTheme(saved as Theme);
    setReadable(read(READABLE_KEY) === "true");
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    write(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-readable", String(readable));
    write(READABLE_KEY, String(readable));
  }, [readable]);

  return (
    <div className="pq-theme-switch" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <Button
          key={t}
          size="sm"
          variant={t === theme ? "accent" : "ghost"}
          aria-pressed={t === theme}
          onClick={() => setTheme(t)}
        >
          {t}
        </Button>
      ))}
      <Button
        size="sm"
        variant={readable ? "accent" : "ghost"}
        aria-pressed={readable}
        onClick={() => setReadable((r) => !r)}
      >
        Readable
      </Button>
    </div>
  );
}
