# 05. Features: Platform, Advanced, and Engineering

Covers **U1 to U5**, **X1 to X7**, **G1 to G4**.

---

## U1. Authentication and profiles [MVP]

### Authentication

- Email + password (Argon2id hashing), email verification, password reset with expiring token.
- **OAuth**: Google and GitHub (OIDC/OAuth2 with PKCE).
- Sessions: short-lived JWT access token (15 min) + rotating refresh token in httpOnly secure cookie; refresh token reuse detection revokes the family.
- **2FA (TOTP)** [P3]; device/session list with "sign out everywhere".
- Account deletion with data export (JSON) and hard-delete after 14-day grace.
- Rate limits on login and reset endpoints; CAPTCHA after repeated failures.

### Profile

- Display name, handle (unique), avatar (pixel avatar picker with 24 presets and color options; custom upload optional), bio, college, graduation year, branch, location (optional), timezone, links (GitHub, LinkedIn, LeetCode, Codeforces).
- **Prep settings**: target roles/companies, placement date, hours per day, preferred languages, preferred mode (strict hints, open editorials).
- **Public profile** (opt-in): handle page showing stats, streak, badges, skill plants. Privacy toggles per field.
- **Badges** (pixel icons): First Blood (first AC), Week Warrior (7-day streak), Graph Slayer, Mock Master (10 interviews), Speed Demon, etc.
- Onboarding wizard: pick track, target, date, time budget, take a 15-minute diagnostic, generate plan.

### Acceptance criteria

- Passwords are never logged; breach-password check on signup (k-anonymity API).
- Handle is unique case-insensitive; profile privacy toggles are enforced on every API.

---

## U2. Submission history with saved code and notes [MVP]

### Behavior

- Per-problem history tab and a global history page.
- Row: timestamp, language, verdict, runtime, memory, hints used, mode (practice/contest/interview).
- Click to view **saved code**, results by test case, and diff versus previous attempt.
- **Filters**: verdict, language, date, problem, mode. Search by problem title.
- **Resubmit** to editor (loads that code), **copy**, **compare two submissions**.
- Each submission can carry a short note ("forgot to handle duplicates").
- **Retention**: all accepted submissions kept indefinitely; failed ones for 180 days (configurable); on request, deletable.

### Acceptance criteria

- History loads 1,000 rows via paginated cursor in under 500 ms.
- Code visible only to the owner (and to admins with an audit trail).

---

## U3. Bookmarks, tags, and personal notes [MVP]

### Behavior

- **Bookmarks** (flag icon) with optional folders ("Revisit", "Hard ones", "Amazon").
- **Personal tags** (free text, colorized) on any problem, quiz question, or flashcard.
- **Notes**: per problem, markdown with code blocks, autosave, version history (last 10).
- **Notes hub**: global search across notes; filter by tag, topic, and date.
- Notes can be attached to interview moments (E2) and converted to flashcards (X6).
- **Export** all notes as Markdown zip.

### Acceptance criteria

- Notes saves are conflict-safe (version check) across tabs.
- Deleting a problem (archived by admin) retains notes with a "problem archived" marker.

---

## U4. Dark mode, keyboard shortcuts, and mobile-friendly layout [MVP]

### Themes

The design system (doc 07) ships **three themes**:

1. **Cream (default light)**: the pixel-sheet palette from the reference image.
2. **Night Arcade (dark)**: deep navy/charcoal background with the same accent colors.
3. **High Contrast**: for accessibility (pure black/white, thicker borders).
   Follows system preference by default; override saved per user.

### Keyboard shortcuts (all remappable in settings)

