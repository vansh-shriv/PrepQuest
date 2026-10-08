# 04. Features: Analytics, Progress Tracking, Personalized Planning

Covers **A1 to A5** and **P1 to P4**.

---

## A1. Dashboard [MVP]

### Purpose

One screen that answers: "How am I doing, and what should I do today?"

### Widgets

| Widget                  | Content                                                     | Pixel style                                 |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| **Today's quest board** | Daily goals (P2), due reviews (D6), next planned task (P1)  | Folder cards with checkboxes                |
| **Streak sunflower**    | Current streak, longest streak, activity calendar (heatmap) | Sunflower grows by stage with streak length |
| **Problems solved**     | Total, Easy/Medium/Hard split, last 30 days sparkline       | Stacked pixel bar                           |
| **Topic skill plants**  | Per-topic mastery stage (seed, sprout, bud, bloom)          | Plant sprite per topic                      |
| **Accuracy**            | Acceptance rate, first-try AC rate, avg attempts to AC      | Number + mini bar                           |
| **XP and level**        | Coins, level progress                                       | Coin sprite and loading bar                 |
| **Recent activity**     | Last submissions, interviews, quizzes                       | List with verdict chips                     |
| **Upcoming**            | Contests, placement date countdown                          | Pixel clock                                 |
| **Readiness**           | Headline readiness per target (A4)                          | Gauge                                       |
| **Next best action**    | One recommended step with a "Start" button                  | Highlighted card                            |

### Behavior

- Date range filter (7d, 30d, 90d, all time).
- Data loads from precomputed aggregates (cache) and refreshes after any activity via event-driven invalidation.
- Empty states are friendly (dino mascot: "Nothing here yet. Run your first quest!").
- Heatmap counts any meaningful activity (AC, quiz, interview), not only coding.

### XP rules (default, tunable in admin)

- Easy AC: 10, Medium AC: 25, Hard AC: 50, first-try bonus +20%, no-hint bonus +20%, hint penalty -10% per tier.
- Quiz: 1 per correct answer, test completion bonus.
- Interview completion: 40 base + up to 40 for score.
- Daily goal completion: 15; streak milestone bonuses at 7, 30, 100 days.
- Levels follow a gentle curve: `xp_needed(level) = 100 * level^1.4`.

### Acceptance criteria

- Dashboard renders in under 1.5 s with warm cache.
- All counts reconcile with raw tables in a nightly consistency check.
- Streak logic respects user timezone and has a configurable "grace day" (one freeze per week).

---

## A2. Weak-area detection and recommendations [MVP basic, P2 full]

### Purpose

Automatically identify what the user is bad at and recommend what to do next.

### Signals per topic and pattern

- First-try AC rate, average attempts, hint rate, time over expected, failure verdict mix (many TLE suggests complexity issues; many WA suggests edge-case issues), quiz accuracy, interview dimension scores, SRS lapses, recency (decay).

### Algorithm (v1)

For each topic `t`:

```
mastery(t) = weighted_avg(
  0.30 * solve_success(t),         # first-try AC, recency-weighted
  0.20 * speed_score(t),           # time vs expected
  0.15 * independence(t),          # 1 - hint rate
  0.15 * quiz_accuracy(t),
  0.10 * interview_score(t),       # from scorecards when topic appeared
  0.10 * retention(t)              # SRS success ratio
)
confidence(t) = min(1, evidence_count(t) / 8)
weakness(t) = (1 - mastery(t)) * importance(t, target) * (0.5 + 0.5 * confidence(t))
```

- `importance(t, target)` comes from the user's target company/role pack (e.g., Graphs high for product companies).
- Recency decay: half-life of 30 days for older evidence.
- Output: ranked weak topics, each with **diagnosis** ("You solve Graph problems but often TLE, review BFS vs DFS complexity and adjacency list use").

### Recommendations

- Next 3 problems chosen to be just above current mastery (difficulty ladder), covering distinct patterns.
- Suggest a quiz or flashcards when diagnosis is conceptual.
- Suggest a mock interview focused on a weak topic when mastery plateaus.

### Acceptance criteria

