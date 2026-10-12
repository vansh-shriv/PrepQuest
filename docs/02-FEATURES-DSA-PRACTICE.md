# 02. Features: DSA Practice, CS Fundamentals, Aptitude

Covers **D1 to D7**, **C1**, **C2**. Each feature has: purpose, user stories, detailed behavior, UI notes, data touched, acceptance criteria, edge cases, phase.

---

## D1. Problem bank with tags and curated sheets [MVP]

### Purpose

A browsable, filterable library of problems that supports both pattern-based learning and company-targeted practice.

### User stories

- As a learner, I want to filter problems by topic, difficulty, company, and pattern so I can practice exactly what I need.
- As a learner, I want curated sheets (Blind 75, NeetCode 150, company-wise lists) so I follow a proven path.
- As a learner, I want to see which problems I solved, attempted, or bookmarked at a glance.

### Detailed behavior

**Problem entity fields**: id, slug, title, statement (markdown with LaTeX and images), difficulty (Easy/Medium/Hard), constraints, examples (input, output, explanation), topics (Array, String, Hash Map, Two Pointers, Linked List, Stack, Queue, Heap, Tree, BST, Graph, DP, Greedy, Backtracking, Binary Search, Bit Manipulation, Math, Trie, Union Find, Sliding Window, Intervals, Sorting, Matrix, Design), patterns (Sliding Window, Fast/Slow Pointers, Monotonic Stack, Prefix Sum, DP on Trees, Knapsack, Topological Sort, Two Heaps, Binary Search on Answer, etc.), companies (with frequency weight and last-seen year), acceptance rate, estimated solve time, source/provenance, status (draft/review/published/archived), version.

**Filters**: topic (multi-select, AND/OR toggle), pattern, difficulty, company, status (unsolved/attempted/solved/bookmarked), sheet, acceptance range, estimated time, "not seen in last N days".

**Search**: full-text over title and statement, with typo tolerance (Postgres trigram + tsvector for MVP, optional Meilisearch later). Debounced, results in under 300 ms.

**Sorting**: default (curated order), difficulty, acceptance, frequency at selected company, recently added, recommended (weak-area aware, P2).

**Curated sheets**: ordered lists with sections (e.g. "Arrays and Hashing", "Two Pointers"). Each sheet shows progress bar as pixel loading bar (X of N solved). Sheets are versioned and admin-managed. Users may also create **personal sheets** (private lists) [P2].

**Problem list row**: status icon (empty square, half square, checked square, bookmark flag), title, difficulty chip, top topics, acceptance, company logos (pixel icons), and a "Play" (open) button.

**Problem page layout** (desktop): left pane has tabs (Description, Editorial, Submissions, Notes, Discussion later), right pane is editor and test panel. Panes are resizable and layout preference persists.

### Data touched

`problems`, `tags`, `problem_tags`, `companies`, `problem_companies`, `sheets`, `sheet_problems`, `user_problem_state`.

### Acceptance criteria

- Applying any filter combination returns correct results and updates the URL query string (shareable).
- Sheet progress equals count of distinct solved problems in the sheet for the user.
- Problem page loads statement and starter code in under 1 s from cache.
- Archived problems remain visible in history but disappear from lists.

### Edge cases

- A problem that appears in multiple sheets must count once per sheet, never twice overall.
- Statement images must not leak private storage URLs (signed, short-lived).
- Version bump on a problem must not erase old submissions; they reference the version they ran against.

---

## D2. Online code editor with multi-language support [MVP]

### Purpose

A fast, comfortable coding surface that mimics real interview and contest environments.

### Detailed behavior

- **Engine**: Monaco Editor (VS Code core).
- **Languages (MVP)**: C++17/20, Java 17, Python 3.11. [P2] JavaScript, Go, Rust, C.
- **Features**: syntax highlighting, bracket matching, auto-indent, auto-close brackets, snippets for common patterns (fast IO, DSU, segment tree skeleton), find/replace, multi-cursor, word wrap, minimap toggle, font size and ligatures toggle, tab size, vim/emacs keybindings (optional) [P2].
- **Starter code templates** per problem per language (class `Solution`, function signature, driver hidden).
- **Autosave**: draft code saved per user, problem, language every 2 s (debounced) to local storage and server. Switching language retains separate drafts.
- **Custom test panel**: add multiple custom inputs, each with label, run all, see stdout, stderr, runtime, memory.
- **Run vs Submit**:
  - **Run** executes against sample tests plus user custom tests, returns detailed per-test output, does not count as a submission.
  - **Submit** executes against all hidden tests, produces a recorded submission with verdict.
