// Badges that can be computed from solve history today (doc 05 lists more for later features).

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  /** A `@prepquest/ui` sprite name. */
  sprite: "coin" | "sparkle" | "sunflower" | "plant" | "trophy" | "code";
}

export const BADGES: readonly BadgeDef[] = [
  {
    id: "first-blood",
    name: "First Blood",
    description: "Solve your first problem.",
    sprite: "sparkle",
  },
  { id: "ten-down", name: "Ten Down", description: "Solve 10 problems.", sprite: "coin" },
  {
    id: "week-warrior",
    name: "Week Warrior",
    description: "Keep a 7-day streak.",
    sprite: "sunflower",
  },
  { id: "hard-mode", name: "Hard Mode", description: "Solve a hard problem.", sprite: "trophy" },
  {
    id: "clean-sheet",
    name: "Clean Sheet",
    description: "Solve 5 problems first try without hints.",
    sprite: "plant",
  },
  {
    id: "polyglot",
    name: "Polyglot",
    description: "Get accepted in three languages.",
    sprite: "code",
  },
];

export interface BadgeStats {
  solvedTotal: number;
  solvedHard: number;
  /** Solved on the first submission and without hints. */
  cleanSolves: number;
  bestStreak: number;
  languagesAccepted: number;
}

const RULES: Record<string, (s: BadgeStats) => boolean> = {
  "first-blood": (s) => s.solvedTotal >= 1,
  "ten-down": (s) => s.solvedTotal >= 10,
  "week-warrior": (s) => s.bestStreak >= 7,
  "hard-mode": (s) => s.solvedHard >= 1,
  "clean-sheet": (s) => s.cleanSolves >= 5,
  polyglot: (s) => s.languagesAccepted >= 3,
};

/** Badge ids that the stats now qualify for and the user does not have yet. */
export function newBadges(stats: BadgeStats, earned: ReadonlySet<string>): string[] {
  return BADGES.filter((b) => !earned.has(b.id) && RULES[b.id]?.(stats)).map((b) => b.id);
}
