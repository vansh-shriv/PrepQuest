// Unlock rules for hints (D4) and editorials (D5). The API enforces them; the web shows the reasons.

export type HintMode = "strict" | "relaxed";

/** Seconds before the first hint (after first opening the problem) and between tiers. */
export const HINT_COOLDOWN: Record<HintMode, { first: number; between: number }> = {
  strict: { first: 180, between: 300 },
  relaxed: { first: 0, between: 60 },
};

/** Seconds after first opening a problem before "I give up" becomes available. */
export const GIVE_UP_AFTER: Record<HintMode, number> = { strict: 600, relaxed: 120 };

export interface HintContext {
  tier: number;
  /** Tiers the user already viewed. */
  usedTiers: readonly number[];
  firstSeenAt: Date | null;
  /** When the most recent hint was viewed. */
  lastHintAt: Date | null;
  now: Date;
  mode: HintMode;
}

export type HintDecision =
  | { allowed: true; alreadyUsed: boolean }
  | { allowed: false; reason: "previous_tier"; missingTier: number }
  | { allowed: false; reason: "cooldown"; unlockAt: Date };

export function hintDecision(ctx: HintContext): HintDecision {
  if (ctx.usedTiers.includes(ctx.tier)) return { allowed: true, alreadyUsed: true };
  for (let t = 1; t < ctx.tier; t++) {
    if (!ctx.usedTiers.includes(t))
      return { allowed: false, reason: "previous_tier", missingTier: t };
  }
  const cooldown = HINT_COOLDOWN[ctx.mode];
  const anchor = ctx.tier === 1 ? ctx.firstSeenAt : (ctx.lastHintAt ?? ctx.firstSeenAt);
  const wait = ctx.tier === 1 ? cooldown.first : cooldown.between;
  if (anchor) {
    const unlockAt = new Date(anchor.getTime() + wait * 1000);
    if (unlockAt > ctx.now) return { allowed: false, reason: "cooldown", unlockAt };
  }
  return { allowed: true, alreadyUsed: false };
}

export interface EditorialContext {
  solved: boolean;
  usedTiers: readonly number[];
  /** The user's "open editorials" setting. */
  openEditorials: boolean;
  gaveUp: boolean;
  firstSeenAt: Date | null;
  now: Date;
  mode: HintMode;
}

export interface EditorialAccess {
  unlocked: boolean;
  /** Why it is unlocked (first matching rule). */
  via?: "solved" | "hints" | "setting" | "gave_up";
  /** Ways to unlock it, for the locked screen. */
  reasons: string[];
  /** When "I give up" becomes available; null when it already is or the problem was never opened. */
  giveUpAt: Date | null;
}

export function editorialAccess(ctx: EditorialContext): EditorialAccess {
  const allHints = [1, 2, 3].every((t) => ctx.usedTiers.includes(t));
  const via = ctx.solved
    ? "solved"
    : allHints
      ? "hints"
      : ctx.openEditorials
        ? "setting"
        : ctx.gaveUp
          ? "gave_up"
          : undefined;
  const giveUpAt = ctx.firstSeenAt
    ? new Date(ctx.firstSeenAt.getTime() + GIVE_UP_AFTER[ctx.mode] * 1000)
    : null;
  if (via) return { unlocked: true, via, reasons: [], giveUpAt: null };
  return {
    unlocked: false,
    reasons: [
      "Solve the problem",
      "View all three hints",
      "Give up (after a short wait, and it counts against a clean solve)",
    ],
    giveUpAt: giveUpAt && giveUpAt > ctx.now ? giveUpAt : null,
  };
}

/** True once the user may press "I give up". */
export function canGiveUp(ctx: Pick<EditorialContext, "firstSeenAt" | "now" | "mode">): boolean {
  if (!ctx.firstSeenAt) return false;
  return ctx.now.getTime() >= ctx.firstSeenAt.getTime() + GIVE_UP_AFTER[ctx.mode] * 1000;
}
