import Link from "next/link";
import { buttonClasses, LoadingBar, Sprite, Window } from "@prepquest/ui";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-6 text-center">
      <Sprite name="dino" scale={6} label="Pixel dino mascot" />
      <h1 className="pq-font-display text-2xl leading-relaxed">PrepQuest</h1>
      <p className="pq-font-pixel text-2xl">Level up for placements.</p>
      <Window title="Quest log" tone="sky" className="w-full max-w-md text-left">
        <LoadingBar value={10} label="Build progress" />
        <p className="mt-4">Design system is live. Auth, problems and the judge come next.</p>
      </Window>
      <Link href="/design" className={buttonClasses({ variant: "accent", size: "lg" })}>
        Design system
      </Link>
    </main>
  );
}
