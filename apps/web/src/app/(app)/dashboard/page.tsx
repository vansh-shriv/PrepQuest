"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonClasses, LoadingBar, Sprite, Window } from "@prepquest/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";

/** XP needed to reach the next level (placeholder curve until the XP system lands in Phase 5). */
const XP_PER_LEVEL = 100;

function VerifyBanner() {
  const [sent, setSent] = useState(false);
  const { run, pending, error } = useSubmit(async () => {
    await api("/auth/resend-verification", { method: "POST", json: {} });
    setSent(true);
  });

  return (
    <Window title="Verify your email" tone="sun">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="m-0">
          {sent
            ? "Sent! Check your inbox (in dev: Mailpit at localhost:8025)."
            : "Confirm your email to unlock AI mock interviews."}
        </p>
        {!sent && (
          <Button size="sm" loading={pending} onClick={() => void run()}>
            Resend link
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 mt-2 text-danger">
          {error}
        </p>
      )}
    </Window>
  );
}

function DeletionBanner({ requestedAt }: { requestedAt: string }) {
  const { reload } = useAuth();
  const purgeOn = new Date(new Date(requestedAt).getTime() + 14 * 86_400_000);
  const { run, pending, error } = useSubmit(async () => {
    await api("/me/cancel-deletion", { method: "POST", json: {} });
    await reload();
  });
  return (
    <Window title="Account scheduled for deletion" tone="danger">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="m-0">
          Everything will be permanently deleted on {purgeOn.toLocaleDateString()}.
        </p>
        <Button size="sm" loading={pending} onClick={() => void run()}>
          Cancel deletion
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 mt-2 text-danger">
          {error}
        </p>
      )}
    </Window>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  const { profile } = user;
  const levelProgress = ((profile.xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100;

  return (
    <div className="grid gap-6">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">
        Welcome, {profile.displayName}!
      </h1>

      {user.deletionRequestedAt && <DeletionBanner requestedAt={user.deletionRequestedAt} />}
      {!user.emailVerified && <VerifyBanner />}

      <div className="grid gap-6 md:grid-cols-2">
        <Window title="Level" tone="coin">
          <div className="flex items-center gap-4">
            <Sprite name="coin" scale={4} animate label="XP coin" />
            <div className="grid flex-1 gap-2">
              <span className="pq-font-display text-sm">LV {profile.level}</span>
              <LoadingBar value={levelProgress} size="sm" label="XP to next level" />
              <span className="pq-font-pixel text-xl">{profile.xp} XP</span>
            </div>
          </div>
        </Window>

        <Window title="Streak" tone="sun">
          <div className="flex items-center gap-4">
            <Sprite name="sunflower" scale={4} label="Streak sunflower" />
            <div className="grid gap-1">
              <span className="pq-font-display text-sm">{profile.streakCurrent} DAYS</span>
              <span className="pq-font-pixel text-xl">Best: {profile.streakBest}</span>
            </div>
          </div>
        </Window>
      </div>

      <Window title="Quest log" tone="sky">
        <p className="mt-0">
          Account and app shell are live. The problem bank, judge and AI interviews arrive in the
          next phases.
        </p>
        <Link href="/problems" className={buttonClasses({ variant: "accent" })}>
          Browse quests
        </Link>
      </Window>
    </div>
  );
}
