# 06. User Flows and Screens

Wireframes are ASCII for portability. Visual styling follows doc 07. Every screen lists: route, purpose, main elements, states, and linked features.

---

## 1. Screen inventory

| #   | Screen                                   | Route                       | Features               |
| --- | ---------------------------------------- | --------------------------- | ---------------------- |
| 1   | Landing                                  | `/`                         | Marketing, demo        |
| 2   | Sign up / Login                          | `/auth/*`                   | U1                     |
| 3   | Onboarding wizard                        | `/onboarding`               | U1, P1, A4             |
| 4   | Dashboard                                | `/dashboard`                | A1, A2, A4, D6, P2     |
| 5   | Problem list                             | `/problems`                 | D1                     |
| 6   | Sheets list / sheet detail               | `/sheets`, `/sheets/:slug`  | D1                     |
| 7   | Problem page                             | `/problems/:slug`           | D2, D3, D4, D5, U2, U3 |
| 8   | Submission detail                        | `/submissions/:id`          | U2, X3, X4             |
| 9   | Interview setup                          | `/interview/new`            | I1, I2, I3, I7         |
| 10  | Resume and JD manager                    | `/profile/resumes`          | I3                     |
| 11  | Interview room                           | `/interview/:id`            | I4 to I8               |
| 12  | Interview review                         | `/interview/:id/review`     | E1 to E5               |
| 13  | Interview history                        | `/interview`                | A3                     |
| 14  | Quizzes hub / quiz runner                | `/quizzes`, `/quizzes/:id`  | C1                     |
| 15  | SQL practice                             | `/sql/:slug`                | C1                     |
| 16  | Aptitude / OA simulator                  | `/oa`, `/oa/:id`            | C2                     |
| 17  | System design workspace                  | `/design/:id`               | C3                     |
| 18  | Study plan                               | `/plan`                     | P1, P2                 |
| 19  | Roadmaps                                 | `/roadmaps/:slug`           | P3                     |
| 20  | Company tracks                           | `/tracks/:company`          | P4                     |
| 21  | Analytics                                | `/analytics`                | A1 to A5               |
| 22  | Contests list / contest room / standings | `/contests/*`               | D7                     |
| 23  | Flashcards                               | `/flashcards`               | X6                     |
| 24  | Notes hub                                | `/notes`                    | U3                     |
| 25  | Peer interview lobby / room              | `/peer/*`                   | X1                     |
| 26  | Profile and settings                     | `/settings/*`, `/u/:handle` | U1, U4                 |
| 27  | Shared report                            | `/r/:token`                 | U5                     |
| 28  | Admin                                    | `/admin/*`                  | X7                     |
| 29  | 404, offline, error                      | system                      |                        |

---

## 2. Core user flows

### Flow A: First-time user to first practice

```
Landing -> Sign up (email/OAuth) -> Verify email
  -> Onboarding: pick track -> target company/role -> placement date
     -> hours per day -> upload resume (optional) -> diagnostic (15 min, 5 questions)
  -> Readiness baseline + generated plan
  -> Dashboard ("Your first quest: Two Sum Variants")
  -> Problem page -> code -> Run -> Submit -> AC (sparkles, +XP)
  -> Suggest "Try a quick 15-minute mock" -> Interview setup
```

### Flow B: Daily practice loop

```
Dashboard (today's quest board)
  -> Review due SRS cards (D6) -> Solve planned problems (P1)
  -> Quiz drill (C1)  -> Goal complete (P2) -> sunflower grows
```

### Flow C: Solving a problem

```
Problem list/filter -> Problem page
  -> Read -> (optional) tier-1 hint -> write code -> Run (samples + custom)
  -> Fix -> Submit -> Verdict
     AC: sparkles -> self-rating (Easy/Good/Hard/Again) -> unlock editorial
         -> optional "Review my code" (X3) -> optional complexity check (X4)
     Fail: failing-test info -> hint ladder -> retry
  -> Time/attempt stats feed A5, D6
```

### Flow D: Mock interview (coding)

```
Dashboard "Boss fight" or /interview/new
  -> Choose type (I1) -> target role/company (I2) -> resume/JD (I3)
  -> persona + difficulty (I7) -> mode (text/voice) (I5)
  -> Plan preview (segments, topics) -> Mic/tech check
  -> Start: Interview room (timer I8, chat, editor, notes)
  -> Intro -> Problem -> Clarify -> Approach -> Code (AI watches I6) -> Test -> Optimize
  -> Wrap-up -> End (or timer)
  -> "Scorecard generating..." loading bar -> Review (E1 to E5)
  -> Next actions -> add to plan / flashcards
```

