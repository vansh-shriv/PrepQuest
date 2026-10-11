import type { LlmProvider, LlmRequest, LlmResult } from "./types.js";

// Deterministic stand-in for the model (`LLM_MODE=mock`, docs 19 §3): a scripted interviewer, a
// heuristic resume parser and a scorecard built from the transcript. It lets the whole product run
// (and be tested end to end) with no API key. It is NOT a quality benchmark for the real prompts.

const words = (s: string, n: number) => s.trim().split(/\s+/).slice(0, n).join(" ");
const approx = (s: string) => Math.max(1, Math.ceil(s.length / 4));

function lastUser(req: LlmRequest): string {
  return [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
}

/** The original task prompt: repair rounds append messages after it. */
function firstUser(req: LlmRequest): string {
  return req.messages[0]?.content ?? "";
}

function signal(text: string, key: string): string {
  return new RegExp(`${key}=([^,<]+)`).exec(text)?.[1]?.trim() ?? "";
}

const APPROACH_RE =
  /\b(approach|i('| woul)d|i will|we can|use a|hash ?map|sort|binary search|two pointers?|dp|dynamic|brute|bfs|dfs|stack|queue|heap|greedy|recurs)/i;
const HINT_RE = /\b(hint|stuck|nudge|clue|help me)\b/i;
const DONE_RE = /\b(done|finished|that's it|i'm happy|satisfied)\b/i;
const ABUSE_RE = /\b(idiot|stupid|moron|shut up)\b/i;
const ATTACK_RE =
  /(ignore (all |the |your )?(previous|prior|above)|reveal (the |your )?(solution|prompt|plan)|give me the (answer|solution)|show me the (answer|solution)|system prompt)/i;

function control(c: Record<string, unknown>): string {
  return `\n<control>${JSON.stringify({ hint_level: 0, topic_tags: [], flags: [], ...c })}</control>`;
}

function questionBlock(context: string, index: number): string {
  const blocks = context.split(/\nQUESTION /).slice(1);
  return blocks[index] ?? blocks[0] ?? "";
}

function interviewerReply(req: LlmRequest): string {
  const user = lastUser(req);
  const state = signal(user, "state");
  const hintsUsed = Number(signal(user, "hints_used") || 0);
  const q = Number(signal(user, "question").split("/")[0] ?? "1") - 1;
  const candidate =
    /<candidate_message>([\s\S]*?)<\/candidate_message>/.exec(user)?.[1]?.trim() ?? "";
  const event = /EVENT: (.*)/.exec(user)?.[1] ?? "";
  const regen = /no hint is available|revealed too much/.test(user);

  if (event.startsWith("The interview is starting")) {
    return `Hi, I'm Alex, thanks for joining today. To start, could you tell me a bit about yourself?${control({ intent: "followup" })}`;
  }
  if (event.startsWith("Present the current question")) {
    const block = questionBlock(req.context ?? "", q);
    const project = /\(project,/.test(block);
    if (project) {
      const text = /\): ([^\n]*)/.exec(block)?.[1] ?? "Tell me about your project.";
      return `Let's talk about your work. ${words(text, 60)}${control({ intent: "followup" })}`;
    }
    const title = /problem "([^"]+)"/.exec(block)?.[1] ?? "the problem";
    const body = /<problem>\n([\s\S]*?)\n<\/problem>/.exec(block)?.[1] ?? "";
    return `Here's the problem: ${title}. ${words(body.replace(/[#*`$]/g, ""), 70)} Feel free to ask me anything before you start.${control({ intent: "followup" })}`;
  }
  if (event.startsWith("Time to wrap up")) {
    return `We're nearly out of time. Thanks for the discussion. Do you have any questions for me?${control({ intent: "transition", next_state: "WRAPUP" })}`;
  }
  if (event.startsWith("The judge accepted")) {
    return `Nice, that passes. What are its time and space complexity?${control({ intent: "challenge" })}`;
  }
  if (event.startsWith("The candidate's last run did not pass")) {
    return `What does that failing case tell you?${control({ intent: "challenge" })}`;
  }
  if (event.startsWith("The candidate started writing code")) {
    return `Before you go further, could you walk me through your plan?${control({ intent: "prompt_approach" })}`;
  }
  if (event.startsWith("The code has nested loops")) {
    return `What is the time complexity of what you have so far?${control({ intent: "challenge" })}`;
  }
  if (event.startsWith("The candidate has been quiet")) {
    return `How is it going? What are you weighing right now?${control({ intent: "nudge" })}`;
  }
  if (event.startsWith("The candidate has been silent")) {
    return `Take your time. What are you thinking?${control({ intent: "nudge" })}`;
  }
  if (event) return `Let's keep moving.${control({ intent: "nudge" })}`;

  if (ABUSE_RE.test(candidate)) {
    return `Let's keep this professional, please. Shall we continue?${control({ intent: "warn", flags: ["abusive"] })}`;
  }
  if (ATTACK_RE.test(candidate)) {
    return `I can't share that. Let's focus on your own thinking: what's your first idea?${control({ intent: "redirect", flags: ["off_topic"] })}`;
  }
  if (/\bare you (an )?(ai|bot|human)\b/i.test(candidate)) {
    return `I'm an AI interviewer, yes. Shall we continue with the question?${control({ intent: "followup", flags: ["asked_if_ai"] })}`;
  }
  const asksHint = HINT_RE.test(candidate);
  if (asksHint && !regen) {
    // a deliberately eager mock: it hints even without budget, so the engine's clamp is exercised
    const level = Math.min(3, hintsUsed + 1);
    const text = [
      "What do you need to look up quickly while scanning the input once?",
      "Consider a data structure that gives constant-time membership checks.",
      "Outline: remember what you've seen, and for each element check whether its complement is remembered.",
    ][level - 1];
    return `${text}${control({ intent: "hint", hint_level: level, flags: ["asked_for_hint"] })}`;
  }
  if (asksHint && regen) {
    return `Let's think it through together: what is the slowest part of your current plan?${control({ intent: "followup", flags: ["asked_for_hint"] })}`;
  }

  switch (state) {
    case "WARMUP":
      return `Nice to meet you. Let's get started with the first question.${control({ intent: "transition", next_state: "PROBLEM" })}`;
    case "CLARIFY":
      if (APPROACH_RE.test(candidate)) {
        return `Okay. What would the time complexity of that be?${control({ intent: "prompt_approach", flags: ["approach_stated"], next_state: "APPROACH" })}`;
      }
      return `Good question. Assume the input is valid and fits in memory. Anything else?${control({ intent: "clarify_answer" })}`;
    case "APPROACH":
      if (APPROACH_RE.test(candidate)) {
        return `Sounds reasonable. Go ahead and write the code.${control({ intent: "transition", flags: ["approach_stated"], next_state: "CODING" })}`;
      }
      return `Can you walk me through your plan before coding?${control({ intent: "prompt_approach" })}`;
    case "CODING":
      if (DONE_RE.test(candidate)) {
        return `Great, please run it against the samples.${control({ intent: "transition", flags: ["candidate_done"], next_state: "TESTING" })}`;
      }
      return `Keep going. How does it behave on an empty input?${control({ intent: "followup" })}`;
    case "TESTING":
      return `What other cases would you test?${control({ intent: "challenge", flags: DONE_RE.test(candidate) ? ["candidate_done"] : [] })}`;
    case "OPTIMIZE":
      return `Can you reduce the space or time cost further? Walk me through the trade-off.${control({ intent: "challenge", next_state: q === 0 ? "PROBLEM" : "WRAPUP" })}`;
    case "FOLLOWUP": {
      const prompts = [
        "Why did you choose that approach over the alternatives?",
        "What was the hardest failure you hit, and how did you debug it?",
        "How would this change if traffic grew tenfold?",
        "How did you measure that result?",
      ];
      const pick = prompts[(candidate.length + q) % prompts.length] ?? prompts[0];
      return `${pick}${control({ intent: "challenge", flags: candidate.split(/\s+/).length < 8 ? ["candidate_vague"] : [], next_state: "FOLLOWUP" })}`;
    }
    case "WRAPUP":
      return `Thanks, that was a good conversation. You'll see your results shortly.${control({ intent: "close", next_state: "ENDING" })}`;
    default:
      return `Understood. Please continue.${control({ intent: "followup" })}`;
  }
}

