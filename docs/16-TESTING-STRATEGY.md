# 16. Testing Strategy

Quality bar: judge and scoring logic are trusted by users making career decisions, so correctness testing is heaviest there.

## 1. Pyramid and targets

| Level             | Tooling                                                      | Scope                                                | Target                                                |
| ----------------- | ------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------- |
| Unit              | Vitest                                                       | Pure logic in `*-core` packages, utils, reducers     | ≥ 90% for judge-core, analytics-core; ≥ 70% elsewhere |
| Component         | Testing Library + Storybook interaction tests                | Pixel UI components, a11y                            | All primitives                                        |
| Integration       | Vitest + Supertest + Testcontainers (Postgres, Redis, S3-compatible store) | API modules with real DB, queues                     | Every endpoint happy + auth + validation paths        |
| Judge sandbox     | Custom harness on privileged runner                          | Languages, limits, malicious suite                   | 100% of suite passes                                  |
| Contract          | OpenAPI/Zod schema diff, WS event schema tests               | Web ⟷ API ⟷ workers                                  | No breaking changes unflagged                         |
| E2E               | Playwright                                                   | Core journeys in 3 themes, desktop + mobile viewport | All P0 flows                                          |
| Visual regression | Playwright screenshots                                       | Components per theme                                 | No unexpected diffs                                   |
| Accessibility     | axe-core in e2e + manual screen reader pass                  | All primary screens                                  | 0 critical/serious                                    |
| Load/perf         | k6                                                           | Submit, WS interview, dashboard, problem list        | See section 7                                         |
| Security          | CodeQL, Semgrep, ZAP, custom authz matrix                    |                                                      | Doc 14                                                |
| AI evaluation     | Custom eval runner                                           | Interviewer, scorecard, guardrails                   | Section 6                                             |

## 2. Unit test focus areas

| Module                  | Cases                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Verdict aggregation     | Priority order, SKIPPED handling, IE retry logic                                         |
| Checkers                | Whitespace normalization, float epsilon, unordered, special checker contract             |
| SRS (SM-2 variant)      | Interval growth, lapses, ease floor, timezone due date, cap overflow                     |
| XP/level                | Bonus stacking, hint penalties, curve                                                    |
| Streak                  | Timezone edge cases, grace/freeze, DST transitions, midnight boundaries                  |
| Mastery and weakness    | Recency decay, confidence smoothing, stability after single submission                   |
| Readiness               | Determinism, missing-component handling, weights summing to 1, confidence bands          |
| Planner                 | Capacity respect, prerequisite order, locked tasks, missed-day compression, re-plan diff |
| Roadmap DAG validation  | Cycles rejected, unlock thresholds                                                       |
| Scoring aggregation     | Weighted overall, band mapping, null dimension reweighting                               |
| Contest scoring         | ICPC penalty, points with decay, freeze behavior (20 recorded scenarios)                 |
| Complexity fitter       | 30 synthetic datasets with known growth, noise tolerance                                 |
| Filler/WPM/pauses       | Labeled transcripts                                                                      |
| Plagiarism fingerprints | Identical, renamed variables, reordered statements, unrelated solutions                  |
| Markdown sanitizer      | XSS vectors corpus                                                                       |
| Rate limiter            | Burst, window rollover, per-user fairness                                                |

Property-based tests (fast-check): checker normalization idempotence, SM-2 invariants (ease ≥ 1.3, interval monotonic on success), planner never exceeds daily capacity.

## 3. Integration tests (API)

- Auth flows incl. refresh rotation and reuse detection, OAuth callbacks mocked.
- AuthZ matrix: for every route × {anonymous, other user, owner, admin} expected status.
- Problems filters and pagination; hint tier ordering and cooldown; editorial unlock rules.
- Submission lifecycle with a fake judge worker (and with real worker in sandbox job): QUEUED → RUNNING → AC/WA, idempotency, rate limits.
- Contest window enforcement, standings updates.
- Interview lifecycle with **mock LLM** (deterministic scripted responses): state transitions, timer expiry, hint budget clamp, reconnect replay.
- Resume pipeline with fixture PDFs/DOCX (20 resumes: single/multi column, scanned-with-text, tables, non-English names).
- Sharing: privacy filters, revocation, expiry, OG image.
- Flashcards offline sync idempotency (duplicate `clientId`).
- Account deletion: cascades including vectors and object storage keys.

## 4. Judge test suite (privileged runner)

### 4.1 Functional

For each language: hello world, read stdin large input (10 MB), recursion depth, deep stack (Java `-Xss`), unicode I/O, exit codes, multiple test cases, compile errors with weird characters, long compile output truncation.