| Action                           | Shortcut                            |
| -------------------------------- | ----------------------------------- |
| Command palette                  | `Ctrl/Cmd + K`                      |
| Run                              | `Ctrl/Cmd + '`                      |
| Submit                           | `Ctrl/Cmd + Enter`                  |
| Toggle hints panel               | `Alt + H`                           |
| Toggle fullscreen editor         | `F11` or `Alt + F`                  |
| Next/prev problem in sheet       | `Alt + ]` / `Alt + [`               |
| Focus editor / focus description | `Alt + E` / `Alt + D`               |
| Start/stop mic (voice interview) | `Space` (push-to-talk) or `Alt + M` |
| Go to dashboard                  | `g d`                               |
| Show shortcut cheat sheet        | `?`                                 |

### Mobile

- Responsive breakpoints at 480, 768, 1024, 1280.
- **Mobile layout**: bottom tab bar (pixel MENU style), single-column; problem page uses tabs (Description / Code / Results). Editor is usable but read-optimized; recommended for revision, quizzes, flashcards, reviewing feedback; coding on phone allowed.
- **Interview on mobile**: voice-first layout with large mic button and live captions.
- Touch targets at least 44 px; pixel borders scale on 1x/2x/3x pixel density.
- PWA install support with offline flashcards [P2].

### Acceptance criteria

- All primary flows pass automated accessibility audit (axe) with zero critical issues.
- Shortcuts do not trigger while typing in inputs unless they are modifier combos.

---

## U5. Shareable reports [P2]

### Behavior

- Share a **mock interview scorecard** via link. Options: public link, unlisted link with token, or private (owner only).
- **Privacy filters** before sharing: hide transcript, hide code, hide company name, redact personal info; default shares summary + scores only.
- **Link features**: expiry (7 days / 30 days / never), revoke anytime, view counter.
- Share pages render as a **pixel report card** with OG image (server-generated PNG) for nice previews on LinkedIn/WhatsApp.
- **Other shareable items**: contest results, readiness summary, streak badge, public profile.
- **PDF export** of any report.
- Peer mode (X1) uses the same system to send feedback reports to a partner.

### Acceptance criteria

- Revoked links return 404 immediately (cache purge).
- Shared pages contain no PII beyond what the user selected.

---

## X1. Peer mock interviews [P3]

### Behavior

- **Matching**: users post availability and preferences (role, topic, difficulty, language, timezone); matching based on overlapping slots and reciprocal interest. Also **invite by link** for friends.
- **Session room**: WebRTC audio (and optional video) with shared Monaco editor (CRDT via Yjs), shared whiteboard, timer, and question card.
- **Roles**: interviewer and candidate, swap at half-time. Interviewer sees a **cheat panel** (problem solution, rubric, suggested follow-ups). Candidate sees only the problem.
- **AI assistance**:
  - For interviewer: suggested follow-up questions in real time (private panel), rubric checklist.
  - Post-session: AI scorecard based on transcript (with consent of both) combined with interviewer's manual ratings.
  - Feedback quality coaching: "Your feedback to peer lacks specifics" nudge.
- **Reputation**: peers rate each other (punctuality, helpfulness); no-show penalties; report/block.
- **Safety**: report abuse, mute/leave anytime, no recording unless both opt in; stored recordings optional and deletable.
- **Scheduling**: calendar invites (ICS), reminders, reschedule flow.

### Acceptance criteria

- Shared editor syncs edits under 300 ms between peers on typical connections.
- Session without both consents produces no AI analysis of audio.

---

## X2. Plagiarism and AI-assist detection [P3]

### Purpose

Protect contest and interview integrity; also help users know how their behavior looks.

### Detection layers

1. **Code similarity**: tokenize and normalize code (strip identifiers/whitespace, AST fingerprint) and compare with MOSS-like winnowing; compare against other submissions in the same contest and known public solutions.
2. **Behavioral signals**: large paste events, near-instant full solutions, focus loss events, typing cadence anomalies (no incremental edits), switching to other windows.
3. **AI-assist signals**: stylistic markers of LLM-generated code (excessive comments, uniform formatting) used only as a weak signal; never sole evidence.
4. **Interview-mode signals**: answers that read like pasted text (very low latency + perfect structure), mismatch between spoken explanation and code.