// --- structured tasks -----------------------------------------------------------------------

const HEADINGS: [RegExp, string][] = [
  [/^(education|academics)\b/i, "education"],
  [/^(work |professional )?experience\b|^employment\b/i, "experience"],
  [/^(personal |academic )?projects?\b/i, "projects"],
  [/^(technical )?skills\b/i, "skills"],
  [/^(achievements|awards|accomplishments|certifications)\b/i, "achievements"],
];
const METRIC_RE = /\d+(?:\.\d+)?\s?(?:%|x\b|ms\b|k\b|m\b|\+|users|requests|rps|qps)/i;

function parseResume(text: string) {
  const sections: Record<string, string[]> = {};
  let current = "header";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = HEADINGS.find(([re]) => re.test(line) && line.length < 40);
    if (heading) {
      current = heading[1];
      continue;
    }
    (sections[current] ??= []).push(line);
  }
  const isBullet = (l: string) => /^[-•*▪]/.test(l);
  const strip = (l: string) => l.replace(/^[-•*▪]\s*/, "");
  const techOf = (l: string) =>
    /(?:tech|stack|built with|using)[:\s]+(.+)/i
      .exec(l)?.[1]
      ?.split(/[,;/]/)
      .map((t) => t.trim())
      .filter(Boolean) ?? [];

  const group = (lines: string[]) => {
    const groups: { title: string; bullets: string[] }[] = [];
    for (const l of lines) {
      if (isBullet(l) && groups.length > 0) groups[groups.length - 1]?.bullets.push(strip(l));
      else groups.push({ title: l, bullets: [] });
    }
    return groups;
  };
  const projects = group(sections.projects ?? []).map((g) => ({
    name: g.title.split(/[|–-]/)[0]?.trim().slice(0, 100) || g.title.slice(0, 100),
    summary: g.bullets[0] ?? "",
    tech: g.bullets.flatMap(techOf).concat(techOf(g.title)).slice(0, 12),
    bullets: g.bullets,
    metrics: g.bullets.flatMap((b) => b.match(METRIC_RE) ?? []).slice(0, 5),
  }));
  const experience = group(sections.experience ?? []).map((g) => {
    const [company, role] = g.title.split(/[|,–-]/).map((s) => s.trim());
    return {
      company: company ?? g.title,
      role: role ?? null,
      start: null,
      end: null,
      bullets: g.bullets,
      tech: g.bullets.flatMap(techOf),
    };
  });
  const skillText = (sections.skills ?? []).join(", ").replace(/^[^:]*:/gm, "");
  const skillList = skillText
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
  const claims = [...projects, ...experience]
    .flatMap((x) =>
      x.bullets.map((b) => ({
        text: b,
        section: "name" in x ? "projects" : "experience",
        metric: b.match(METRIC_RE)?.[0] ?? null,
      })),
    )
    .filter((c) => c.metric)
    .slice(0, 20);
  return {
    education: (sections.education ?? []).slice(0, 3).map((l) => ({
      institution: l.slice(0, 120),
      degree: null,
      field: null,
      start: null,
      end: null,
      gpa: null,
    })),
    experience,
    projects,
    skills: { languages: skillList, frameworks: [], tools: [], domains: [] },
    achievements: (sections.achievements ?? []).map(strip).slice(0, 10),
    claims,
  };
}

