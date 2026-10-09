"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Dialog, SearchPill, Sprite } from "@prepquest/ui";
import { useAuth } from "@/lib/auth-context";
import { isActive, isFullBleed, MOBILE_TABS, navItemsFor } from "./nav";

function sunflowerLabel(streak: number): string {
  return streak > 0 ? `${streak} day streak` : "No streak yet";
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user } = useAuth();
  const pathname = usePathname();
  // the problem list has its own, richer search box: don't show two on one page
  const showSearch = pathname !== "/problems";
  const router = useRouter();
  const [query, setQuery] = useState("");

  const search = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) router.push(`/problems?q=${encodeURIComponent(q)}`);
  };

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b-[3px] border-ink bg-bg px-3 py-2 md:px-4">
      <Link
        href="/dashboard"
        aria-label="PrepQuest home"
        className="pq-font-display pq-box bg-sky px-2 py-1 text-xs text-[var(--on-sky)]"
      >
        PQ
      </Link>
      <Button size="sm" onClick={onMenu} aria-haspopup="dialog">
        Menu
      </Button>
      {showSearch ? (
        <form onSubmit={search} className="mx-2 hidden max-w-md flex-1 md:block" role="search">
          <SearchPill
            label="Search problems"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
      ) : (
        <span className="hidden flex-1 md:block" />
      )}
      <div className="ml-auto flex items-center gap-4">
        <span className="flex items-center gap-1" title="Experience points">
          <Sprite name="coin" scale={2} animate />
          <span className="pq-font-display text-[10px]" aria-label={`${user?.profile.xp ?? 0} XP`}>
            {user?.profile.xp ?? 0}
          </span>
        </span>
        <span
          className="flex items-center gap-1"
          title={sunflowerLabel(user?.profile.streakCurrent ?? 0)}
        >
          <Sprite name="sunflower" scale={1.5} />
          <span className="pq-font-display text-[10px]">{user?.profile.streakCurrent ?? 0}</span>
        </span>
        <Link
          href="/settings"
          aria-label="Settings and profile"
          className="pq-box pq-font-display flex h-9 w-9 items-center justify-center bg-folder text-[10px] text-[#1a1a1a]"
        >
          {(user?.profile.displayName ?? "?").slice(0, 2).toUpperCase()}
        </Link>
      </div>
    </header>
  );
}

function SideRail() {
  const pathname = usePathname();
  const { user } = useAuth();
  const items = navItemsFor(user?.role);
  return (
    <nav
      aria-label="Main"
      className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-[72px] shrink-0 flex-col items-center gap-2 border-r-[3px] border-ink bg-surface-alt py-4 md:flex"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            title={item.label}
            className={`flex h-12 w-12 flex-col items-center justify-center gap-1 ${
              active ? "pq-box bg-coin text-[var(--on-coin)]" : "text-ink hover:text-sky"
            }`}
          >
            <Sprite name={item.icon} scale={2} />
          </Link>
        );
      })}
    </nav>
  );
}

function BottomTabs({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t-[3px] border-ink bg-bg md:hidden"
    >
      {MOBILE_TABS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[56px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 ${
              active ? "bg-coin text-[var(--on-coin)]" : "text-ink"
            }`}
          >
            <Sprite name={item.icon} scale={2} />
            <span className="pq-font-ui text-[10px] uppercase">{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMenu}
        className="pq-font-ui flex min-h-[56px] min-w-[44px] flex-1 flex-col items-center justify-center bg-olive text-[10px] uppercase text-[var(--on-olive)]"
      >
        Menu
      </button>
    </nav>
  );
}

function MenuDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { logout, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // close the drawer after navigating
  useEffect(() => {
    if (open) onClose();
  }, [pathname]);

  return (
    <Dialog open={open} onClose={onClose} title="Menu" tone="olive">
      <ul className="m-0 grid list-none gap-2 p-0">
        {[
          ...navItemsFor(user?.role),
          { href: "/settings", label: "Settings", icon: "user" as const },
        ].map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="pq-font-ui flex min-h-[44px] items-center gap-3 px-2 text-sm uppercase hover:bg-surface-alt"
            >
              <Sprite name={item.icon} scale={2} />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button
          variant="ghost"
          onClick={async () => {
            onClose();
            await logout();
            router.replace("/login");
          }}
        >
          Sign out
        </Button>
      </div>
    </Dialog>
  );
}

/** Authenticated layout: top bar, icon rail (desktop) or bottom tabs (mobile), and the page. */
export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const bleed = isFullBleed(usePathname());
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="pq-sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-surface focus:p-2"
      >
        Skip to content
      </a>
      <TopBar onMenu={() => setMenuOpen(true)} />
      <div className="flex">
        <SideRail />
        <main
          id="main"
          className={
            bleed
              ? "min-w-0 flex-1"
              : "mx-auto w-full max-w-[1280px] flex-1 p-4 pb-24 md:p-8 md:pb-8"
          }
        >
          {children}
        </main>
      </div>
      <BottomTabs onMenu={() => setMenuOpen(true)} />
      <MenuDialog open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
