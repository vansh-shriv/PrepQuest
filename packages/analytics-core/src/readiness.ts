// Readiness per target (doc 04 A4). Deterministic: the same inputs always give the same score, band and
// ETA. A component with no evidence is reported as "not enough data" and drops out of the weighted
// average instead of being guessed; the confidence band widens as evidence thins.

import { addDays, daysBetween } from "./streak.js";

export const READINESS_COMPONENTS = [
  "dsa_breadth",
  "dsa_speed",
  "interview",
  "communication",
  "cs",
  "project",
  "aptitude",
  "design",
  "consistency",
] as const;
export type ReadinessKey = (typeof READINESS_COMPONENTS)[number];

export const COMPONENT_LABEL: Record<ReadinessKey, string> = {
  dsa_breadth: "DSA breadth",
  dsa_speed: "DSA speed and independence",
  interview: "Interview performance",
  communication: "Communication",
  cs: "CS fundamentals",
  project: "Project and resume defense",
  aptitude: "Aptitude and online tests",
  design: "System and low-level design",
  consistency: "Consistency",
};

/** Default weights, percent, for a product SDE-1 target (doc 04 A4). They sum to 100. */
export const DEFAULT_WEIGHTS: Record<ReadinessKey, number> = {
  dsa_breadth: 30,
  dsa_speed: 10,
  interview: 20,
  communication: 10,
  cs: 10,
  project: 8,
  aptitude: 5,
  design: 5,
  consistency: 2,
};

/** Where a readiness component's evidence comes from today (shown in the breakdown). */
export const COMPONENT_SOURCE: Record<ReadinessKey, string> = {
  dsa_breadth: "Topic mastery from your solves, speed and interviews",
  dsa_speed: "Time to solve and solving without hints",
  interview: "Scorecards of your mock interviews",
  communication: "Communication score in your scorecards",
  cs: "CS quizzes and CS fundamentals mock interviews",
  project: "Project deep-dive and resume interviews",
  aptitude: "Not built yet",
  design: "System design and low-level design interviews",
  consistency: "Days you practised in the last two weeks",
};

export interface ComponentInput {
  /** 0 to 1, or null when there is no evidence at all. */
  score: number | null;
  /** 0 to 1: how much evidence backs the score. */
  confidence: number;
}

export type ComponentInputs = Record<ReadinessKey, ComponentInput>;

export interface ReadinessComponent {
  key: ReadinessKey;
  label: string;
  source: string;
  weight: number;
  /** 0 to 100, or null for "not enough data". */
  score: number | null;
  confidence: number;
  /** Points of the final score this component contributes (renormalised weight x score). */
  points: number;
  /** Points still on the table: renormalised weight x (100 - score). */
  headroom: number;
}

export interface Lever {
  action: string;
  /** Estimated gain in readiness points. An estimate, not a promise. */
  gain: number;
  component: ReadinessKey;
}

export interface Snapshot {
  date: string;
  score: number;
}

export interface Eta {
  /** Readiness the estimate aims for. */
  goal: number;
  date: string | null;
  /** Points per day the estimate assumes. */
  pointsPerDay: number | null;
  message: string;
  /** Relative to the placement date, when there is one. */
  onTrack: boolean | null;
}

export interface Readiness {
  /** Null when too little evidence exists to say anything honest: take the diagnostic. */
  score: number | null;
  band: number | null;
  label: string;
  coverage: number;
  components: ReadinessComponent[];
  limiting: ReadinessComponent[];
  levers: Lever[];
  eta: Eta;
}

/** Below this share of the weight with real evidence the score is withheld. */
export const MIN_COVERAGE = 0.05;
/** What a component with no confidence is assumed to be worth (0 to 1). */
export const EVIDENCE_PRIOR = 0.3;
/** Readiness at which the ETA is "ready". */
export const READY_AT = 75;

export function readinessLabel(score: number | null): string {
  if (score === null) return "Not enough data";
  if (score >= 85) return "Interview ready";
  if (score >= READY_AT) return "Ready";
  if (score >= 55) return "On the way";
  if (score >= 35) return "Building";
  return "Just starting";
}

/** Least-squares slope of score per day over the last `window` days; null with fewer than 3 points or a 0-day span. */
export function trendPerDay(
  history: readonly Snapshot[],
  today: string,
  window = 21,
): number | null {
  const pts = history
    .filter((h) => daysBetween(h.date, today) <= window && daysBetween(h.date, today) >= 0)
    .map((h) => ({ x: daysBetween(h.date, today) * -1, y: h.score }));
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  const den = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  if (den === 0) return null;
  return pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / den;
}

export function estimateEta(
  score: number | null,
  history: readonly Snapshot[],
  today: string,
  placementDate: string | null,
): Eta {
  if (score === null) {
    return {
      goal: READY_AT,
      date: null,
      pointsPerDay: null,
      message: "Take the diagnostic first: there is not enough data for an estimate.",
      onTrack: null,
    };
  }
  if (score >= READY_AT) {
    return {
      goal: READY_AT,
      date: today,
      pointsPerDay: null,
      message: "You are there. Keep it sharp.",
      onTrack: true,
    };
  }
  const slope = trendPerDay(history, today);
  if (slope === null || slope < 0.05) {
    return {
      goal: READY_AT,
      date: null,
      pointsPerDay: slope,
      message:
        slope === null
          ? "Not enough history yet for an estimate: it needs a few days of snapshots."
          : "Your score is flat at the moment, so no date can be estimated.",
      onTrack: null,
    };
  }
  const days = Math.ceil((READY_AT - score) / slope);
  const date = addDays(today, Math.min(days, 3650));
  const onTrack = placementDate ? daysBetween(date, placementDate) >= 0 : null;
  return {
    goal: READY_AT,
    date,
    pointsPerDay: Math.round(slope * 100) / 100,
    message: placementDate
      ? onTrack
        ? `At this pace you reach ${READY_AT} by ${date}, before your ${placementDate} date.`
        : `At this pace you reach ${READY_AT} by ${date}, after your ${placementDate} date: step up.`
      : `At this pace you reach ${READY_AT} by ${date}.`,
    onTrack,
  };
}