function qgen(req: LlmRequest) {
  const user = firstUser(req);
  const count = Number(/Produce (\d+)/.exec(user)?.[1] ?? 3);
  const refs = [...user.matchAll(/^((?:projects|experience)\[\d+\]): (.+)$/gm)];
  const templates = [
    (n: string) =>
      `Why did you choose your approach in ${n} over the alternatives, and what trade-offs did you accept?`,
    (n: string) =>
      `What was the hardest failure you hit in ${n}, and how did you find the root cause?`,
    (n: string) => `How would ${n} behave if the load grew tenfold, and what would break first?`,
    (n: string) => `How exactly did you measure the results you claim for ${n}?`,
  ];
  const picks = refs.length > 0 ? refs : [["", "projects[0]", "your main project"]];
  return {
    questions: Array.from({ length: count }, (_, i) => {
      const r = picks[i % picks.length] as RegExpMatchArray | string[];
      const name = r[2] ?? "your project";
      return {
        id: `q${i + 1}`,
        question: templates[i % templates.length]!(name),
        source_ref: r[1] ?? "projects[0]",
        followups: [
          "What would you do differently now?",
          "Who else was involved and what was your part?",
        ],
        rubric_points: [
          "states a concrete decision",
          "names alternatives",
          "gives evidence or numbers",
        ],
        difficulty: Math.min(5, 2 + (i % 3)),
      };
    }),
  };
}