### 4.2 Limits

CPU-bound loop → TLE at limit; sleeping → TLE via wall time; allocate memory → MLE; stdout flood → OLE; stack overflow → RE; write huge file → RE/limit; open many files → limit.

### 4.3 Malicious suite (must be contained; assert no host impact)

Fork bomb, thread bomb, `execve` of shell, `/etc/passwd` and `/proc` reads, `ptrace`, `mount`, `unshare`, `socket` connect/listen, DNS lookup, symlink to host path, hard link tricks, `/dev/mem` attempts, signal to pid 1/other boxes, `kill(-1)`, core dump flood, time/rdtsc side-channel probes, environment dump, writing outside box, zombie accumulation, leaving background processes alive after exit.
Assertions: correct verdict, run finishes ≤ limit + 1.5 s, no processes left, no files left in box after cleanup, no outbound network packets (verified with netns/pcap in test harness), host health intact.

### 4.4 Correctness corpus

- 150 seed problems × reference solutions (C++/Java/Python) = AC.
- For each, **mutants** (known-wrong solutions: off-by-one, missing edge case, O(n²) where O(n) required) must fail with expected verdict (WA/TLE). This validates test quality; failing mutants block publishing (X7).

### 4.5 Determinism and stability

Run same submission 50 times: verdict identical; time variance within 15% (CPU pinning); across two worker types.

## 5. E2E scenarios (Playwright)

1. Sign up → onboarding → dashboard shows plan.
2. Filter problems → open → type code → Run samples → Submit → AC sparkle + XP toast.
3. WA flow → hint ladder (tier order enforced) → AC → editorial unlocked → rating.
4. Text interview with mock LLM: setup → start → chat → code → run → end → scorecard loading → review page → annotation jump → share link (hide transcript) → public view.
5. Resume upload → parse review → edit → confirm → question generation visible in plan preview.
6. Quiz timed attempt and result; wrong answers → flashcards.
7. Contest registration and standings update (fake time).
8. Settings: theme switch persists, shortcuts remap, readable mode removes pixel fonts.
9. Offline: flashcards review offline then sync.
10. Mobile viewport: bottom nav, problem tabs, voice interview layout.
    Also negative flows: rate-limit message, judge busy banner, LLM down banner, session reconnect.

## 6. AI evaluation (doc 13 targets)

### 6.1 Datasets (stored in `packages/prompts/evals/`)

- **Golden sessions** (30): transcripts + code events + human scores (2 raters, adjudicated). Mix of levels and types.
- **Interviewer simulations**: scripted candidate bots (strong, average, weak, evasive, verbose, silent, adversarial) run against interviewer prompt with a candidate-simulator model.
- **Injection and leak set** (50+): resume with instructions, messages asking for solution, role confusion, control-tag spoofing (`<control>`), encoded instructions, multilingual attempts.
- **Resume corpus** (20) with labeled sections/claims.
- **STAR set** (30 answers) with human labels.

### 6.2 Metrics and thresholds

| Metric                                                          | Threshold                   |
| --------------------------------------------------------------- | --------------------------- |
| Scorecard MAE vs human (per dimension)                          | ≤ 0.6                       |
| Spearman correlation overall                                    | ≥ 0.7                       |
| Repeatability (std over 5 runs)                                 | ≤ 0.3                       |
| Evidence validity (quotes verifiable)                           | 100%                        |
| Schema validation first-pass                                    | ≥ 95% (repair for the rest) |
| Solution leak rate                                              | 0 in adversarial set        |
| Injection success rate                                          | 0                           |
| Interviewer constraints (length, one question, no score reveal) | ≥ 98% turns                 |
| Persona identifiability (blind raters)                          | ≥ 80%                       |
| Resume section accuracy                                         | ≥ 90%                       |
| Filler count error vs human                                     | ≤ 10%                       |
| STAR component F1                                               | ≥ 0.8                       |

### 6.3 Process

- Prompt PRs run the offline eval with recorded model outputs for regression + live run on schedule.
- Track metrics per prompt version; promote only if no regression.
- User feedback (thumbs, ratings) sampled monthly and added to eval set.

## 7. Performance and load (k6)

