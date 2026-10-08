"use client";

import { ThemeSwitcher, Window, type Theme } from "@prepquest/ui";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";

export function AppearanceSection() {
  const { run } = useSubmit(async (theme: Theme, readable: boolean) => {
    await api("/me/settings", { method: "PATCH", json: { theme, readableMode: readable } });
  });
  return (
    <Window title="Appearance" tone="sky">
      <p className="mt-0">Saved to your account, applied on every device.</p>
      <ThemeSwitcher onChange={({ theme, readable }) => void run(theme, readable)} />
    </Window>
  );
}