function jd(req: LlmRequest) {
  const user = firstUser(req);
  const text = /<jd_data>\n([\s\S]*?)\n<\/jd_data>/.exec(user)?.[1] ?? "";
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  const required = lines.filter((l) => l.length < 120).slice(0, 8);
  const resume = /<resume_data>\n([\s\S]*?)\n<\/resume_data>/.exec(user)?.[1] ?? "";
  const matched = required.filter((r) =>
    resume.toLowerCase().includes(r.toLowerCase().split(" ")[0] ?? "~"),
  );
  return {
    analysis: {
      required,
      nice_to_have: [],
      responsibilities: lines.slice(0, 4),
      seniority: "",
      keywords: required.map((r) => r.split(" ")[0] ?? r).slice(0, 10),
    },
    gap: { matched, missing: required.filter((r) => !matched.includes(r)), weak_evidence: [] },
  };
}

interface Line {
  seq: number;
  speaker: string;
  text: string;
}
function transcriptLines(prompt: string): Line[] {
  const body = /<transcript>\n([\s\S]*?)\n<\/transcript>/.exec(prompt)?.[1] ?? "";
  return [...body.matchAll(/^\[(\d+)\] \d\d:\d\d (Interviewer|Candidate): (.*)$/gm)].map((m) => ({
    seq: Number(m[1]),
    speaker: m[2] ?? "",
    text: m[3] ?? "",
  }));
}