export interface TopicGap {
  topic: string;
  name: string;
  mastery: number;
  /** Share of the breadth component this topic carries (0 to 1). */
  share: number;
}

/**
 * Readiness from component inputs. `weights` are percent; `topicGaps` feed the highest-leverage actions
 * for DSA breadth. Weights of components without evidence are redistributed over the others.
 */
export function computeReadiness(
  inputs: ComponentInputs,
  options: {
    weights?: Record<ReadinessKey, number>;
    topicGaps?: readonly TopicGap[];
    history?: readonly Snapshot[];
    today: string;
    placementDate?: string | null;
  },
): Readiness {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const totalW = READINESS_COMPONENTS.reduce((a, k) => a + weights[k], 0);
  const known = READINESS_COMPONENTS.filter((k) => inputs[k].score !== null);
  const knownW = known.reduce((a, k) => a + weights[k], 0);
  // share of all weight that rests on real evidence, discounted by how confident that evidence is
  const coverage =
    totalW === 0
      ? 0
      : READINESS_COMPONENTS.reduce(
          (a, k) => a + (inputs[k].score === null ? 0 : weights[k] * inputs[k].confidence),
          0,
        ) / totalW;

  const components: ReadinessComponent[] = READINESS_COMPONENTS.map((key) => {
    const inp = inputs[key];
    const norm = inp.score === null || knownW === 0 ? 0 : weights[key] / knownW;
    const score = inp.score === null ? null : Math.round(inp.score * 1000) / 10;
    // thin evidence is pulled towards a low prior, so a score has to be earned with evidence
    const conf = Math.max(0, Math.min(1, inp.confidence));
    const effective =
      inp.score === null ? null : (conf * inp.score + (1 - conf) * EVIDENCE_PRIOR) * 100;
    return {
      key,
      label: COMPONENT_LABEL[key],
      source: COMPONENT_SOURCE[key],
      weight: weights[key],
      score,
      confidence: Math.round(inp.confidence * 100) / 100,
      points: effective === null ? 0 : Math.round(norm * effective * 10) / 10,
      headroom: effective === null ? 0 : Math.round(norm * (100 - effective) * 10) / 10,
    };
  });

  const withheld = coverage < MIN_COVERAGE || known.length === 0;
  const raw = components.reduce((a, c) => a + c.points, 0);
  const score = withheld ? null : Math.round(raw);
  // the band is +/- 3 with solid evidence and widens to +/- 18 as coverage falls
  const band = score === null ? null : Math.round(3 + 15 * (1 - Math.min(1, coverage)));

  const limiting = components
    .filter((c) => c.score !== null && c.headroom > 0)
    .sort((a, b) => b.headroom - a.headroom || a.key.localeCompare(b.key))
    .slice(0, 3);

  const levers: Lever[] = [];
  const breadth = components.find((c) => c.key === "dsa_breadth");
  if (breadth && breadth.score !== null && knownW > 0) {
    const norm = weights.dsa_breadth / knownW;
    for (const g of (options.topicGaps ?? []).filter((t) => t.mastery < 0.8)) {
      // lifting this topic to 80% mastery
      const gain = norm * g.share * (0.8 - g.mastery) * 100;
      if (gain >= 0.5) {
        levers.push({
          action: `Practise ${g.name}: bring it to 80%`,
          gain: Math.round(gain * 10) / 10,
          component: "dsa_breadth",
        });
      }
    }
  }
  for (const c of components) {
    if (c.key === "dsa_breadth" || c.score === null || c.score >= 80) continue;
    const norm = knownW === 0 ? 0 : weights[c.key] / knownW;
    const effective = norm === 0 ? c.score : 100 - c.headroom / norm;
    const gain = norm * Math.max(0, 80 - effective);
    if (gain >= 0.5) {
      levers.push({
        action: LEVER_TEXT[c.key],
        gain: Math.round(gain * 10) / 10,
        component: c.key,
      });
    }
  }
  levers.sort((a, b) => b.gain - a.gain || a.action.localeCompare(b.action));

  return {
    score,
    band,
    label: readinessLabel(score),
    coverage: Math.round(coverage * 100) / 100,
    components,
    limiting,
    levers: levers.slice(0, 5),
    eta: estimateEta(score, options.history ?? [], options.today, options.placementDate ?? null),
  };
}

const LEVER_TEXT: Record<ReadinessKey, string> = {
  dsa_breadth: "Practise your weakest topics",
  dsa_speed: "Solve problems without hints and inside the expected time",
  interview: "Do more mock interviews and work through the feedback",
  communication: "Think aloud and structure answers in mock interviews",
  cs: "Take CS quizzes or run a CS mock round",
  project: "Run a project deep-dive on your best project",
  aptitude: "Practise aptitude drills",
  design: "Run a system design round",
  consistency: "Practise a little every day",
};
