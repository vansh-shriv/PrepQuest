import type { TranscriptTurn } from "@prepquest/interview-core";

// Hand-written golden interviews with expected scores (1-5) per dimension. They are small on
// purpose: they check that scoring is anchored (strong beats weak, evidence is real, results do not
// wobble between runs), not that the model reproduces a human panel. Real golden sessions come from
// reviewed recordings (doc 13 section 10); replace or extend this file with them.

export interface GoldenSession {
  id: string;
  title: string;
  turns: TranscriptTurn[];
  /** Expected score per dimension, null where the transcript gives no evidence. */
  labels: Record<string, number | null>;
  /** Hints given in the session. */
  hintsGiven: number;
}

const t = (seq: number, speaker: "interviewer" | "candidate", text: string): TranscriptTurn => ({
  seq,
  speaker,
  text,
  offsetMs: seq * 45_000,
});

export const GOLDEN: GoldenSession[] = [
  {
    id: "strong",
    title: "Strong: clarifies, finds the optimum alone, analyses, tests",
    hintsGiven: 0,
    labels: {
      problem_solving: 5,
      communication: 5,
      optimization: 5,
      edge_cases: 5,
      testing: 4,
      code_quality: null,
    },
    turns: [
      t(
        1,
        "interviewer",
        "Here is the problem: return the indices of two numbers in an array that add up to a target.",
      ),
      t(
        2,
        "candidate",
        "Before I start: can the array contain duplicates or negative numbers, is there always exactly one valid pair, and may I use the same element twice?",
      ),
      t(
        3,
        "interviewer",
        "Duplicates and negatives are possible, there is exactly one pair, and no reuse of an element.",
      ),
      t(
        4,
        "candidate",
        "Then the brute force checks every pair in O(n squared). Better: scan once, keep a hash map from value to index, and for each number look up target minus the number. That is O(n) time and O(n) space, and it handles duplicates because I check before inserting.",
      ),
      t(5, "interviewer", "Go ahead and code it."),
      t(
        6,
        "candidate",
        "Done. Let me dry-run it on 3, 3 with target 6: the first 3 is stored, the second finds its complement at index 0. I would also test an empty array, a single element, negatives, and a case where the answer is the last two elements.",
      ),
      t(7, "interviewer", "Can you reduce the space?"),
      t(
        8,
        "candidate",
        "Not below O(n) without sorting, and sorting loses the original indices unless I keep pairs, so the hash map is the right trade-off here.",
      ),
    ],
  },
  {
    id: "good-with-hint",
    title: "Good: reaches the optimum after one hint, decent communication",
    hintsGiven: 1,
    labels: {
      problem_solving: 4,
      communication: 4,
      optimization: 4,
      edge_cases: 3,
      testing: 3,
      code_quality: null,
    },
    turns: [
      t(
        1,
        "interviewer",
        "Here is the problem: return the indices of two numbers that add up to a target.",
      ),
      t(
        2,
        "candidate",
        "I will start with two loops over all pairs. That is O(n squared) but it is correct.",
      ),
      t(3, "interviewer", "Can you do better? What do you need to look up quickly?"),
      t(
        4,
        "candidate",
        "Hmm, I need to find the complement fast. A hash map from number to index would give constant lookup, so one pass would be O(n).",
      ),
      t(5, "interviewer", "Go ahead."),
      t(
        6,
        "candidate",
        "Finished. I ran the sample and it passes. What about an empty array? I would return an empty list.",
      ),
    ],
  },
  {
    id: "mid",
    title: "Mid: brute force, limited analysis, no tests",
    hintsGiven: 1,
    labels: {
      problem_solving: 3,
      communication: 3,
      optimization: 2,
      edge_cases: 2,
      testing: 1,
      code_quality: null,
    },
    turns: [
      t(
        1,
        "interviewer",
        "Here is the problem: return the indices of two numbers that add up to a target.",
      ),
      t(2, "candidate", "I will use two for loops and return the pair when the sum matches."),
      t(3, "interviewer", "What is the time complexity?"),
      t(4, "candidate", "I think it is n squared."),
      t(
        5,
        "interviewer",
        "Can it be faster? One hint: think about what you could remember as you scan.",
      ),
      t(6, "candidate", "Maybe store the numbers somewhere. I am not sure how."),
      t(7, "interviewer", "Take your time."),
      t(8, "candidate", "I will just keep the two loops, I think that is fine."),
    ],
  },
  {
    id: "weak",
    title: "Weak: no approach, wrong claims, needs heavy help",
    hintsGiven: 2,
    labels: {
      problem_solving: 1,
      communication: 2,
      optimization: 1,
      edge_cases: 1,
      testing: 1,
      code_quality: null,
    },
    turns: [
      t(
        1,
        "interviewer",
        "Here is the problem: return the indices of two numbers that add up to a target.",
      ),
      t(2, "candidate", "I do not know where to start."),
      t(3, "interviewer", "What would you do by hand with a small example?"),
      t(4, "candidate", "Add them all up?"),
      t(5, "interviewer", "Hint: consider pairs of numbers."),
      t(
        6,
        "candidate",
        "Okay, sort of. Is it O(1)? I guess it is constant time because we just add two numbers.",
      ),
      t(7, "interviewer", "Can you walk through your plan?"),
      t(8, "candidate", "I do not have one."),
    ],
  },
  {
    id: "silent",
    title: "Almost silent: too little to judge",
    hintsGiven: 0,
    labels: {
      problem_solving: null,
      communication: 1,
      optimization: null,
      edge_cases: null,
      testing: null,
      code_quality: null,
    },
    turns: [
      t(
        1,
        "interviewer",
        "Here is the problem: return the indices of two numbers that add up to a target.",
      ),
      t(2, "candidate", "ok"),
      t(3, "interviewer", "What are your first thoughts?"),
      t(4, "candidate", "ok"),
    ],
  },
];