- **Reset to starter** with confirmation; previous draft is kept in a "restore" history of the last 5 versions.
- **Editor modes**: Practice (everything available), Interview (hints/editorial/autocomplete off, per I6/I8), Contest (copy of Interview plus focus tracking).
- **Intellisense**: basic keyword and local symbol completion on in Practice, disabled in Interview and Contest modes by default (user can opt in for Practice).
- **Fullscreen focus mode**: hides side panes; Escape exits.

### Data touched

`code_drafts`, `submissions`, `custom_tests`, `user_settings`.

### Acceptance criteria

- Typing latency stays under 16 ms per keystroke on 500-line files.
- Closing the tab and reopening restores the exact draft and cursor position.
- Custom tests persist per problem and can be re-run with one click.
- Interview and Contest modes disable completions and paste detection hooks are active (see X2).

### Edge cases

- Very large pasted input (over 256 KB) rejected with friendly message.
- Concurrent edits across two tabs: last write wins, with a "newer draft exists" prompt.

---

## D3. Sandboxed code execution and verdicts [MVP]

### Purpose

Correct, fast, safe evaluation of code with clear feedback. Full engineering design in doc 12.

### Detailed behavior

**Verdicts**: `AC` Accepted, `WA` Wrong Answer, `TLE` Time Limit Exceeded, `MLE` Memory Limit Exceeded, `RE` Runtime Error (with signal and stderr tail), `CE` Compilation Error (with compiler output), `OLE` Output Limit Exceeded, `IE` Internal Error (our fault, never counted against the user), `SKIPPED` after first failure in "stop on first fail" mode.

**Result display**:

- Overall verdict banner with pixel sparkle animation on AC and a soft "game over" shake for failures.
- Per-test table: test number, verdict, time, memory. Hidden test inputs are never shown; first failing hidden test shows only its index and category label ("edge: empty input", "stress: max N") if the admin supplied one.
- For sample/custom tests: input, expected, actual, diff view (character-level highlight).
- Runtime and memory percentile vs previous accepted submissions ("faster than 82%") [P2].

**Execution settings**: per-problem time limit (base times language multiplier), memory limit, output limit, max processes, max file size.

**Flow**: user clicks Submit, API validates and enqueues, UI shows loading bar with live stages: `QUEUED`, `COMPILING`, `RUNNING 3/12`, `DONE` (streamed over WebSocket or SSE).

**Idempotency**: duplicate submit within 2 s with identical code is rejected with "already running".

### Data touched

`submissions`, `submission_results`, `test_cases`, `languages`.

### Acceptance criteria

- Infinite loop is killed at limit with TLE and never blocks worker beyond limit + 1 s.
- Fork bomb is contained and returns RE or IE-with-contained flag, system remains stable.
- Memory over limit gives MLE rather than crashing the worker.
- Output compare handles trailing whitespace and newline normalization; special judges supported for multi-answer problems.
- IE results are retried automatically up to 2 times then flagged for admin.

### Edge cases

- Interactive and multi-file problems out of scope for v1.
- Floating-point checker with configurable epsilon for numeric problems.

---

## D4. Tiered hints [MVP basic, P2 AI-generated]

### Purpose

Support learning without spoiling it. Hints escalate; full solution is never the first thing shown.

### Detailed behavior

Three required tiers per problem, each unlocked only after the previous one:

1. **Nudge**: a question or observation about the structure ("What changes if the array is sorted?").
2. **Approach**: names the technique and key insight, no code.
3. **Pseudocode**: step-by-step outline, no language-specific code.

- A hint costs XP (small coin deduction display) and is logged; usage lowers the problem's "clean solve" status.
- A **cooldown** (e.g. 3 minutes after starting before hint 1, 5 minutes between tiers) discourages instant clicking. Configurable per user in settings ("strict mode").
- **AI hint mode** [P2]: user can ask a free-text question ("am I on the right track with a heap?"); the AI responds Socratically, refuses to produce full code, and its response is also tier-tagged. Guardrail prompts in doc 13.
- Editorial unlock is only available after hint 3 or after a configurable time or after an accepted solution.
- In Interview mode and Contest mode, hints are disabled entirely (interview AI may give hints in conversation per persona).

### Data touched