- Recommendations never repeat solved-clean problems unless in SRS.
- Weakness ranking is stable (not flipping wildly) after a single new submission (smoothing).
- Explainability: every recommendation shows "why".

---

## A3. Interview performance trends [P2]

### Behavior

- Timeline chart of overall score and each dimension across sessions, filterable by interview type, company, persona.
- **Moving average** and **best/worst** markers, with annotation when settings changed (persona/difficulty) so users don't misread drops.
- **Delta cards**: "Communication +0.8 over last 5 sessions".
- **Recurring issue tracker**: red flags recurring across sessions flagged as "habit" ("Skips edge cases in 4 of last 5 sessions").
- **Segment timing trends**: average time spent on clarify, approach, code, test.
- **Speech trends** (E4): filler rate and pace over time.
- Compare to **target bar**: dotted line for the target company's expected score band.

### Acceptance criteria

- Charts handle 1 to 200 sessions smoothly.
- Trends exclude "abandoned" sessions below 30% completion by default (toggle to include).

---

## A4. Readiness score per target company/role [P2]

### Purpose

A single honest number showing how ready the user is for a specific target, with a breakdown.

### Model

```
readiness(target) = 100 * Σ_c  w_c(target) * s_c
```

Components `c` and example weights for "Product SDE-1":

| Component                                                                | Source                            | Weight                       |
| ------------------------------------------------------------------------ | --------------------------------- | ---------------------------- |
| DSA breadth (coverage of required topics at required difficulty)         | A2 mastery weighted by importance | 30%                          |
| DSA speed and independence                                               | A5                                | 10%                          |
| Interview performance (coding rounds, last N sessions, recency weighted) | E1                                | 20%                          |
| Communication                                                            | E1/E4                             | 10%                          |
| CS fundamentals                                                          | C1 quiz mastery                   | 10%                          |
| Project/resume defense                                                   | project deep-dive scores          | 8%                           |
| Aptitude/OA readiness                                                    | C2                                | 5%                           |
| System design/LLD                                                        | C3/I1                             | 5% (higher for senior roles) |
| Consistency                                                              | streak, hours logged vs plan      | 2%                           |

- Weights are defined per target in the company pack and role.
- **Confidence band**: displays "72 ± 6" depending on evidence volume; low evidence shows "Not enough data" for the component instead of guessing.
- **Breakdown view**: what is limiting the score, with "highest-leverage actions" estimating the gain per action ("Solving 8 more graph mediums: about +4").
- **Time-to-ready estimate** based on current improvement rate and placement date; displayed as "At this pace: ready by Nov 20 (placement: Nov 15), step up".
- **History** of readiness snapshots (daily) to show growth.

### Acceptance criteria

- Readiness is deterministic given inputs (reproducible in tests).
- Users with no data see an onboarding "calibration" path (diagnostic test) rather than a fake score.

---

## A5. Time-per-problem analysis [P2]

### Behavior

- Records: time to first run, time to first AC, total active time (idle excluded), number of runs, time in "thinking" (no edits), and time in "debugging" (edit-run cycles).
- Compare against **benchmarks** by difficulty and by company style (e.g., Medium in 25 min, Hard in 40 min) and against the user's own rolling median.
- **Distribution chart**: histogram per difficulty, outlier detection.
- **Phase breakdown**: read, plan, code, debug as stacked bars (derived from events).
- **Slow-solve list** feeding SRS (D6).
- **Speed coaching**: "You spend 40% of time debugging; practice dry-running before coding".
- **Pace mode** during practice: optional timer with soft target.

### Acceptance criteria

- Idle detection threshold (default 90 s without keystroke or mouse) configurable.
- Time metrics are computed from events server-side, not just client timers.

---

## P1. Adaptive study plan [P2]

### Inputs

Placement/interview date, hours per day (per weekday), current level (diagnostic or inferred), target companies/roles, weak areas, strengths, preferred practice mix (problems, quizzes, mocks), rest days, upcoming exam constraints.

### Generation