### Flow E: Reviewing feedback

```
Interview review: scorecard summary -> dimension drill-down -> transcript timeline (E2)
  -> click annotation -> jumps to moment -> add note / make flashcard
  -> ideal answer comparison (E3) -> "Practice again"
  -> share report (U5) with privacy options
```

### Flow F: Contest

```
Contests list -> Register -> (reminder) -> Contest room opens
  -> Contest editor mode with countdown -> submit problems -> live standings
  -> End -> final standings -> editorials open -> integrity review (admin) -> rating
```

### Flow G: Peer mock

```
Peer lobby -> set availability -> match/invite link -> schedule (ICS)
  -> Room: audio + shared editor + timer -> swap roles -> feedback form
  -> AI-assisted report (with consent) -> reputation update
```

### Flow H: Admin publishes a problem

```
Admin -> New problem -> statement/constraints/tags -> starter code
  -> test cases (upload or generator) -> reference solution -> validate
  -> mutation check -> hints (3 tiers) -> editorial -> review -> publish
```

---

## 3. Wireframes

### 3.1 Dashboard

```
+----------------------------------------------------------------------------+
| [PQ]  [MENU]  ( search: pixelated...        )     (coin) 1,240  (flower)12 |
+------+---------------------------------------------------------------------+
| home |  TODAY'S QUESTS                          READINESS: AMAZON SDE-1     |
| prac |  [ ] Solve: Sliding Window x2            [#######----] 62 +-6        |
| intv |  [ ] Review: 5 cards due                 limits: Graphs, DP          |
| quiz |  [ ] CS Quiz: OS (10 Qs)                 NEXT BEST ACTION            |
| plan |  [ ] Mock: Project deep-dive (Fri)       [ Start: Graph BFS ladder ] |
| stat |-----------------------------------------------------------------------
| cont |  STREAK            SOLVED               SKILL PLANTS                 |
| note |  (sunflower) 12d   142 (E60 M70 H12)    Arr[***] Str[**] Gra[*] DP[ ] |
| card |  [heatmap ........]  [pixel bar chart]   ...                        |
+------+---------------------------------------------------------------------+
| RECENT: AC Two Sum | WA Graph Valid Tree | Mock #7: 71/100 | Quiz OS 8/10  |
+----------------------------------------------------------------------------+
```

States: loading (stage bar), empty (dino), error (retry), offline (dino game).

### 3.2 Problem list

```
+--------------------------------------------------------------------------+
| ( search problems )  [Topic v][Difficulty v][Company v][Status v][Sheet v] |
+--------------------------------------------------------------------------+
| Sheets: [folder Blind75 34/75] [folder NeetCode150 51/150] [folder Amazon] |
+--------------------------------------------------------------------------+
| St | Title                      | Diff | Topics          | Acc  | Cos |    |
| [x]| Two Sum                    | E    | Array, Hash     | 52%  | A G | >  |
| [~]| Longest Substring ...      | M    | String, Window  | 34%  | A M | >  |
| [ ]| Course Schedule            | M    | Graph, Topo     | 46%  | A G | >  |
+--------------------------------------------------------------------------+
```

### 3.3 Problem page (desktop)

```
+---------------------------+-----------------------------------------------+
| Desc | Editorial | Subs | Notes | solution.cpp  [C++ v] [Reset] [Focus]   |
|---------------------------|  1  class Solution {                          |
| Title            [E] [bm] |  2    public:                                 |
| Statement ...             |  3     ...                                    |
| Examples                  |                                               |
| Constraints               |-----------------------------------------------|
| Hints: [1] [2*] [3*]      | Testcases | Custom | Result                   |
|                           | [Run]  [Submit]   LOADING [###---] RUNNING 3/12|
+---------------------------+-----------------------------------------------+
```

(*) locked until previous tier viewed.

### 3.4 Interview setup