| Scenario                                                            | Load                                 | Pass criteria                                |
| ------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------- |
| Problem list/search                                                 | 200 rps                              | p95 < 400 ms                                 |
| Problem page                                                        | 100 rps                              | p95 < 500 ms (cache warm)                    |
| Submit → verdict                                                    | 100 submits/min sustained, 300 burst | p95 verdict < 3 s (10 tests C++), no IE      |
| Contest burst                                                       | 500 users submit within 60 s         | queue wait p95 < 15 s with reserved capacity |
| WS interview                                                        | 100 concurrent sessions, 1 msg/20 s  | server CPU < 60%, no dropped events          |
| Dashboard                                                           | 100 rps                              | p95 < 600 ms (cache warm)                    |
| Scorecard generation                                                | 20 concurrent                        | all complete < 60 s                          |
| Soak: 4 hours at 50% load: no memory growth > 10%, no leaked boxes. |

## 8. Test data and fixtures

- `pnpm db:seed:test` builds deterministic dataset (fixed UUIDs, fixed time via injectable clock).
- Time control: all time-dependent logic uses an injected `Clock`.
- LLM mocking: record/replay layer (`LLM_MODE=mock|record|live`) with fixtures keyed by prompt hash.
- Fake STT: transcript fixtures with word timestamps.

## 9. Manual QA checklists

- Cross-browser (Chrome, Edge, Firefox, Safari) for editor, voice, canvas.
- Screen reader pass (NVDA/VoiceOver) on problem page, interview room, dashboard.
- Pixel theme legibility review in all three themes.
- Mic permission and device switching.
- Mobile real-device checks (Android Chrome, iOS Safari).

## 10. Quality gates summary

A change merges only if: lint/types pass, unit + integration pass, coverage gates met, e2e pass, no new critical a11y issues, security scans clean, and (for relevant paths) judge and AI eval suites pass.

## As built (Phase 4)

- **Unit:** judge-core (checkers, verdict mapping, driver source generation); `interpretMeta` for isolate's meta file; worker config rules.
- **Pipeline (process sandbox, any OS):** every verdict (AC, WA with and without leaking hidden data, RE, TLE, CE, float checker, custom runs, IE), submit vs run stop policy.
- **Driver conformance:** every shipped reference solution (20 Python, 7 C++, 7 Java) runs through the real drivers against the committed tests. Java tests skip when no JDK is installed; CI and the judge container have one.
- **Worker integration (real Redis):** BullMQ job in, ordered events out on the stream, retries of infrastructure errors end in exactly one IE, WA is not retried.
- **API integration (real Postgres, real Redis when up):** submission creation rules, idempotency, rate and pending limits, queue failure, the ingester (`applyJudgeEvent`, stuck sweep, Redis stream consumer incl. redelivery of unacknowledged entries and poison messages), privacy of results, statistics updates, history filters and cursors, diff, bookmarks, notes (conflicts, concurrency).
- **Malicious suite (`apps/judge/src/sandbox/isolate.container.test.ts`):** 16 tests under real isolate with cgroup v2, run inside the judge image (`JUDGE_ISOLATE_TESTS=1`); it is the CI `judge-sandbox` job. Every attack ends with a "still healthy" check that a normal submission is judged correctly afterwards.
- **E2E (Playwright, real stack incl. the judge worker):** Run on samples, Submit and the solved status, WA details, runtime and compile errors, custom tests, notes autosave, bookmarks, history page, detail page and diff. Also verified against the isolate container (`E2E_EXTERNAL_JUDGE=1`).
- **Not covered yet:** determinism/variance runs, 1,000-submission load test, mutant solutions (needs authored mutants), strace-level checks of the sandbox, outbound packet capture.

## As built (Phase 5)

- **Unit (`analytics-core`, 39 tests):** XP amounts and rounding, the level curve, streaks (same day, next day, freeze bridging, restart, milestones, backwards clock, month ends and leap days, time zones), hint and editorial unlock rules, mastery (recency, confidence, diagnosis), recommendations, badges.
- **API integration:** hints (order, cooldowns in both modes, no text leaked while locked, per-user state, solved bypass), editorial unlock paths and give-up, rating; XP and rewards through the real judge-event path (bonuses, penalties, repeat solves, runs and IE earn nothing, redelivery pays once, level up), streaks over days and time zones, badges, XP ledger, dashboard numbers reconciled with raw tables, range filter, isolation between users; admin hint and editorial editors (permissions, validation, audit, no version bump).
- **Content gates:** `content:validate` (editorials and hints), `content:judge` (references, mutants, editorial code through the judge; also a slice in `apps/judge` unit tests).
- **E2E:** empty then filled dashboard, hint countdown and relaxed mode, locked and open editorial (settings toggle), solving earns XP, badge, streak and updates the top bar, rating, dashboard widgets and range filter, admin hint and editorial editors with the validation checklist.
- **Not covered yet:** waiting out real cooldowns in the browser (covered by API tests that backdate timestamps), multi-day streak flows end to end, the nightly consistency job (not built).
