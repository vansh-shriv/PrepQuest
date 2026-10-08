"use client";

import { useEffect, useState } from "react";
import { buttonClasses } from "@prepquest/ui";
import { API_URL, api } from "@/lib/api";

const LABELS: Record<string, string> = { google: "Google", github: "GitHub" };

/** "Continue with ..." links for the providers the server has configured (none shown otherwise). */
export function OAuthButtons() {
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    api<{ providers: string[] }>("/auth/oauth/providers")
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]));
  }, []);

  if (providers.length === 0) return null;
  return (
    <div className="grid gap-3">
      <p className="pq-font-ui m-0 text-center text-xs uppercase">or</p>
      {providers.map((id) => (
        // full-page navigation: the API redirects to the provider and back
        <a
          key={id}
          href={`${API_URL}/v1/auth/oauth/${id}/start`}
          className={buttonClasses({ variant: "ghost" })}
        >
          Continue with {LABELS[id] ?? id}
        </a>
      ))}
    </div>
  );
}

const OAUTH_ERRORS: Record<string, string> = {
  oauth_denied: "Sign-in was cancelled.",
  oauth_state: "That sign-in link expired. Please try again.",
  oauth_provider: "The sign-in provider had a problem. Please try again.",
  oauth_unverified_email:
    "Your provider account has no verified email address, so we can't sign you in.",
};

export function oauthErrorMessage(code: string | null): string | null {
  return code ? (OAUTH_ERRORS[code] ?? "Sign-in failed. Please try again.") : null;
}
