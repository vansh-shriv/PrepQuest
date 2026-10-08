"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { LoadingBar } from "@prepquest/ui";
import { AuthCard } from "@/components/auth/AuthCard";
import { MfaForm } from "@/components/auth/MfaForm";
import { useAuth } from "@/lib/auth-context";

/**
 * Landing page after social sign-in. The API has already set the refresh cookie (the auth context
 * exchanges it for an access token on load), or passes `?mfa=` when a second factor is still needed.
 */
export function OAuthCallback() {
  const mfaToken = useSearchParams().get("mfa");
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authed") router.replace("/dashboard");
    if (status === "anon" && !mfaToken) router.replace("/login?error=oauth_provider");
  }, [status, mfaToken, router]);

  if (mfaToken) {
    return (
      <AuthCard title="Second check" tone="olive">
        <MfaForm mfaToken={mfaToken} onDone={() => router.replace("/dashboard")} />
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Signing in" tone="olive">
      <LoadingBar label="Almost there" />
    </AuthCard>
  );
}
