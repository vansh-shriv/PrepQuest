import { eq } from "drizzle-orm";
import { roadmaps, type Database } from "@prepquest/db";
import {
  DEFAULT_MASTER,
  DEFAULT_UNLOCK,
  depths,
  nextNode,
  nodeStatuses,
  type RoadmapNodeSpec,
} from "@prepquest/analytics-core";
import {
  AppError,
  type RoadmapDto,
  type RoadmapNodeDto,
  type RoadmapsResponse,
} from "@prepquest/shared";
import { loadLearner, masteriesFor, type Learner } from "../analytics/learner.js";
import { quizSkills } from "../quizzes/service.js";

// Roadmaps (P3): a graph of topics. A node's state comes from the learner's mastery of what it measures.

interface StoredNode {
  id: string;
  title: string;
  summary: string;
  topic?: string;
  quiz_subject?: string;
  resources?: Array<{ title: string; kind: string; note?: string }>;
  problems?: string[];
  requires: string[];
  unlock_threshold?: number;
  master_threshold?: number;
}

const specOf = (n: StoredNode): RoadmapNodeSpec => ({
  id: n.id,
  requires: n.requires,
  ...(n.unlock_threshold !== undefined ? { unlockThreshold: n.unlock_threshold } : {}),
  ...(n.master_threshold !== undefined ? { masterThreshold: n.master_threshold } : {}),
});

/** A quiz subject's mastery: accuracy, discounted until about eight answers back it up. */
const quizMastery = (score: number, answered: number) => score * Math.min(1, answered / 8);

async function measure(db: Database, userId: string, l: Learner, nodes: StoredNode[]) {
  const masteries = new Map(masteriesFor(l, () => 1).map((m) => [m.topic, m]));
  const skills = new Map((await quizSkills(db, userId, l.now)).map((s) => [s.subject, s]));
  const solved = new Set(l.rows.filter((r) => r.solved).map((r) => r.slug));
  const out = new Map<string, number | null>();
  for (const n of nodes) {
    if (n.topic) {
      const m = masteries.get(n.topic);
      out.set(n.id, m && m.attempted > 0 ? m.mastery : null);
    } else if (n.quiz_subject) {
      const s = skills.get(n.quiz_subject);
      out.set(n.id, s ? quizMastery(s.score, s.answered) : null);
    } else {
      const ladder = n.problems ?? [];
      out.set(
        n.id,
        ladder.length ? ladder.filter((p) => solved.has(p)).length / ladder.length : null,
      );
    }
  }
  return { mastery: out, solved };
}

export async function listRoadmaps(
  db: Database,
  userId: string,
  now: Date,
): Promise<RoadmapsResponse> {
  const rows = await db.select().from(roadmaps).where(eq(roadmaps.status, "published"));
  const l = await loadLearner(db, userId, now);
  const out: RoadmapsResponse["roadmaps"] = [];
  for (const r of rows.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const nodes = (r.data as { nodes: StoredNode[] }).nodes;
    const { mastery } = await measure(db, userId, l, nodes);
    const specs = nodes.map(specOf);
    const st = nodeStatuses(specs, mastery);
    const next = nextNode(specs, st);
    out.push({
      slug: r.slug,
      title: r.title,
      track: r.track,
      description: r.description,
      nodes: nodes.length,
      cleared: st.filter((s) => s.state === "cleared" || s.state === "mastered").length,
      mastered: st.filter((s) => s.state === "mastered").length,
      nextNode: next ? { id: next, title: nodes.find((n) => n.id === next)!.title } : null,
    });
  }
  return { roadmaps: out };
}

export async function getRoadmap(
  db: Database,
  userId: string,
  slug: string,
  now: Date,
): Promise<RoadmapDto> {
  const [r] = await db.select().from(roadmaps).where(eq(roadmaps.slug, slug));
  if (!r || r.status !== "published") throw new AppError("NOT_FOUND", 404, "Roadmap not found.");
  const nodes = (r.data as { nodes: StoredNode[] }).nodes;
  const l = await loadLearner(db, userId, now);
  const { mastery, solved } = await measure(db, userId, l, nodes);
  const specs = nodes.map(specOf);
  const layers = depths(specs);
  const st = new Map(nodeStatuses(specs, mastery).map((s) => [s.id, s]));
  const byProblem = new Map(l.rows.map((p) => [p.slug, p]));
  const titles = new Map(nodes.map((n) => [n.id, n.title]));
  const dto: RoadmapNodeDto[] = nodes.map((n) => {
    const s = st.get(n.id)!;
    const ladder = n.problems ?? [];
    return {
      id: n.id,
      title: n.title,
      summary: n.summary,
      state: s.state,
      mastery: s.mastery,
      layer: layers.get(n.id) ?? 0,
      requires: n.requires,
      blockedBy: s.blockedBy.map((b) => titles.get(b) ?? b),
      unlockThreshold: n.unlock_threshold ?? DEFAULT_UNLOCK,
      masterThreshold: n.master_threshold ?? DEFAULT_MASTER,
      resources: n.resources ?? [],
      measure: n.topic
        ? { kind: "topic", label: `Mastery of ${l.names.get(n.topic) ?? n.topic}` }
        : n.quiz_subject
          ? { kind: "quiz", label: "Quiz accuracy" }
          : { kind: "ladder", label: "Problems solved" },
      ladder: ladder
        .map((slugName) => byProblem.get(slugName))
        .filter((p): p is NonNullable<typeof p> => p !== undefined)
        .map((p, i, present) => ({
          slug: p.slug,
          title: p.title,
          difficulty: p.difficulty,
          solved: solved.has(p.slug),
          checkpoint: i === present.length - 1,
        })),
      quiz: n.quiz_subject
        ? { subject: n.quiz_subject, href: `/quizzes?subject=${n.quiz_subject}` }
        : null,
    };
  });
  return {
    slug: r.slug,
    title: r.title,
    track: r.track,
    description: r.description,
    nodes: dto,
    nextNode: nextNode(specs, [...st.values()]),
  };
}
