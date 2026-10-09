"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Sprite, Window } from "@prepquest/ui";
import { CONTENT_ROLES } from "@prepquest/shared";
import { useAuth } from "@/lib/auth-context";

/** The admin area is for content roles only. The API enforces this too; this just avoids a dead UI. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!(CONTENT_ROLES as readonly string[]).includes(user.role)) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <Sprite name="dino" scale={6} label="Dino" />
        <Window title="Restricted" tone="danger">
          <p className="mt-0">This area is for content editors and reviewers.</p>
          <Link href="/dashboard" className="underline">
            Back to the dashboard
          </Link>
        </Window>
      </div>
    );
  }
  return <>{children}</>;
}