- **Output**: integrity flag with severity and **evidence list**; reviewed by admin before any penalty; user can appeal.
- **Transparency**: contest rules page lists what is monitored. Practice mode only records signals privately and shows a tip, no penalty.

### Acceptance criteria

- False-positive guard: trivial solutions (short code) are excluded from similarity flagging.
- Similarity detector achieves defined precision on a labeled test set (doc 16).
- No automatic bans without human review.

---

## X3. Code review mode [P2]

### Behavior

- After an accepted solution (or any submission), the user clicks **Review my code**.
- AI critiques: **readability** (naming, structure), **idioms** per language (e.g., `emplace_back`, range-based loops, Python comprehensions, Java collections), **complexity**, **edge-case robustness**, **maintainability**, **interview presentation** (how to write cleaner in a whiteboard setting).
- Output: annotated code with line-level comments, severity tags (nit, suggestion, important), and a **refactored version** option.
- **Compare mode**: show user's code vs editorial vs peer-style optimized solution.
- Interviews reuse this for E1 code-quality scoring.
- Users can set review strictness (gentle/strict/pedantic).
- Rate limit and daily cap to control LLM cost.

### Acceptance criteria

- Suggested refactors still pass all tests (refactor is auto-verified by running it through the judge before display; if it fails, the refactor is hidden).

---

## X4. Complexity auto-analyzer [P2]

### Behavior

- Compares user's **claimed** Big-O (input in a small form after submission) against **empirical** growth measured by the judge.
- **Method**: run the solution on generated inputs of increasing sizes (n = 10^2 ... 10^5 within limits), record CPU time and memory; fit candidate models (O(1), O(log n), O(n), O(n log n), O(n^2), O(n^3), O(2^n)) via log-log regression and goodness of fit; select best with confidence.
- **Static hints**: AST-based loop nesting depth and recursion detection to cross-check.
- **Output**: "You claimed O(n log n). Measured growth looks like O(n^2) (R^2 = 0.98). The inner loop in line 18 likely causes this."
- Provides a **growth chart** (pixel line chart) and warns about limitations (cache effects, small n noise, input-dependent behavior).
- Admins define generators per problem for scaling tests.

### Acceptance criteria

- Correctly classifies a set of 30 reference implementations with known complexity at 90%+ accuracy.
- Always labeled "empirical estimate", not a proof.

---

## X5. Interview question memory [P2]

### Behavior

- Tracks every question and problem the user has been asked, with outcomes.
- **No repeats**: question selection excludes recent ones unless "retry weak question" is requested.
- **Follow-up continuity**: interviewer can say "Last time you struggled with detecting cycles in directed graphs; let's revisit," or "In your last session you mentioned X; how has that changed?" (user can disable personalized callbacks).
- Implementation: structured table of asked questions + embeddings for semantic dedupe (pgvector); similarity threshold avoids paraphrased repeats.
- **Spiral curriculum**: unresolved weak questions resurface with variations.
- Memory is viewable and editable by the user ("Question history" page with a delete option).

### Acceptance criteria

- Over 20 consecutive generated interviews, no semantically duplicate question appears within the cooldown window.
- Disabling callbacks removes all history references from prompts.

---

## X6. Offline-friendly flashcards [P2]

### Behavior

- **Decks**: Patterns (e.g., "Sliding window template"), Formulas (complexities, recurrence relations, probability), CS facts (TCP handshake, ACID), Behavioral stories bank, Mistakes deck (auto-generated from errors).
- **Card types**: basic front/back, cloze deletion, code snippet, image.
- **Creation**: manual, from notes, from quiz mistakes, from interview moments, from editorial key insights; AI-generate suggestions (user approves).
- **Study**: SM-2 scheduling, daily limit, "cram" mode, reversible cards, swipe interface on mobile.
- **Offline**: service worker caches decks; reviews queue locally and sync when online (conflict resolution by last-review timestamp).
- **Sharing**: export/import via JSON, shareable public deck links.