function scorecard(req: LlmRequest) {
  const user = firstUser(req);
  const lines = transcriptLines(user);
  const cand = lines.filter((l) => l.speaker === "Candidate" && l.text.split(/\s+/).length >= 3);
  const dims = [...user.matchAll(/^- (\w+) \(/gm)].map((m) => m[1] as string);
  const text = cand
    .map((c) => c.text)
    .join(" ")
    .toLowerCase();
  const quoteOf = (l: Line) => ({ type: "turn" as const, ref: l.seq, quote: words(l.text, 12) });
  const longest = [...cand].sort((a, b) => b.text.length - a.text.length);
  const signals: Record<string, boolean> = {
    optimization: /complexity|o\(|log n|linear|space/.test(text),
    testing: /test|edge|empty|dry.?run/.test(text),
    edge_cases: /edge|empty|null|duplicate|negative|boundary/.test(text),
    communication: cand.length >= 4,
    technical_depth: /because|latency|throughput|index|cache|queue/.test(text),
    decisions: /instead of|alternative|trade.?off|chose|because/.test(text),
    impact: /\d/.test(text),
    scalability: /scale|load|shard|replica|traffic/.test(text),
  };
  const scores = dims.map((d, i) => {
    const e = longest[i % Math.max(1, longest.length)];
    if (!e)
      return {
        dimension: d,
        score: null,
        justification: "Insufficient evidence in the transcript.",
        evidence: [],
      };
    return {
      dimension: d,
      score: signals[d] ? 4 : 3,
      justification: signals[d]
        ? "Showed this clearly in the discussion."
        : "Met the basics; little beyond that was shown.",
      evidence: [quoteOf(e)],
    };
  });
  const strengthSrc = longest.slice(0, 3);
  return {
    scores,
    strengths: strengthSrc.map((l) => ({
      text: "Gave a substantive, specific answer.",
      evidence: [quoteOf(l)],
    })),
    red_flags:
      signals.testing === false && longest[0]
        ? [
            {
              category: "process",
              severity: "medium",
              text: "Little discussion of testing or edge cases.",
              evidence: [quoteOf(longest[0])],
              remedy: "Walk through two or three targeted tests before declaring done.",
            },
          ]
        : [],
    next_actions: [
      {
        kind: "topic",
        ref: "complexity-analysis",
        title: "Practise stating time and space complexity",
        why: "Make the analysis part of every answer.",
      },
      {
        kind: "problem",
        ref: "two-sum",
        title: "Re-solve a hash map problem aloud",
        why: "Rehearse thinking aloud.",
      },
      {
        kind: "mock",
        ref: "dsa",
        title: "Take another mock interview",
        why: "Check progress on the same rubric.",
      },
    ],
    summary:
      cand.length === 0
        ? "There was too little candidate speech to evaluate."
        : `The candidate engaged in ${cand.length} substantive answers. Strengths were specific explanations; the main gap was proactive testing and edge-case discussion.`,
  };
}

function annotations(req: LlmRequest) {
  const lines = transcriptLines(firstUser(req)).filter((l) => l.speaker === "Candidate");
  const kinds = ["positive", "improve", "missed"] as const;
  return {
    annotations: lines.slice(0, 12).map((l, i) => ({
      turn_seq: l.seq,
      kind: kinds[i % 3],
      dimension: null,
      text:
        i % 3 === 0
          ? "Clear, specific answer."
          : i % 3 === 1
            ? "Add the complexity and a concrete example here."
            : "A chance to ask a clarifying question was missed.",
      severity: i % 3 === 0 ? null : "low",
    })),
  };
}

export class MockProvider implements LlmProvider {
  /** Test hook: replaces the reply for the next call(s) of a task. */
  readonly overrides = new Map<string, string[]>();
  readonly calls: LlmRequest[] = [];

  async generate(
    req: LlmRequest,
    model: string,
    opts: { onDelta?: (delta: string) => void },
  ): Promise<LlmResult> {
    this.calls.push(req);
    const queued = this.overrides.get(req.task)?.shift();
    let text: string;
    if (queued !== undefined) text = queued;
    else if (req.task === "interviewer_turn") text = interviewerReply(req);
    else if (req.task === "resume_parse")
      text = JSON.stringify(
        parseResume(/<resume_text>\n([\s\S]*?)\n<\/resume_text>/.exec(firstUser(req))?.[1] ?? ""),
      );
    else if (req.task === "reaction") text = JSON.stringify({ speak: true, reason: "mock" });
    else if (req.task === "qgen") text = JSON.stringify(qgen(req));
    else if (req.task === "jd_analysis") text = JSON.stringify(jd(req));
    else if (req.task === "scorecard") text = JSON.stringify(scorecard(req));
    else if (req.task === "annotations") text = JSON.stringify(annotations(req));
    else text = words(lastUser(req).replace(/<[^>]+>/g, " "), 120);
    if (opts.onDelta) {
      for (let i = 0; i < text.length; i += 12) opts.onDelta(text.slice(i, i + 12));
    }
    return {
      text,
      model,
      refused: false,
      usage: {
        inputTokens: approx(
          req.system + (req.context ?? "") + req.messages.map((m) => m.content).join(""),
        ),
        outputTokens: approx(text),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}
