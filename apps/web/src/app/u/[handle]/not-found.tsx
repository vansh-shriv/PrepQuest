import Link from "next/link";
import { buttonClasses, Sprite } from "@prepquest/ui";

export default function ProfileNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-4 text-center">
      <Sprite name="dino" scale={6} label="Dino" />
      <h1 className="pq-font-display m-0 text-base leading-relaxed">THIS PLAYER WENT EXTINCT</h1>
      <p className="m-0">No public profile here. It may be private or may not exist.</p>
      <Link href="/" className={buttonClasses()}>
        Home
      </Link>
    </main>
  );
}
