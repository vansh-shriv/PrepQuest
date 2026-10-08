"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Chip, Input, ThemeSwitcher, Window, type Theme } from "@prepquest/ui";
import type { SessionInfo, MeResponse } from "@prepquest/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";

function ProfileForm() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    displayName: user?.profile.displayName ?? "",
    college: user?.profile.college ?? "",
    branch: user?.profile.branch ?? "",
    gradYear: user?.profile.gradYear ? String(user.profile.gradYear) : "",
  });
  const [saved, setSaved] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const { run, pending, error, fields } = useSubmit(async () => {
    const me = await api<MeResponse>("/me/profile", {
      method: "PATCH",
      json: {
        displayName: form.displayName,
        college: form.college.trim() || null,
        branch: form.branch.trim() || null,
        gradYear: form.gradYear ? Number(form.gradYear) : null,
      },
    });
    setUser(me);
    setSaved(true);
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run();
  };

  return (
    <Window title="Profile" tone="olive">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Input
          label="Display name"
          value={form.displayName}
          onChange={set("displayName")}
          error={fields.displayName}
        />
        <Input
          label="College"
          value={form.college}
          onChange={set("college")}
          error={fields.college}
        />
        <Input label="Branch" value={form.branch} onChange={set("branch")} error={fields.branch} />
        <Input
          label="Graduation year"
          inputMode="numeric"
          value={form.gradYear}
          onChange={set("gradYear")}
          error={fields.gradYear}
        />
        {error && (
          <p role="alert" className="m-0 text-danger">
            ! {error}
          </p>
        )}
        <div className="flex items-center gap-4">
          <Button type="submit" loading={pending}>
            Save
          </Button>
          {saved && <span role="status">Saved!</span>}
        </div>
      </form>
    </Window>
  );
}

function Appearance() {
  const { user } = useAuth();
  const { run } = useSubmit(async (theme: Theme, readable: boolean) => {
    await api("/me/settings", { method: "PATCH", json: { theme, readableMode: readable } });
  });
  if (!user) return null;
  return (
    <Window title="Appearance" tone="sky">
      <p className="mt-0">Saved to your account, applied on every device.</p>
      <ThemeSwitcher onChange={({ theme, readable }) => void run(theme, readable)} />
    </Window>
  );
}

function Sessions() {
  const [items, setItems] = useState<SessionInfo[] | null>(null);
  const load = () => api<{ items: SessionInfo[] }>("/me/sessions").then((r) => setItems(r.items));
  const { logout } = useAuth();

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

export default function SettingsPage() {
  return (
    <div className="grid gap-6">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Settings</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileForm />
        <div className="grid content-start gap-6">
          <Appearance />
          <Sessions />
        </div>
      </div>
    </div>
  );
}
