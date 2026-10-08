import Link from "next/link";
import { buttonClasses, Sprite, Window } from "@prepquest/ui";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-6 text-center">
      <Sprite name="dino" scale={6} label="Pixel dino mascot" />
      <h1 className="pq-font-display text-2xl leading-relaxed">PrepQuest</h1>
      <p className="pq-font-pixel text-2xl">Level up for placements.</p>
      <Window title="Quest log" tone="sky" className="w-full max-w-md text-left">
        <p className="mt-0">DSA practice, AI mock interviews and a plan that adapts to you.</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/signup" className={buttonClasses({ variant: "accent" })}>
            Start quest
          </Link>
          <Link href="/login" className={buttonClasses({ variant: "ghost" })}>
            Log in
          </Link>
        </div>
      </Window>
    </main>
  );
}
