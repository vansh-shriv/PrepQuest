import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buttonClasses, Sprite, Window } from "@prepquest/ui";
import type { PublicProfile } from "@prepquest/shared";
import { API_URL } from "@/lib/api";

type Params = Promise<{ handle: string }>;

/** Server-side fetch of the privacy-filtered profile. Private and missing profiles both 404. */
async function loadProfile(handle: string): Promise<PublicProfile | null> {
  try {
    const res = await fetch(`${API_URL}/v1/u/${encodeURIComponent(handle)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PublicProfile;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const profile = await loadProfile((await params).handle);
  return profile
    ? { title: `${profile.displayName} (@${profile.handle}) | PrepQuest` }
    : { title: "Profile not found | PrepQuest" };
}

export default async function PublicProfilePage({ params }: { params: Params }) {
  const profile = await loadProfile((await params).handle);
  if (!profile) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-4">
      <Window title={`@${profile.handle}`} tone="sky">
        <div className="grid gap-4">
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="pq-box pq-font-display flex h-14 w-14 items-center justify-center bg-folder text-sm text-[#1a1a1a]"
            >
              {profile.displayName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <h1 className="pq-font-display m-0 text-base leading-relaxed">
                {profile.displayName}
              </h1>
              {profile.college && <p className="m-0">{profile.college}</p>}
            </div>
          </div>
          {profile.bio && <p className="m-0">{profile.bio}</p>}
          {profile.stats && (
            <dl className="m-0 grid grid-cols-3 gap-3 text-center">
              <div>
                <dt className="pq-font-ui text-xs uppercase">Level</dt>
                <dd className="pq-font-display m-0 text-sm">{profile.stats.level}</dd>
              </div>
              <div>
                <dt className="pq-font-ui flex items-center justify-center gap-1 text-xs uppercase">
                  <Sprite name="coin" scale={1.5} /> XP
                </dt>
                <dd className="pq-font-display m-0 text-sm">{profile.stats.xp}</dd>
              </div>
              <div>
                <dt className="pq-font-ui flex items-center justify-center gap-1 text-xs uppercase">
                  <Sprite name="sunflower" scale={1} /> Streak
                </dt>
                <dd className="pq-font-display m-0 text-sm">{profile.stats.streakCurrent}</dd>
              </div>
            </dl>
          )}
          <p className="m-0 text-sm text-ink-soft">
            Joined{" "}
            {new Date(profile.joinedAt).toLocaleDateString("en", {
              year: "numeric",
              month: "long",
            })}
          </p>
        </div>
      </Window>
      <Link href="/signup" className={buttonClasses({ variant: "accent" })}>
        Start your own quest
      </Link>
    </main>
  );
}
