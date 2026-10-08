import type { ReactNode } from "react";
import { Sprite, Window } from "@prepquest/ui";

/** Centered window used by all signed-out account pages. */
export function AuthCard({
  title,
  tone = "sky",
  children,
}: {
  title: string;
  tone?: "sky" | "olive" | "coin" | "danger";
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="flex items-end gap-3">
        <Sprite name="dino" scale={4} label="PrepQuest dino" />
        <span className="pq-font-display text-lg">PrepQuest</span>
      </div>
      <Window title={title} tone={tone} className="w-full max-w-md">
        {children}
      </Window>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="pq-font-pixel m-0 text-xl text-danger">
      ! {message}
    </p>
  );
}
