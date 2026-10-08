"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { LoadingBar } from "@prepquest/ui";
import { AppShell } from "@/components/shell/AppShell";
import { useAuth } from "@/lib/auth-context";

/** Everything under (app) requires a signed-in user. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anon") router.replace("/login");
  }, [status, router]);

  if (status !== "authed") {
    return (
      <div className="mx-auto flex min-h-screen max-w-xs items-center">
        <LoadingBar label="Loading" />
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}
