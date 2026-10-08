"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Checkbox, Input, Window } from "@prepquest/ui";
import type { MeResponse } from "@prepquest/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";

export function ProfileSection() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    displayName: user?.profile.displayName ?? "",
    college: user?.profile.college ?? "",
    branch: user?.profile.branch ?? "",
    gradYear: user?.profile.gradYear ? String(user.profile.gradYear) : "",
  });
  const [publicProfile, setPublicProfile] = useState(user?.profile.publicProfile ?? false);
  const [privacy, setPrivacy] = useState(
    user?.profile.privacy ?? { showBio: true, showCollege: true, showStats: true },
  );
  const [saved, setSaved] = useState(false);

  const touch = () => setSaved(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    touch();
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
        publicProfile,
        privacy,
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

        <fieldset className="m-0 grid gap-1 border-0 p-0">
          <legend className="pq-label mb-1 p-0">Public profile</legend>
          <Checkbox
            label="Let anyone view my profile"
            helper="Off by default. Your email is never shown."
            checked={publicProfile}
            onChange={(e) => {
              touch();
              setPublicProfile(e.target.checked);
            }}
          />
          {publicProfile && (
            <div className="ml-9 grid gap-0">
              <Checkbox
                label="Show my bio"
                checked={privacy.showBio}
                onChange={(e) => {
                  touch();
                  setPrivacy((p) => ({ ...p, showBio: e.target.checked }));
                }}
              />
              <Checkbox
                label="Show my college"
                checked={privacy.showCollege}
                onChange={(e) => {
                  touch();
                  setPrivacy((p) => ({ ...p, showCollege: e.target.checked }));
                }}
              />
              <Checkbox
                label="Show XP, level and streak"
                checked={privacy.showStats}
                onChange={(e) => {
                  touch();
                  setPrivacy((p) => ({ ...p, showStats: e.target.checked }));
                }}
              />
            </div>
          )}
        </fieldset>
        {user?.profile.publicProfile && (
          <Link href={`/u/${user.profile.handle}`} className="text-sm underline">
            View my public page
          </Link>
        )}

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
