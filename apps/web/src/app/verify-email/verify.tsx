"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LoadingBar } from "@prepquest/ui";
import { AuthCard } from "@/components/auth/AuthCard";
import { api, ApiError } from "@/lib/api";

type State = { kind: "working" } | { kind: "ok" } | { kind: "failed"; message: string };

let consumed: string | null = null; // the token is single-use: never send it twice (React Strict Mode)

export function VerifyEmail() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<State>({ kind: "working" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "failed", message: "This link is missing its token." });
      return;
    }
    if (consumed === token) return;
    consumed = token;
    api("/auth/verify-email", { method: "POST", json: { token } })
      .then(() => setState({ kind: "ok" }))
      .catch((err: unknown) =>
        setState({
          kind: "failed",
          message: err instanceof ApiError ? err.message : "Can't reach the server.",
        }),
      );
  }, [token]);

  return (
    <AuthCard title="Email check" tone={state.kind === "failed" ? "danger" : "olive"}>
      {state.kind === "working" && <LoadingBar label="Verifying" />}
      {state.kind === "ok" && (
        <div className="grid gap-4" role="status">
          <p className="m-0">QUEST COMPLETE! Your email is verified.</p>
          <Link href="/dashboard" className="underline">
            Continue
          </Link>
        </div>
      )}
      {state.kind === "failed" && (
        <div className="grid gap-4" role="alert">
          <p className="m-0">{state.message}</p>
          <Link href="/dashboard" className="underline">
            Go to dashboard to resend the link
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