```
+--------------------------------------------------------------------------+
| NEW BOSS FIGHT                                                            |
| 1. TYPE        (o) DSA  ( ) CS Fundamentals ( ) Project ( ) HR ( ) HLD ... |
| 2. TARGET      Role [SDE v]   Company [Amazon v]   Level [SDE-1 v]         |
| 3. CONTEXT     Resume [Vansh_v3.pdf v]   JD [paste/upload]                  |
| 4. PERSONA     [Mentor][Neutral][Strict][Rapid-fire]   Difficulty [###--]  |
| 5. MODE        (o) Text ( ) Voice     Timer: 45m   Realistic mode [x]       |
| PLAN PREVIEW:  Intro 5 | Problem A 20 | Follow-up 15 | Q&A 5                |
|                                         [ START BOSS FIGHT ]               |
+--------------------------------------------------------------------------+
```

### 3.5 Interview room

```
+--------------------------------------------------------------------------+
| BOSS FIGHT  [Segment: Problem A]    TIMER 31:42      [Pause] [End]          |
+---------------------+----------------------------------------------------+
|  (pixel interviewer)|  PROBLEM CARD (collapsible)                         |
|   o_o  speaking...  +----------------------------------------------------+
|                     |  solution.py                          [Run] [Submit]|
| CHAT                |  def solve(...):                                    |
| AI: Walk me through |      ...                                            |
| You: I'd use a heap |----------------------------------------------------|
| [type or hold SPACE]| Notes (private)      Output / tests                 |
| [mic ||||    ]      |                                                     |
+---------------------+----------------------------------------------------+
```

Voice: captions strip, mic meter, barge-in indicator. Reconnect banner if socket drops.

### 3.6 Interview review (scorecard + transcript)

```
+--------------------------------------------------------------------------+
| RESULTS ARE IN!   Overall 71/100   Band: BORDERLINE -> READY               |
|  Radar: [Problem solving 4][Code 3][Comm 3][Optimize 4][Edge 2][Test 3]    |
|  Strengths: ...    Red flags: ...    Next actions: [Add to plan] [Practice]|
+--------------------------------------------------------------------------+
| TIMELINE  [0:00 intro][0:05 problem][0:12 code][0:28 optimize][0:40 wrap]  |
|  0:07:12  (!) Started coding before confirming constraints  [jump][note]    |
|  0:21:40  (+) Caught empty-array case                         [jump][card]  |
| Transcript / Code replay (scrubber)  |  Ideal answer comparison (E3)        |
+--------------------------------------------------------------------------+
```

### 3.7 Study plan

```
+--------------------------------------------------------------------------+
| PLAN: Nov 15 placement   Phase: Pattern Mastery (week 3/6)   [Re-plan]     |
| Mon  [Graphs BFS x2 ][Quiz OS][Review 5]       2h                          |
| Tue  [Graphs DFS x2 ][Aptitude drill]          1h30                        |
| Wed  [Mock: Coding   ][Review 5]               2h                          |
| why this? -> Graphs weakness 0.64, importance high for target               |
| Changes since last plan: 3 moved, 2 added  [view diff]                      |
+--------------------------------------------------------------------------+
```

### 3.8 Analytics

Tabs: Overview, Topics (plants + heatmap), Interviews (trend), Time (A5), Readiness (A4), Speech (E4).

### 3.9 Flashcards

Deck folders, review screen with big card, flip animation (stepped), buttons Again/Hard/Good/Easy, offline badge, due counter.

### 3.10 Admin problem editor

Split editor: markdown + live preview, tabs (Meta, Tests, Checker, Hints, Editorial, Versions), validation checklist panel (green/red pixel checks).

---

## 4. States every screen must handle

| State             | Pattern                                          |
| ----------------- | ------------------------------------------------ |
| Loading           | Pixel loading bar (determinate if known)         |
| Empty             | Dino + one-line prompt + primary action          |
| Error             | Pixel bug icon + message + retry + error ID      |
| Offline           | Dino mini-game page; queued actions saved        |
| Permission denied | Locked folder icon + explanation                 |
| Rate limited      | Hourglass + countdown                            |
| Long operation    | Notification when done (in-app + optional email) |

## 5. Navigation rules

- Max 2 clicks to start any core activity from dashboard.
- Command palette (`Ctrl/Cmd+K`) can jump to any problem, interview, setting, or action.
- Deep links everywhere (filters in URL, interview moments, shared reports).
- Leaving an active interview or contest asks for confirmation; session can always be resumed.

## 6. Notifications

In-app bell + optional email/push: contest reminders, SRS due, goal reminders, scorecard ready, plan updated, peer match, report viewed (U5), admin integrity decision.

Phase 16 note: the system design workspace is at `/system-design/:id` (the list at `/system-design`), because `/design` is the UI showcase page.
