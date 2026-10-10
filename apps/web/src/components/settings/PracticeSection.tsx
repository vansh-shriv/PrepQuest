"use client";

import { Checkbox, Select, Window } from "@prepquest/ui";
import type { SettingsUpdate } from "@prepquest/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

/** How hints and editorials behave for you (D4, D5). Both are enforced by the server. */
export function PracticeSection() {
  const { user, reload } = useAuth();
  const { run, error } = useSubmit(async (patch: SettingsUpdate) => {
    await api("/me/settings", { method: "PATCH", json: patch });
    await reload();
  });
  if (!user) return null;
  const { hintMode, openEditorials } = user.settings;
  return (
    <Window title="Practice" tone="olive">
      <div className="grid gap-4">
        <Select
          label="Hints"
          value={hintMode}
          onChange={(e) => void run({ hintMode: e.target.value as "strict" | "relaxed" })}
          helper="Strict waits 3 minutes before the first hint and 5 between hints. Relaxed waits a minute between hints."
        >
          <option value="strict">Strict (recommended)</option>
          <option value="relaxed">Relaxed</option>
        </Select>
        <Checkbox
          label="Open editorials"
          helper="Read every editorial without solving the problem first."
          checked={openEditorials}
          onChange={(e) => void run({ openEditorials: e.target.checked })}
        />
        <FormError message={error} />
      </div>
    </Window>
  );
}