### Acceptance criteria

- Fully offline review session works for cached decks and syncs correctly after reconnect with no lost reviews.

---

## X7. Admin panel [MVP basic, P3 advanced]

### Capabilities

- **Roles**: super admin, content editor, reviewer, support, moderator.
- **Problem management**: create/edit with markdown+LaTeX preview, constraints, examples, tags, companies, difficulty, time/memory limits per language, starter code, checker type, editorials, hints (3 tiers), generator scripts; **draft, in review, published, archived** workflow with versioning and diff.
- **Test case management**: upload zip or paste; bulk import; **validator** run (input format check); **reference solution** runs to generate expected outputs; stress test generators; mark hidden/sample/edge-labeled.
- **Dry-run publishing**: run the reference solution plus a few alternative solutions (known-wrong) to verify tests catch errors (mutation check).
- **Quiz and aptitude management**: bulk CSV import, review queue.
- **Sheets and roadmaps**: drag-and-drop ordering, DAG validator.
- **Company packs**: JSON editor with schema validation and preview.
- **Contest management**: create, schedule, assign problems, monitor live, rejudge, announcements.
- **User management**: search, view, ban/unban, reset, impersonate (with audit log and consent banner).
- **Integrity queue** (X2) and **report queue**.
- **System dashboards**: queue depth, judge health, LLM spend, error rates (links to observability).
- **Feature flags** and config (XP tuning, rate limits, model names).
- **Audit log**: immutable record of all admin actions.

### Acceptance criteria

- A problem cannot be published without at least one passing reference solution and N validated tests.
- Every admin action is in the audit log with actor, time, before/after diff.

---

## G1. Rate limiting and queue-based code execution [MVP]

- **Rate limits** (Redis token bucket / sliding window):
  - Submit: 10 per minute, 200 per day per user (higher for verified).
  - Run: 30 per minute.
  - AI messages: per-interview caps and daily token budget per user.
  - Auth endpoints: strict per IP and per account.
  - Global per-IP limit on anonymous endpoints.
- **Queue**: BullMQ with priority lanes: `contest` > `interview` > `practice` > `bulk/rejudge`; fair scheduling per user (avoid one user starving others).
- **Workers**: stateless judge workers pulling jobs; each executes in `isolate` sandbox within a hardened container; autoscale on queue depth; graceful drain.
- **Back-pressure**: when queue length exceeds threshold, UI shows estimated wait and applies stricter limits to low-priority lanes.
- **Retry and dead-letter** for IE failures; poison-job quarantine.
- Detailed design: doc 12.

## G2. Caching, async job processing, and WebSockets [MVP core]

- **Caching layers**: CDN for static; Redis for problem metadata, sheet lists, leaderboard, dashboard aggregates, rate-limit counters; HTTP caching with ETags for public content; in-memory LRU for hot config.
- **Cache invalidation**: event-driven (publish on admin edits; user-specific keys purged on activity).
- **Async jobs** (BullMQ): resume parsing, embedding generation, scorecard generation, analytics rollups, readiness snapshots, SRS scheduling, plan re-planning, email/notifications, OG image render, rejudge, cleanup.
- **WebSockets** (Socket.IO or ws with a custom protocol): interview session channel, submission status stream, contest standings, peer rooms. Auth by short-lived token; heartbeat; reconnect with resume (last event ID); horizontal scaling via Redis pub/sub adapter and sticky sessions for the gateway.
- **Idempotency keys** for submission and payment-like operations.

## G3. Observability [MVP basic, P2 full]