`hints`, `hint_usage`, `user_problem_state.hints_used`.

### Acceptance criteria

- Tier N+1 button is disabled until tier N has been viewed.
- Hint usage appears in submission history and in analytics (clean solves vs assisted solves).
- AI hint never contains a full working solution (checked by a post-filter plus eval set).

---

## D5. Editorial and solution viewer [MVP]

### Detailed behavior

- **Multiple approaches** per problem (brute force, better, optimal), each with: intuition, algorithm steps, diagrams (pixel-styled or Mermaid), code in all supported languages, complexity (time and space with justification), common pitfalls, follow-up variants.
- **Complexity analysis** explicitly written and cross-linked to the X4 empirical analyzer.
- **Related problems** and patterns.
- **Community solutions** [P3] with upvotes and moderation.
- **Visibility rules**: locked until user has an AC, or used all hints, or toggled "I give up" after a confirmation and cooldown. Locking can be disabled per user ("open editorials") in settings.
- **Compare with mine** [P2]: side-by-side of user's accepted code vs editorial approach with AI commentary (links to X3 code review mode).
- Each approach has an estimated "interview talk track": how to explain it out loud in 2 minutes.

### Acceptance criteria

- Editorials render math, code with tabs per language, and images.
- Unlock logic respects the rules above and is enforced server side, not just in UI.

---

## D6. Spaced repetition for problems [P2]

### Purpose

Make solved problems stick by resurfacing them when memory is likely to fade, prioritizing failures and slow solves.

### Detailed behavior

- Algorithm: modified **SM-2** per user per problem.
- Quality score (0 to 5) is derived automatically from: verdict history, number of attempts, time to AC vs expected time, hints used, and a post-solve self-rating (Easy/Good/Hard/Again).
  - AC first try, under target time, no hints, rated Easy: 5.
  - AC with hints or over 1.5x time: 3.
  - Failed or gave up: 1.
- Next review interval: 1 day, 3 days, then `interval * ease` (ease floor 1.3).
- **Review queue**: "Today's reviews" card on dashboard, capped by daily goal setting (default 5) to avoid overload; overflow carries over with priority by overdue time and weakness.
- **Review mode**: opens the problem with a short timer; success increases interval, failure resets.
- Bonus: pattern-level review ("do any problem using monotonic stack") when a user struggles with a pattern.
- Pause/snooze per problem; "never show again" option.

### Data touched

`srs_cards` (problem cards), `srs_reviews`.

### Acceptance criteria

- A failed review reduces interval to 1 day and ease by 0.2 (floor 1.3).
- Review queue never exceeds the configured cap per day.
- Time zone aware "due today" using the user's profile timezone.

---

## D7. Timed contests with leaderboard [P2]

### Detailed behavior

- **Types**: Weekly Mock Contest (public, 90 min, 4 problems), Company-style OA (60 to 120 min, 2 to 3 problems, plus MCQs optional), Custom private contest by invite code (peer groups, colleges).
- **Scoring**: ICPC-style (solved count then penalty) and score-based (points per problem with time decay) selectable per contest.
- **Registration**: opens ahead of time, reminders by email/in-app; late join allowed with remaining time.
- **During contest**: Contest editor mode (no hints, no editorials), countdown pinned top, live standings (frozen last 10 minutes optional), per-problem submission feedback (first failing test index only).
- **Integrity**: focus-loss tracking, paste tracking, similarity detection after contest (X2).
- **After contest**: editorials open, rating update (Elo-like) [P3], leaderboard permanent, shareable certificate-style report card.
- **Leaderboards**: global, per college/organization, per contest; Redis sorted sets for live standings.
- **Virtual contests**: replay past contests with your own timer.

### Data touched

`contests`, `contest_problems`, `contest_registrations`, `contest_submissions`, Redis `lb:{contest}`.

### Acceptance criteria

- Standings update within 2 s of a verdict.
- Penalty computation matches reference implementation on 20 recorded scenarios.
- Contest cannot be joined after end time; start time enforced server side.

---

## C1. CS fundamentals quizzes and SQL practice [P2]

### Quiz modules

Subjects: **OS** (processes, threads, scheduling, deadlocks, memory, paging, sync), **DBMS** (ER, normalization, transactions, ACID, indexing, concurrency control), **CN** (OSI/TCP-IP, TCP vs UDP, HTTP, DNS, routing, congestion), **OOP** (pillars, SOLID, design patterns, language specifics), **SQL**, **Embedded/ECE bridge** (interrupts, RTOS, memory-mapped IO, communication protocols) for hardware-leaning users, **ML basics** (bias-variance, regularization, metrics, optimization) for ML track.

