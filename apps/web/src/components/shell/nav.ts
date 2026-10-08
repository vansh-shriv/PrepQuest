import type { SpriteName } from "@prepquest/ui";

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
  { href: "/interview", label: "Interview", icon: "chat", phase: 6 },
  { href: "/quizzes", label: "Quizzes", icon: "quiz", phase: 8 },
  { href: "/plan", label: "Plan", icon: "plan", phase: 8 },
  { href: "/analytics", label: "Analytics", icon: "chart", phase: 8 },
  { href: "/contests", label: "Contests", icon: "trophy", phase: 9 },
];

/** The five tabs shown on the mobile bottom bar; everything else lives behind MENU. */
export const MOBILE_TABS = NAV_ITEMS.filter((i) =>
  ["/dashboard", "/problems", "/interview", "/plan", "/analytics"].includes(i.href),
);

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