- **Structured logs** (JSON) with trace/request IDs, user ID hash, submission ID, session ID.
- **Metrics** (Prometheus): API latency, error rates, queue depth, judge run durations by language, verdict distribution, IE rate, WS connections, LLM latency/tokens/cost, cache hit rates, DB pool use.
- **Tracing** (OpenTelemetry): API to queue to worker to result; interview turn to LLM call.
- **Error tracking** (Sentry) frontend and backend with release tagging.
- **Dashboards** (Grafana) and **alerts**: judge IE spike, queue wait over threshold, LLM error rate, p95 latency, disk/memory, failed jobs.
- **Product analytics** (PostHog or self-hosted): feature usage funnels, privacy-respecting.
- **Health endpoints**: `/healthz`, `/readyz`, judge self-test canary running a known problem every minute.
- Details: doc 15.

## G4. CI/CD, tests, and deployed demo [MVP]

- **CI** (GitHub Actions): lint, type-check, unit tests, integration tests with service containers (Postgres, Redis), judge sandbox tests in a privileged runner, build, security scans (npm audit, Trivy, CodeQL), Playwright e2e on preview deployments.
- **CD**: preview environment per PR; main deploys to staging automatically; production deploy by tag with manual approval; DB migrations run as a separate job with rollback plan.
- **Test pyramid**: unit (80%+ for judge scoring logic), integration (API + DB), e2e (core flows), load tests (k6 for submit and WS), AI eval suite (golden transcripts, rubric consistency).
- **Deployed demo**: public URL, seeded with 100+ problems, demo account, sample interview report, README with GIFs, architecture diagram, and a short Loom/GIF walkthrough.
- Details: docs 15 and 16.

## As built (Phase 13): X6 flashcards and U5 shareable reports

**X6.** Decks (patterns, formulas, CS facts, behavioral, mistakes, custom), card types basic, cloze and code, SM-2 scheduling shared with solved-problem reviews, daily new and review limits, cram mode, JSON export and import, four starter decks, wrong quiz answers pushed into a "Quiz mistakes" deck. Reviews are sent through one idempotent sync endpoint; the web app queues them on the device and retries. Acceptance: a session started online keeps working offline and syncs with no lost or doubled reviews (API tests and `flashcards.spec.ts`). Not built: service worker and app-shell caching, IndexedDB, reversible and image cards, AI suggestions, cards from notes and interview moments, public deck links, swipe gestures.

**U5.** Share an interview scorecard, a finished contest result or a readiness summary through an unlisted or public link with options (hide transcript quotes, code quotes, company, name), expiry (7 days, 30 days, never), revoke and a view counter. The page is a pixel report card with Open Graph and Twitter tags and a generated 1200x630 PNG; PDF export is the browser's print dialog. Acceptance: revoked links return 404 immediately (`no-store`, no cache to purge) and the payload carries only what was selected (unit and integration tests). Not built: sharing the streak badge or public profile, "report viewed" notifications, peer feedback reports.

## As built (Phase 14): X3 code review and X4 complexity analyzer

**X3.** Review of a finished submission at gentle, strict or pedantic strictness: summary, six ratings, line comments with severity (important, suggestion, nit) and category, checked by code before they are stored. A cleaner version is shown only after the judge accepted it on every test (acceptance criterion met by `codereview.test.ts` and `review.spec.ts`). Limits: 3 reviews a minute and 20 a day, verified email. Not built: compare mode against the editorial, use in interview E1 scoring.

**X4.** The learner claims a class; the judge times the code on generated inputs of growing size (per-problem `scale.json`, 19 of 20 problems); the growth exponent is fitted in log-log space and compared with the claim, with the loop that likely causes a slowdown. Always an "empirical estimate", with a growth chart and a table. On the 19 reference solutions measured through the real judge the true class was among the plausible ones every time (`complexity.test.ts`); the 90 % accuracy criterion is met for "plausible", not for a single exact class, because O(n) and O(n log n) cannot be told apart by timing. Not built: exponential and recursive solutions (tiny sizes), memory fitting.
