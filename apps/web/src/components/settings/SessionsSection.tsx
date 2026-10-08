"use client";

import { useEffect, useState } from "react";
import { Button, Chip, Window } from "@prepquest/ui";
import type { SessionInfo } from "@prepquest/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";

export function SessionsSection() {
  const [items, setItems] = useState<SessionInfo[] | null>(null);
  const { logout } = useAuth();
  const load = () => api<{ items: SessionInfo[] }>("/me/sessions").then((r) => setItems(r.items));

  useEffect(() => {
    void load();
  }, []);

  const revoke = useSubmit(async (id: string) => {
    await api(`/me/sessions/${id}`, { method: "DELETE" });
    await load();
  });
  const signOutAll = useSubmit(async () => {
    await api("/auth/logout-all", { method: "POST", json: {} });
    await logout();
  });

  return (
    <Window title="Devices" tone="coin">
      {items === null ? (
        <p className="m-0">Loading...</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                {(s.userAgent ?? "Unknown device").slice(0, 60)}
                <br />
                <span className="text-ink-soft">
                  Signed in {new Date(s.createdAt).toLocaleString()}
                </span>
              </span>
              {s.current ? (
                <Chip tone="info">This device</Chip>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void revoke.run(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <Button
          variant="danger"
          size="sm"
          loading={signOutAll.pending}
          onClick={() => void signOutAll.run()}
        >
          Sign out everywhere
        </Button>
      </div>
    </Window>
  );
}