### Behavior

- Question types: single choice, multi-select, true/false, fill in the blank, short explanation (AI-graded), code-output prediction.
- Modes: **Practice** (instant feedback with explanation), **Timed test** (N questions, M minutes, summary at end), **Topic drill**, **Weak-area quiz** (auto-built from past mistakes).
- Difficulty tags and topic tags per question, with explanations that include a "how to say this in an interview" one-liner.
- Results feed topic mastery (A2) and flashcards (X6): wrong answers can be pushed to a flashcard deck in one click.

### SQL practice editor

- In-browser editor with schema explorer and sample dataset preview.
- Executes on isolated, read-only per-session SQLite or PostgreSQL schema with row limit (1,000), statement timeout (3 s), and forbidden statements for non-SELECT problem types.
- Verdict compares result sets (order-sensitive or insensitive per problem) against expected output.
- Problem categories: SELECT/WHERE, JOINs, GROUP BY/HAVING, subqueries, window functions, CTEs, recursive CTEs, indexes and query plans (explain interpretation questions).

### Acceptance criteria

- Quiz attempt stores each answer with time taken.
- SQL execution cannot read other users' data or modify shared datasets.
- Result comparison handles column order and NULL equality rules as documented in doc 12.

---

## C2. Aptitude and OA-style sections [P2]

### Purpose

Many placement processes begin with online assessments (OAs) mixing aptitude, MCQs, and coding. Practice must mirror this.

### Behavior

- **Sections**: Quantitative (percentages, ratios, time-speed-distance, work, probability, permutations), Logical Reasoning (series, puzzles, seating, syllogisms), Verbal (reading comprehension, grammar, sentence correction), Data Interpretation, Pseudocode/Output MCQs, Technical MCQs (links to C1).
- **OA Simulator**: assembles a multi-section test with per-section timers, section locking (no going back), negative marking toggle, calculator availability toggle (per company style), and a final report with section-wise percentile.
- **Company OA templates**: e.g. "TCS NQT style", "Infosys style", "Amazon OA style (2 coding + work simulation style questions)", editable by admin.
- **Solution explanations** with shortcuts/tricks for speed.
- **Speed drills**: 20 questions in 10 minutes to build calculation speed.

### Acceptance criteria

- Section timers continue server side even if the browser is closed; resuming restores remaining time.
- Negative marking applied exactly as configured; report matches manual calculation on test scenarios.

---

## As built (Phase 5): D4 hints and D5 editorials

Three tiers (nudge, approach, pseudocode), cooldowns, XP penalty and the "clean solve" flag are implemented as specified, in strict and relaxed modes. Editorials unlock after solving, using all hints, the "open editorials" setting, or an explicit give-up after a wait. Approaches carry intuition, steps, complexity, pitfalls and code per language; a talk track and related problems are shown. Self-rating after a solve is stored. Rules are server-side (`packages/analytics-core/src/unlock.ts`); see doc 11 for the exact behavior. Not built: AI hints [P2], community solutions [P3], "compare with mine" [P2], Mermaid diagrams, hints disabled in interview and contest modes (those modes do not exist yet).

## As built (Phase 10): D6 spaced repetition and C1 quizzes

- **D6:** modified SM-2 as specified (1 day, 3 days, then interval x ease; a failure resets to 1 day and lowers the ease by 0.2, floor 1.3). Cards are created at the first accepted practice solve. Quality is derived from failed attempts, hints and time, plus the self-rating, or set with Again/Hard/Good/Easy; solving a due problem is graded automatically. The queue is capped (default 5, 1 to 30) and time-zone aware (local `due_on` dates). Pause, snooze and the week-ahead view are built. Not built: pattern-level reviews, review mode with its own timer, XP for reviews.
- **C1 quizzes:** single choice, multiple choice, true/false, fill-in-the-blank and code-output questions; practice, timed, topic drill and weak-area modes; explanations carry an "in an interview" line. Not built: AI-graded short explanations, quiz sets, push-to-flashcard (X6), the SQL practice editor and the embedded and ML subjects (the schema allows them).
- Acceptance: each answer stores its time; the answer key never reaches the browser during a timed test; the clock is server-side, so reopening the tab resumes the remaining time.
