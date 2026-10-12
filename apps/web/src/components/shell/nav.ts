import type { SpriteName } from "@prepquest/ui";
import { CONTENT_ROLES, type UserRole } from "@prepquest/shared";

export interface NavItem {
  href: string;
  label: string;
  icon: SpriteName;
  /** Phase in which the page is built (shown on placeholder pages). */
  phase?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/problems", label: "Practice", icon: "code", phase: 3 },
  { href: "/reviews", label: "Reviews", icon: "sparkle" },
  { href: "/interview", label: "Interview", icon: "chat" },
  { href: "/quizzes", label: "Quizzes", icon: "quiz" },
  { href: "/roadmaps", label: "Roadmaps", icon: "plant" },
  { href: "/tracks", label: "Tracks", icon: "folder" },
  { href: "/plan", label: "Plan", icon: "plan" },
  { href: "/analytics", label: "Analytics", icon: "chart" },
  { href: "/contests", label: "Contests", icon: "trophy", phase: 9 },
];

const ADMIN_ITEM: NavItem = { href: "/admin/problems", label: "Admin", icon: "admin" };

/** Navigation for a role: content editors, reviewers and admins also get the Admin section. */
export function navItemsFor(role: UserRole | undefined): NavItem[] {
  return role && (CONTENT_ROLES as readonly string[]).includes(role)
    ? [...NAV_ITEMS, ADMIN_ITEM]
    : NAV_ITEMS;
}

/** Pages that use the whole viewport (no centered column, no padding), e.g. the problem workspace. */
export function isFullBleed(pathname: string): boolean {
  // the live interview room (a session id), but not its review or the setup pages
  return /^\/problems\/[^/]+/.test(pathname) || /^\/interview\/[0-9a-f-]{36}$/.test(pathname);
}

/** The five tabs shown on the mobile bottom bar; everything else lives behind MENU. */
export const MOBILE_TABS = NAV_ITEMS.filter((i) =>
  ["/dashboard", "/problems", "/interview", "/plan", "/analytics"].includes(i.href),
);

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