1. **Backward planning** from the date: phases = _Foundations_, _Pattern Mastery_, _Company Focus_, _Mock Intensive_, _Final Polish_.
2. **Capacity model**: weekly minutes available times efficiency factor (starts 0.8, adapts).
3. **Task selection** by weakness and importance (A2), respecting prerequisite order (P3).
4. **Mix rules**: e.g., 60% coding, 15% CS fundamentals/quizzes, 10% aptitude, 10% mock interviews, 5% review (adjusts to target).
5. **Interleaving**: avoid blocking same topic for too long; schedule reviews (D6).
6. LLM is used for the **narrative and explanations**, while the scheduling itself is deterministic and testable.

### Adaptation

- Nightly job re-plans based on completed/missed tasks, new weak areas, new interview results, changed availability.
- **Missed day policy**: tasks roll forward with priority, plan compresses; if impossible, the plan says so and suggests dropping lower-value items (and shows which).
- **Manual edits**: user can move, swap, skip, or lock tasks; locked tasks are respected during re-plan.
- **Explanations**: every task has "why this, why now".
- **Calendar export** (ICS) [P3].

### Acceptance criteria

- Plan never schedules more than the user's available time per day.
- Re-plan preserves locked tasks and completed history.
- Plan changes are summarized ("3 tasks moved, 2 added") in a diff view.

---

## P2. Daily goals [P2]

### Behavior

- Default daily goal template: **2 problems, 1 CS quiz (10 questions) or aptitude drill, 5 SRS reviews**, plus **1 mock interview per week**; every item editable.
- Goal types: count-based, time-based, XP-based, streak-based.
- **Goal presets**: Light (30 min), Standard (90 min), Intense (3 hours), Weekend sprint.
- **Smart suggestions**: if the user consistently misses goals, suggest lowering; if exceeding, suggest raising.
- **Completion feedback**: pixel confetti, sunflower grows, coin reward.
- **Reminders**: in-app, email, optional browser push at a user-chosen time; quiet hours.
- Goals link to plan tasks: completing a plan task completes the matching goal.

### Acceptance criteria

- Goal progress updates in real time after relevant activity.
- Timezone changes do not break streaks or double count a day.

---

## P3. Topic roadmaps with prerequisites [P2]

### Behavior

- **Graph of topics** with prerequisites: Arrays, Strings, Hashing, Two Pointers, Sliding Window, Stack, Queue, Linked List, Binary Search, Recursion, Trees, BST, Heaps, Graphs (BFS/DFS), Topological Sort, Union Find, Greedy, Backtracking, DP (1D, 2D, knapsack, LIS, intervals, trees, bitmask), Tries, Segment Trees, Advanced Graphs.
- Each node: summary, learning resources (own content), recommended problems (ladder), checkpoint quiz, "unlocked" and "mastered" states from mastery (A2).
- **Pixel tree map**: world-map style path where each node is a level; locked nodes appear greyed; bosses = checkpoint problems.
- **Role-specific roadmaps**: SDE, ML (math, ML fundamentals, deep learning, MLOps basics), Embedded (C, RTOS, protocols, DSP-light), Full-stack (web, DB, system design basics).
- **Skip assessment**: user can test out of a node with a short checkpoint.
- Roadmaps feed the study plan generator.

### Acceptance criteria

- Prerequisite graph is a DAG (validated on admin save).
- Mastery thresholds for unlocking are configurable (default 60% to unlock next, 80% to master).

---

## P4. Company-specific prep tracks [P2]

### Behavior

- **Track pack per company** contains: interview process overview, round types with weights, topic frequency heatmap, curated problem list (sheet), OA template (C2), behavioral competencies, sample HLD/LLD prompts, preparation checklist, timeline template, and "common pitfalls".
- **Insights**: "Graphs and DP appear in 60% of recent reports" based on admin-curated tags and anonymized in-platform aggregates (never claims real inside information).
- **Track progress**: percent of curated list solved, rounds practiced, readiness score for that company (A4).
- **Compare tracks**: overlap analysis ("Preparing for A and B: 70% overlap, add these 12 problems for B").
- **Packs are community-extendable** by admins; each pack is versioned and shows "last reviewed" date.

### Acceptance criteria

- Starting a track creates a plan (P1) and a default interview configuration (I2).
- Overlap analysis matches manual set-intersection tests.
