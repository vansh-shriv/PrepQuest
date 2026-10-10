"use client";

import { useState } from "react";
import { Button, Window } from "@prepquest/ui";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";

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

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">
        Welcome, {profile.displayName}!
      </h1>

      {user.deletionRequestedAt && <DeletionBanner requestedAt={user.deletionRequestedAt} />}
      {!user.emailVerified && <VerifyBanner />}

      <Dashboard />
    </div>
  );
}
