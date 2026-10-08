"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { LoadingBar } from "@prepquest/ui";
import { useAuth } from "@/lib/auth-context";

/** Signed-out pages: sends signed-in users to the dashboard. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authed") router.replace("/dashboard");
  }, [status, router]);

  if (status === "authed") return null;
  if (status === "loading") {
    return (
      <div className="mx-auto flex min-h-screen max-w-xs items-center">
        <LoadingBar label="Loading" />
      </div>
    );
  }
  return <>{children}</>;
}
