"use client";

import { useEffect, useState } from "react";
import { Button, LoadingBar, Sprite, Window } from "@prepquest/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";

type Access = "checking" | "allowed" | "unverified" | "error";

/** AI interviews cost money per session, so they require a verified email. */
export default function InterviewPage() {
  const { user } = useAuth();
  const [access, setAccess] = useState<Access>("checking");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api("/interviews/access")
      .then(() => setAccess("allowed"))
      .catch((err: unknown) =>
        setAccess(
          err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED" ? "unverified" : "error",
        ),
      );
  }, [user?.emailVerified]);

  const resend = useSubmit(async () => {
    await api("/auth/resend-verification", { method: "POST", json: {} });
    setSent(true);
  });

  return (
    <div className="grid max-w-xl gap-6">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">Boss fights</h1>

      {access === "checking" && <LoadingBar label="Checking access" />}

      {access === "unverified" && (
        <Window title="Verify your email" tone="sun">
          <p className="mt-0">
            AI mock interviews unlock once your email is verified. Check your inbox for the link
            {sent ? " (a new one is on its way)" : ""}.
          </p>
          {resend.error && (
            <p role="alert" className="text-danger">
              ! {resend.error}
            </p>
          )}
          <Button size="sm" loading={resend.pending} onClick={() => void resend.run()}>
            Resend link
          </Button>
        </Window>
      )}

      {access === "allowed" && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <Sprite name="dino" scale={6} label="Dino" />
          <p className="pq-font-pixel m-0 text-2xl">NOTHING HERE YET. START A QUEST!</p>
          <p className="m-0 text-sm text-ink-soft">
            You&apos;re cleared for AI interviews. They arrive in build phase 6.
          </p>
        </div>
      )}

      {access === "error" && (
        <Window title="Error" tone="danger">
          Couldn&apos;t check your access. Try again in a moment.
        </Window>
      )}
    </div>
  );
}
