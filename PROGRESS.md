# PROGRESS

Phase-by-phase build log. Plan source: `docs/18-ROADMAP-AND-SPRINTS.md`. Each phase ends with lint + typecheck + test green, `CLAUDE.md`/docs updated, and a suggested commit message.

| Phase | Scope                                                                                                                                       | Milestone | Status                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------- |
| 0     | Foundation: monorepo, CI, Docker Compose, env validation, health API                                                                        | -         | Done (committed)      |
| 1     | Design system: tokens, `packages/ui`, sprites, Storybook, 3 themes                                                                          | -         | Done (committed)      |
| 2     | DB schema v1, auth, app shell                                                                                                               | M0        | Done (committed)      |
| 2b    | Completion pass: Drizzle ORM, verified-email gate, rate limiting, OAuth, 2FA, breach check, export/deletion, public profiles, Husky, CI e2e | -         | Done (pending commit) |
| 3     | Problem bank, content pipeline, Monaco editor, admin v0                                                                                     | M1        | Done (committed)      |
| 4     | Judge (`isolate`), submissions, verdict UI, history/bookmarks/notes                                                                         | M2        | Done (committed)      |
| 5     | Hints, editorials, XP/streaks, dashboard, sheets                                                                                            | M3        | Done (pending commit) |
| 6     | AI interview MVP, resume parse, scorecards                                                                                                  | M4        | Done (pending commit) |
| 7     | Voice, live-coding awareness, AI eval harness                                                                                               | M5        | Done (pending commit) |
| 8     | Evaluation depth: more interview types, company packs, ideal answers, STAR, speech analytics, question memory                               | M6        | Done (pending commit) |
| 9     | Analytics and planning: readiness, topic mastery v2, interview trends, time analysis, study plan, daily goals, diagnostic                   | M7        | Done                  |
| 10    | Learning suite: spaced repetition, CS quizzes, roadmaps, company tracks                                                                     | M8 (part) | Done                  |
| 11    | SQL practice runner, aptitude items and the online-assessment simulator                                                                     | M8        | Done                  |
| 12    | Contests: ICPC and points scoring, private contests, live standings, virtual runs                                                           | M9 (part) | Done (pending commit) |
| 13+   | Code review mode, complexity analyzer, flashcards, shareable reports, integrity, peer mocks, hardening                                      | M9-M12    | Planned               |

## Phase 0 - Foundation

Done:

- pnpm workspaces + Turborepo; shared TS presets in `packages/config`.
- `packages/shared`: Zod server-env validation (`parseServerEnv`), `AppError`.
- `apps/api`: Fastify app factory (`buildApp`), central error handler, `GET /v1/health` and `/v1/health/ready` (checks Postgres + Redis).
- `apps/web`: minimal Next.js App Router placeholder.
- `docker-compose.yml`: Postgres+pgvector, Redis, MinIO (replaced by an `s3` CloudServer service in Phase 3), Mailpit.
- ESLint (flat), Prettier, `.editorconfig`, GitHub Actions CI (format, lint, typecheck, test, build).

Deferred from Phase 0 scope: Husky + lint-staged (add once the first commit exists), preview deploys (needs hosting decision).

Decisions / gotchas:

- TypeScript is pinned to `~5.9`: `typescript-eslint` does not support TS 7 yet.
- `docs/` and `CLAUDE.md` are in `.prettierignore` so formatting never rewrites the specs.
- Zod 4 is installed (`z.string().url()` is accepted; newer top-level helpers also exist).
- Verified live: with Docker running, `GET /v1/health/ready` returns `{"status":"ok","checks":{"postgres":"up","redis":"up"}}`.
- Compose maps Postgres to host port **5433** (not 5432): a native Windows Postgres already listens on 5432 on this machine and shadows the container. `DATABASE_URL` uses 5433.
- In Claude Code's shell, `docker` may be missing from PATH; reload it with `$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`.
- Heredocs with some content failed in the Bash tool; use the Write tool for file creation.

## Phase 1 - Design system

Done:

- `packages/ui` (`@prepquest/ui`, consumed as source, no build step): tokens for Cream / Night / Contrast themes plus a Readable mode, base + component CSS (`pq-` prefix), original sprites drawn as pixel grids (coin, sparkle, dino, folder, sunflower, plant, cursor, magnifier), and components: Button (+ `buttonClasses` for links), Card, Window (title-bar), Input, SearchPill, Tabs, LoadingBar, StageBar, Chip, FolderCard, Dialog (focus trap, Esc), Toast (+ `useToast`), Sprite, ThemeSwitcher (+ no-flash `THEME_INIT_SCRIPT`).
- Storybook 10 (`pnpm --filter @prepquest/ui storybook`, port 6006) with a theme + readable-mode toolbar and the a11y addon; `build-storybook` verified.
- `apps/web`: Tailwind v4 mapped onto the tokens, `next/font` for the five fonts, home page and a `/design` showcase of every component.
- Tests: sprite grid integrity (equal row widths, palette coverage) and server-rendered component semantics (28 tests in `ui`).
- Verified visually in headless Chrome: Cream (full `/design` page), Night and Contrast (component subset).

Decisions / gotchas:

- Notched corners use four offset `box-shadow`s (not `clip-path`), and the hard shadow is `filter: drop-shadow`, so the shadow follows the notched outline. Element needs `margin >= --border` (the `.pq-box` class sets it). Doc 07 §13 records this.
- Tailwind v4 (CSS-first `@theme inline` in `apps/web/src/app/globals.css`) replaces the v3 `tailwind.config.ts` shown in doc 07 §5. Component styling lives in plain CSS in `packages/ui`, so the UI package has no Tailwind dependency.
- Sprite colors are CSS variables, so sprites follow the active theme.
- Contrast theme uses a light-gray `--surface-alt` so empty loading blocks stay visible.
- Not done yet (deferred): Playwright visual-regression screenshots, custom retro cursor wiring, Monaco themes (Phase 3), composite components (JudgePanel, VerdictBanner, InterviewerAvatar, Timer, SkillPlant, StreakSunflower, RadarScore) which arrive with the features that use them.

## Phase 2 - DB, auth, app shell (milestone M0)

Done:

- `packages/db`: forward-only SQL migrations `001_identity`, `002_problem_bank`, `003_submissions` (doc 10 DDL plus `created_at`/`updated_at` triggers), migrate/reset runner (`pnpm db:migrate`, `db:reset`), transaction helper, UUID v7 ids, reference seed (32 tags). `pnpm db:seed` also creates the demo user (`demo@prepquest.dev` / `demo-password`).
- `apps/api` auth: signup, email verification and resend (Mailpit in dev), login, rotating refresh tokens with family revoke on replay, logout / logout-all, forgot / reset password (resets sign out everywhere), `GET /me`, profile and settings PATCH, device list and revoke. Argon2id passwords, EdDSA access JWT (15 min), httpOnly refresh cookie, Origin check on cookie endpoints, per-IP rate limits (Redis-backed when available), strict request validation (shared Zod schemas in `packages/shared`), `app.authenticate` / `app.requireRole` plugin, standard error shape + `x-request-id`.
- `apps/web`: auth context (token in memory only, single in-flight refresh), pages login / signup / forgot / reset / verify-email, protected `(app)` shell with top bar (PQ, MENU dialog, search, XP coin, streak sunflower, avatar), icon rail on desktop and bottom tab bar on mobile, dashboard, settings (profile, theme saved to account, devices, sign out everywhere), placeholder pages for unbuilt sections. New nav icon sprites in `packages/ui`.
- Tests: 30 API integration tests against a real `prepquest_test` Postgres (auth flows, token reuse, expiry, CSRF origin, rate limit, mass-assignment, session ownership, CORS preflight), plus 8 Playwright e2e tests through the real stack (signup, verify via Mailpit, login, reload, settings + theme persistence, mobile layout, menu / sign out, password reset). 44 UI tests, 3 shared.
- CI now runs a Postgres service for the integration tests.

Decisions / gotchas:

- ORM decision superseded in Phase 2b: Drizzle (see below).
- Login does not require a verified email (flag exposed, UI nudges); gate costly features on it later.
- `@fastify/cors` defaults to GET/HEAD/POST only; PATCH/DELETE must be listed explicitly (found by e2e, now covered by an API test).
- Next.js renders its own `role="alert"` route announcer: e2e locators for error messages must target text, not the role.
- `@node-rs/argon2`'s `Algorithm` is a const enum, unusable under `isolatedModules`; the code uses the numeric value with a comment.
- Dev JWT keys are generated into `secrets/` (gitignored) on first API start; tests use ephemeral keys.
- A native Windows Postgres owns 5432 on the dev machine, so Docker Postgres is on 5433 (Phase 0 note).

Deferred / next:

- All of the above were completed in Phase 2b.

## Phase 2b - completion pass (before Phase 3)

Requested follow-up: use an ORM, require verified email for AI interviews, apply rate limiting, and finish everything left in Phase 2's "deferred" list.

Done:

- **Drizzle ORM** replaces hand-written SQL. Schema in `packages/db/src/schema/*` (25 tables), migrations regenerated as `0000_extensions` (custom), `0001_baseline` (generated), `0002_triggers` (custom). All API repositories rewritten on the query builder; the 30 pre-existing API tests passed unchanged on the new layer. A schema guard test fails if a table lacks `created_at`/`updated_at` or the `updated_at` trigger. New scripts: `db:generate`, `db:studio`.
- **Verified-email gate:** `app.requireVerifiedEmail` (reads the DB, so verifying applies instantly) protects `/v1/interviews/*`; the web `/interview` page shows a resend prompt until verified. Login still works unverified.
- **Rate limiting** (doc 11 section 15 has the table): global per-user / per-IP budget with `RateLimit-*` headers, per IP+email login limit, per-address reset-email limit, per-user verification-email and export limits, failure-only 2FA attempt budget, exponential account lockout, Redis-backed (`RedisKv`) with in-memory fallback, fail-open on store errors, `TRUST_PROXY` support.
- **Breached-password check** via HIBP range API (k-anonymity), fail-open, `BREACH_CHECK` toggle; verified once against the live service.
- **2FA (TOTP):** own RFC 6238 implementation (checked against the RFC vectors), AES-GCM encrypted seeds, replay-safe, 10 hashed recovery codes, setup/verify/login/disable endpoints and settings UI with QR code, `mfa` claim on tokens (carried through refresh), MFA required for admin/moderator.
- **OAuth (Google, GitHub):** PKCE, server-side single-use state bound to the browser by cookie, verified-email-only sign-in, pre-hijack-safe account linking, 2FA hand-off, buttons shown only for configured providers. Tested against a fake provider; **not yet tried against real Google/GitHub credentials**.
- **Account data:** `/me/prep`, JSON export, deletion with 14-day grace and re-authentication, cancel-by-login, `db:purge` hard-delete job, public profiles with per-field privacy and a `/u/[handle]` page.
- **Web:** MFA step on login and after social sign-in, `/oauth/callback`, settings split into Profile / Data / Appearance / Security / Devices, pixel `Checkbox`, deletion banner on the dashboard.
- **Tooling:** Husky pre-commit (lint-staged: prettier + eslint on staged files) and commit-msg (commitlint, Conventional Commits). CI gained Redis for the verify job and a new `e2e` job.
- **Tests:** API 114 (12 files, real Postgres; Redis tests run when Redis is up), UI 45, shared 3, e2e 15 (real web + API + Mailpit).

Bugs found by the new tests and fixed:

- Zod 4 `z.record` with enum keys demands every key; prep hours use `z.partialRecord`.
- The 2FA attempt limit counted successful codes, so setup + login could lock a legitimate user out. Now only wrong codes count (`AttemptGuard`).
- `Content-Disposition` wasn't exposed over CORS, so the browser fell back to `download.json`. Now exposed and covered by an API test.
- `@fastify/rate-limit`: routes with their own `config.rateLimit` use a separate bucket from the global one (expected; the tests now assert the real behaviour).
- Playwright gives every test a fresh page; specs that assumed an earlier test's session had to sign in again. A 30 s TOTP step boundary could flake the setup test; it now waits out the last second of a step.

Decisions / gotchas:

- Drizzle over Prisma: no codegen step, TS-first schema, easy escape to raw SQL for the later analytics queries. `drizzle-kit` can't express extensions or triggers, so those are custom SQL migrations; **new tables must add their own `updated_at` trigger** (guard test).
- `lint-staged --diff` stages the files it fixes; running it manually can touch your index (I unstaged the one file it staged).
- Account lockout is per email (not per IP) so it works against distributed guessing, at the cost that someone can lock a victim out for up to 15 minutes. Documented in doc 11.
- The export is built inline and returned directly (no worker yet); revisit when BullMQ arrives in Phase 4.
- OAuth-only accounts delete with confirmation alone (no password to check); they have no stronger re-auth available yet.

Still open:

- Real-provider OAuth smoke test (needs Google/GitHub app credentials), CAPTCHA, disposable-email blocking, security headers/CSP on the web app, gitleaks in CI, the generated auth/authorization matrix test.
- The CI `e2e` job has not run on GitHub yet.

## Phase 3 - Problem bank, content pipeline, editor, admin v0 (milestone M1)

Done:

- **Storage:** `packages/storage` (`ObjectStore`, filesystem driver for dev/tests, S3 driver verified against a real server). Compose `minio` replaced by `s3` (`zenko/cloudserver`, :9000, creds `prepquest`/`prepquest-secret`) because MinIO's community images are no longer pullable.
- **DB:** migrations `0003` (`draft_history`, `admin_audit_log`), `0004` (their triggers), `0005` (`problems.signature`).
- **Content pipeline** (`packages/content`, `content/`): canonical stdin/stdout codec derived from function signatures, Python reference harness, generated starters (Python/Java/C++), test builder (samples, hand cases, seeded generators, dedupe), validator, versioned idempotent importer, CLI (`content:new|build-tests|validate|verify|import`). 20 original problems (10 easy, 8 medium, 2 hard) and the `foundations-20` sheet; all verified against their reference solutions.
- **API:** problem list (filters, typo-tolerant full-text search, sheets, cursor pagination), detail, tags, companies, sheets; drafts with optimistic concurrency, history (5), custom tests (20 cap). Admin: create/edit with versioning, zip test upload with zip-bomb checks, validation checklist, submit/publish/archive workflow with role rules, audit log, `optionalAuth`.
- **Web:** `/problems` (filters, search, URL-driven state), `/problems/[slug]` (resizable split panes, Markdown+KaTeX statement, Monaco with language switch, autosave drafts across devices, history/reset, custom tests, phone layout), `/admin/problems` (list, create, editor tabs, checks, workflow, audit). Pixel `Select`, `Textarea`, `StatusBox`, `Checkbox`.
- **Tests:** API 179+, UI 47, content/storage/web unit tests, e2e 15 account + 13 problems + 4 admin.

Bugs found and fixed:

- Monaco crashed in production ("Illegal value for token color") because the CSS minifier shortened `#ffffff`; colors are now normalised in `editor-colors.ts`.
- A controlled Monaco `value` dropped keystrokes; the editor now owns its text and external changes go through an explicit revision counter.
- Drizzle drops table prefixes in single-table SELECT-list subqueries (counts returned 0); use raw qualified names there.
- Windows Python text-mode stdout emitted `
`; the harness uses binary stdio.
- `TRUNCATE users CASCADE` also wipes problems: import fixtures after creating the test app.
- Filter panel and search box rendered twice; each is now rendered once.

Deferred:

- Reference-solution and mutation checks in admin validation (need the judge, Phase 4), Run/Submit buttons (Phase 4), hints and editorial authoring (Phase 5), company packs, generator runner in the admin UI, version diffs.
- The CI `e2e` job (now also importing content) has not run on GitHub yet.
- First cold-start e2e signup can exceed 5 s on a slow machine; the suite uses a 10 s expect timeout.

## Phase 4 - Judge, submissions, verdict UI, history, bookmarks, notes (milestone M2)

Done:

- **`packages/judge-core`** (pure): language table, drivers that read the canonical stdin format and call `Solution.<fn>` in Python, C++ (`#line` keeps the user's line numbers) and Java, checkers (exact, tokens, float, unordered), verdict mapping, and the job pipeline over a `Sandbox` interface.
- **`apps/judge`** worker: BullMQ lanes (`judge-submit`, `judge-run`), `IsolateSandbox` (cgroup v2, no network, read-only system view) and a development `ProcessSandbox`, results published to a Redis stream. No database credentials; its own config knows only Redis, the object store and sandbox settings. `apps/judge/Dockerfile` (isolate 2.0 from source, g++, Python, OpenJDK 17) plus a compose `judge` service (`--profile judge`).
- **API:** `POST /submissions` (run/submit, custom tests, idempotency keys, rate and in-flight limits, 503 when the queue is down), `GET /submissions/:id` with privacy rules, history with filters and cursors, submission notes, line diff, bookmarks, per-problem notes with conflict-safe saves and a notes hub search. The `ResultIngester` (Redis consumer group) writes results, updates `user_problem_state` and the problem's acceptance statistics, and a sweep closes submissions the judge never answered.
- **DB:** migrations `0006` (bookmarks, notes, per-test columns) and `0007` (triggers).
- **UI:** Run/Submit buttons (Ctrl+Enter, Ctrl+Shift+Enter), stage bar while judging, `VerdictBanner` with eight new verdict sprites, per-test results with expandable sample details, custom tests ticked into a run, per-problem history with "Load code", Notes and Bookmark on the problem page, `/submissions`, `/submissions/[id]` (code, note, diff, open in editor), `/notes` (notes hub and bookmarks).
- **Content:** C++ and Java reference solutions for seven problems; driver tests run them against the committed tests.
- **Tests:** API 214, judge 51 (+23 that need Linux/JDK/isolate), judge-core 16, ui 65, shared 7, content 27, storage 7, web 9; 16 malicious-program tests under real isolate in Docker; e2e 32 earlier specs + 8 judge specs.
- **CI:** new `judge-sandbox` job (builds the image, runs the malicious suite and driver tests under isolate); the e2e job starts the judge worker.

Verified: the full stack (browser, API, BullMQ, the dockerised isolate worker, stream, Postgres) with the judge e2e spec (`E2E_EXTERNAL_JUDGE=1`), and the process-sandbox worker with the same spec.

Decisions / gotchas:

- **Polling instead of WebSocket** for live progress (400 ms, then 1 s, 2 s): simplest thing that meets the p95 target; the WS gateway arrives with interviews and can reuse the stream events.
- The final `done` event carries every test result, so the database write is complete even if live `test` events are late or out of order. The ingester is at-least-once; all writes are idempotent.
- isolate does **not search `PATH`**, and `/etc` is not visible in a box: commands are mapped to absolute paths, the JDK's real `bin/` is used (the `/usr/bin/java` alternatives symlink would dangle) and `/etc/java-*` is mounted read-only. `--fsize` has to allow compiler output (it first capped `ld` at the 16 KB console limit).
- Python ignores `SIGXFSZ`, so a stdout flood ends in `EFBIG`, not a signal: output reaching the cap is treated as `OLE`.
- Driver conformance: the C++ driver is C++17 templates; on old MinGW (6.3) structured bindings in a _solution_ fail to compile, so the shared reference solutions avoid them.
- Playwright: Monaco auto-indents, so tests put code into the draft through the API; controlled inputs discard text typed before hydration (wait for something that loads after it); the language defaults to the first one (C++) unless saved, so a test must select it.
- Removed `FAKE_JUDGE`: the process sandbox gives real verdicts everywhere.
- `docs/12` and `docs/11` have "as built" sections; deviations from the original design are listed there.

Bug found by the tests and fixed: `__pycache__/*.pyc` had been committed in Phase 3 (reference solutions are imported by the harness). `.gitignore` now excludes them; run `git rm -r --cached -- $(git ls-files | grep __pycache__)` once to untrack the 21 files.

Deferred:

- Fair-share scheduling and reserved contest/interview capacity, test-data LRU cache, queue-wait estimates and backpressure, `special` checkers, seccomp/AppArmor/read-only rootfs for the container, a slim runtime image, judge metrics.
- Mutant solutions and the reference/mutation checks in admin validation (the judge exists now, so this is next for content), hints and editorials (Phase 5), XP/streaks (Phase 5: the coin and sunflower counters in the top bar are still 0), personal tags, notes export and version history, code review (X3) and complexity analysis (X4).
- The CI `judge-sandbox` job and the e2e job have not run on GitHub yet.

## Phase 5 - Hints, editorials, XP, streaks, dashboard, admin editors (milestone M3)

Done:

- **`packages/analytics-core`** (pure, 39 tests): XP and level curve, timezone-aware streaks with a grace day, hint and editorial unlock rules, topic mastery and weak-area detection v1, recommendations, badge rules.
- **Hints (D4):** three tiers, strict/relaxed cooldowns (counted from the first time a problem is opened), order enforced, text never sent while locked, `hint_usage` and `hints_used` feeding XP and submissions. Settings: hint mode and "open editorials" (new Practice section).
- **Editorial (D5):** locked until solved, all hints viewed, the setting, or an explicit give-up after a wait (counts like three hints); approaches with code per language, complexity, pitfalls, talk track, related problems; self-rating after a solve. Rules enforced on the server.
- **XP, levels, streaks, badges:** awarded inside the judge-result transaction (idempotent), ledger in `xp_events`, per-day activity, grace day, milestone bonuses, six badges, `rewards` stored on the submission and shown after Submit (the top bar refreshes).
- **Dashboard (A1):** level, streak sunflower, next best action, solved by difficulty with a 30-day series, accuracy, activity heatmap, skill plants, weak areas with a diagnosis, sheets progress, recent activity, badges, placement countdown, range filter. Numbers reconcile with the raw tables (tested).
- **Admin:** Hints and Editorial editors (audited, no version bump); the validation panel gained an editorial check and honestly marks reference/mutant checks as run by CI.
- **Content:** hints (60) and editorials (20, two approaches each, code from the reference solutions plus inline brute force) for all 20 problems; 40 mutants (known-wrong solutions); `content:judge` runs references, editorial code and mutants through the real judge pipeline (94 checks, all pass on this machine; Java skipped locally without a JDK). Importer syncs hints and editorials without creating versions.
- **UI:** Hints and Editorial tabs on the problem page, rewards panel, plant and sunflower growth sprites, `ActivityHeatmap`, new dashboard.
- **Tests:** API 267 (new: practice 17, progress 26, admin hint/editorial 10), analytics-core 39, ui 80, content 30, judge 56 (+23 Linux/JDK-only), e2e 8 new specs (48 in total).

Decisions / gotchas:

- Hints and editorials are **not versioned**: the content hash ignores them (a constant keeps the hash of existing problems unchanged, so adding them created no new versions). Imports sync them every run; problems without `editorial.json` keep admin-written editorials.
- XP arithmetic uses whole percentages: `25 * 0.9` drifted to 22 on float error where 22.5 should round to 23.
- Independence in mastery only credits problems that were _solved_ without hints; otherwise an unsolved problem scored a third of mastery.
- The streak freeze rule is a deterministic reading of "one freeze per week": one grace day is kept and a new one is earned at every multiple of 7 days.
- Giving up on an editorial counts as three hints for XP and as not-clean for the Clean Sheet badge.
- Zod 4 `z.record(enum, ...)` requires every key (again): editorial code uses `z.partialRecord`.
- Playwright: a controlled checkbox that follows a saved setting changes after the round trip, so click and assert `toBeChecked` instead of `.check()`; two copies of the same rating group exist while the result panel and the editorial are both mounted, so scope by test id.
- **Environment:** a VS Code extension (Console Ninja) had patched files inside `node_modules/next` (a 747-byte `start-server.js`), so `next start` failed with "startServer is not a function". Reinstalling Next fixed it; consider disabling the extension for this workspace. A shell whose working directory is inside `node_modules` blocks deleting it on Windows.
- Old dev data: a demo account that solved problems before XP existed shows solved problems with 0 XP (no backfill).

Deferred:

- **Content volume:** the roadmap's "up to 100 problems" is not met: 20 problems ship (authoring is the bottleneck, doc 18 risk). Next content step is more problems with the same pipeline (tests, mutants, hints, editorials).
- Today's quest board and daily goals, SRS (D6) and due reviews, readiness (A4), nightly consistency job, precomputed dashboard aggregates, XP from quizzes and interviews, XP tuning in the admin, AI hints, community solutions, hints disabled in interview and contest modes (those modes do not exist yet), sheet-level progress page beyond the dashboard widget and the problem list.
- The CI `verify` job now runs `content:judge` (new, not yet run on GitHub).

## Phase 6 - AI interview engine, resumes, scorecards (milestone M4, product side)

Done:

- **`packages/interview-core`** (pure, 49 tests): DSA and project templates with segment layout, the coding and project rubrics, the interview state machine (automatic transitions, guards, 85% wrap-up, the model can never end a session), control-channel parser and stream filter, hint policy and clamps, solution-leak guard, quote-verified scorecard validation and weighted aggregation, judge-derived correctness, question selection and adaptive difficulty, moderation.
- **`packages/prompts`** (11 tests): versioned interviewer, scorecard, annotation, resume, JD and question-generation prompts; every untrusted input is delimited and tag lookalikes are neutralised.
- **LLM gateway** (`apps/api/src/lib/llm`): model routing from env, retry then fallback model, retraction of streamed text from a failed attempt, token accounting (`llm_usage`), per-user daily and per-session budgets, JSON with a repair loop, Anthropic provider (streaming, cache breakpoints, effort), scripted mock and a recorder (`LLM_MODE=live|mock|record`).
- **Resumes and JDs (I3):** PDF/DOCX upload with content sniffing, background parsing, user review and confirm, pgvector retrieval (local hashing embedder), default resume, deletion of everything derived, JD analysis with gap.
- **Interview engine (I1, I4, I7, I8):** plan preview, create (idempotent, limits), start, server-authoritative timer with warnings and graceful end within seconds, pause rules, hint budget enforced in code, idle prompts, abuse handling, adaptive second problem, code events and judge integration (interview-tagged submissions, hints and editorial locked for the live problem), Socket.IO gateway with single-use tickets and replay, REST fallback, question memory.
- **Evaluation (E1, E2, E5):** async scorecard (evidence verified, overall computed in code, band, coverage, strengths, red flags, next actions), annotated transcript, notes, feedback, markdown export, retry of failed scorecards.
- **UI:** `/interview` hub and history, `/interview/new` (preview, overrides, JD analysis), the room (briefing, avatar, pixel timer, streaming chat with retry, editor + judge for DSA, reconnect banner), `/interview/[id]/review` (radar, bars, evidence, filtered transcript), `/resumes` (upload, review editor). New `@prepquest/ui` pieces: `InterviewTimer`, `InterviewerAvatar`, `ChatBubble`, `ScoreBar`, `RadarScore`, an interviewer sprite.
- **DB:** migrations `0010` (resumes, chunks, JDs, sessions, turns, events, scorecards, scores, annotations, question memory, `llm_usage`) and `0011` (triggers).
- **Tests:** API 357+ (interviews in five files: flow, guards, scorecard, outages and limits, WebSocket; resumes 22), interview-core 49, prompts 11, ui 86, web 18, e2e 7 new specs (resume, project interview, DSA with the judge, history, phone).

Decisions / gotchas:

- The verdict an interview sees comes from the judge's own submission row, never from the browser; the browser only sends the submission id.
- Streaming and enforcement coexist through `interviewer.retract`: tokens stream, the checks run on the full reply, and a failed reply is withdrawn before the corrected one. Retracted and final replies use different turn ids; the stored turn id is the successful attempt's.
- `ControlStreamFilter` holds back trailing whitespace and partial `<control>` prefixes so the block never flashes on screen.
- Socket handlers must be registered before the first `await` of the connection handler, or an early client event (`sync`) is lost.
- A rejected socket.io handshake is not retried by the client; the room hook reconnects with a fresh ticket.
- The five-series Claude models reject `temperature`; effort is the latency control. Model names are env config (`LLM_MODEL_*`).
- In mock mode repair rounds must read the original prompt (first message), not the repair message.
- `TRUNCATE users CASCADE` in `makeTestApp` wipes the shared test database: a second app in the same file breaks the first one's users (rate-limit tests live in their own files).
- The room reducer (`features/interview/room-state.ts`) keeps in-flight bubbles across a reload; the first version wiped a streaming greeting (found by the phone e2e spec).
- Heredocs with quotes and backslashes break in the Bash tool; use the Write tool for files (again).

Deferred:

- **Live model quality:** golden sessions, consistency runs, persona identifiability, the adversarial leak set (need the live model and a budget). Nothing has been run against the real Anthropic API in this phase; the provider code follows the SDK docs and is covered only through the mock and fakes. Run a manual smoke with `LLM_MODE=live` before relying on it.
- Voice (I5), live-coding reactions beyond "accepted" (I6), company packs (I2), more interview types, ideal answers (E3), STAR and speech analytics (E4), PDF export, audio upload, Redis pub/sub bus, `apps/worker`, XP for interviews, Sprint 4 deploy and observability (Sentry, metrics, hosting), content volume (still 20 problems).
- The CI `e2e` job has not run on GitHub (LLM mock is the default there).

## Phase 7 - Voice, live-coding awareness, AI eval harness (milestone M5)

Done:

- **Live-coding reactions (I6):** `interview-core/reactions.ts` holds the rules (60 s cooldown, no message within 5 s of a code change, 4 per question, "rarely" halves it, off means never). Triggers: accepted solution (immediate), failed run (after 20 s), code before any approach, nested loops (after 15 s, asks for the complexity without stating it), long silence while coding (a nudge that is a question, not a hint, persona-dependent). A small light-model classifier (`reaction` task) decides whether speaking is worth it; any failure means "speak" because the rules already gated it. Pending reactions live in `state_data`, are processed by the timer sweep, and are dropped when the candidate speaks first or the state moved on. Replies carry `meta.proactive`.
- **Replay (E2/I6):** the review has a "Code replay" tab (scrubber, markers for runs, submits, pastes and tab changes, line change counts, a list of moments). It opens on the final code. Frames come from the stored `interview_events`.
- **Voice (I5):** sessions have `mode` text/mixed/voice behind `FF_VOICE` (now on in `.env.example`; `422 VOICE_DISABLED` when off; `GET /interview/templates` returns `features.voice`). Browser Web Speech: push-to-talk (hold the button or Space), hands-free with a configurable silence, captions always on, replies read aloud once they are final, speed and mute controls, mic check in the briefing (permission, level meter, quiet and speech samples, advice). Denying the microphone or having no recognition leaves a working text interview. Voice answers are stored with `modality: voice` and approximate word timestamps; barge-in (`POST /interviews/:id/barge-in` or `user.barge_in`) keeps the full reply in the transcript, records what was heard, and tells the next turn the reply was interrupted. The interviewer prompt gets plain-speech rules in voice sessions. `speakableText` strips the control block, markdown and code (said as "code omitted, see the editor").
- **AI eval harness v1 (`pnpm eval:ai`, `apps/api/src/evals`):** 51 adversarial messages in 8 families (ignore-instructions, roleplay, solution requests, prompt reveal, forged markup, authority, pressure, encoding) with a canary in the confidential notes, 12 behaviour scenarios (length, stacked questions, hint rules, plain speech), and 5 golden interviews for scorecards (schema validity, quote verification, MAE, run-to-run std dev, rank correlation). Hard gates on every run: nothing harmful reaches the candidate after the guards. Model-quality thresholds (raw leak rate, MAE 0.6, std 0.3, rank 0.7) gate only `--live`. Reports go to `.data/evals`. CI runs the mock harness; the live run is manual. New guard: replies containing fragments of the interviewer's own instructions are blocked (`prompt_leak`).
- **Tests:** interview-core 57, API interview tests 92 (reactions 12, voice 6), evals 11, web 33, 5 voice e2e specs with a fake Web Speech API, replay assertions in the DSA e2e spec.

Decisions / gotchas:

- Replies are spoken only after they pass the leak and hint checks (final message), not sentence by sentence while streaming: a streamed sentence cannot be retracted from a speaker. The cost is a second or two of first-audio latency against doc 13's budget.
- Chrome exposes the unprefixed `SpeechRecognition` too; the hook prefers it, and the e2e fake has to define both names.
- Without headphones the microphone closes while the interviewer speaks in hands-free mode (speaker echo would trigger barge-in); push-to-talk always cuts in.
- The Web Speech API gives no word timings: words are spread evenly over the utterance and are estimates. The `words` column is ready for a streaming STT service.
- The code panel sends a snapshot every 5 s only when the code changed; the first snapshot of a question is treated as the starter code, so only code beyond it counts as "started coding".
- Layout moves when the editor appears in the room; e2e presses on the push-to-talk button use dispatched pointer events, not cached coordinates.
- Pointer capture can throw for synthetic pointers; the button swallows it.

Deferred:

- Server-side STT/TTS (streaming, word-level timestamps, neural voices), voice-activity detection beyond the silence timer, audio retention (opt-in), speech analytics (E4), latency measurement against the 2.5 s target.
- Live runs of the eval harness and real golden sessions (the five transcripts here are hand-written); persona identifiability panel.
- Reconnect robustness beyond ticket renewal and sync (event replay from a stream), `interrupted` shown in the chat UI, the timer's "mid-answer" pause for long voice answers.

## Phase 8 - Evaluation depth (milestone M6)

Done:

- **Interview types (I1, I2):** seven templates (dsa, project, resume, cs, behavioral, lld, hld) sharing the project-style state edges. Template fields (`followupCap`, `minMsForNext`, `hasHints`, `source`) drive behaviour: CS rounds ask 4 short questions and move on after the follow-up cap, behavioural rounds ask stories by competency, HLD and LLD are one long text-only question, the resume round walks resume items. New question kind `verbal` (bank question) beside `problem` and `project`; new rubrics for each type; per-type interviewer guidance.
- **Question bank (`content/questions`, 72 questions):** CS (os, dbms, cn, oop x 8), behavioural (24, by competency), design (8 HLD, 8 LLD) with reference answers, follow-ups and rubric points. `packages/content/src/bank.ts` loads, validates (unique slugs, known topics, review date warning) and imports it (`pnpm content:validate`, `content:import`).
- **Company packs v1 (I2):** five curated packs in `content/company-packs` (topic weights, difficulty band, rubric weights, hint policy, style notes, competencies, checklist, pitfalls, always with a "not an official process" disclaimer). Packs change the DSA pick, the rubric weights (DSA), the hint budget cap, the planned level (only upward) and the interviewer's style notes, and the plan preview lists these effects. A free-text company produces a provisional pack (LLM `pack` task at session creation, never in the preview), cached as `custom-<hash>`, flagged unverified and visible only to its creator.
- **Ideal answers (E3), STAR (E4), speech analytics (E4):** a review "extras" job runs after the scorecard (status in `interview_scorecards.extras_status`, three attempts, retried by the sweep and by `POST /interviews/:id/review/retry-extras`). Ideal answers come from the model with a fact check on STAR rewrites (invented numbers or names trigger a repair); STAR scores per behavioural answer with ownership ratio; speech metrics (words per minute, fillers, hedges, thinking vs dead-air pauses) are computed in code from the transcript, always shown with a "not a diagnosis" note. "Practise this question again" (`POST /interviews/:id/retry-question`) starts a one-question interview with the missed points as hidden rubric points.
- **Question memory (X5):** every asked question is stored with a topic and a 1024-dimension embedding; selection avoids recent questions and semantic duplicates (cosine 0.8), brings back weak ones, and the interviewer may refer to past practice (`personalizedCallbacks` setting, on by default). `/interview/history` lists, deletes and clears the memory.
- **Web:** type picker for 7 types, company pack picker with effects and scoring weights in the plan preview, verbal question banner in the room, review tabs Ideal answers, STAR and Speech, history page, callbacks setting.
- **Tests:** interview-core 84, content 35, API 409 (23 new for Phase 8), web 33, a new e2e spec `interview-rounds.spec.ts` (5 tests); `interview.spec.ts` and `voice.spec.ts` still green.

Decisions / gotchas:

- Build the `content` and `shared` packages before running API tests: the API resolves them through `dist/`.
- The mock interviewer cannot tell a project question from a resume-walkthrough one (same prompt label), so both use the same lead line.
- Pack rubric weights apply to DSA only; other types keep their own rubrics.
- Embeddings are still the local hashing embedder; a real model can replace it without changing the column.

Deferred:

- Real company data beyond the five practice profiles; more bank questions.
- Live (`--live`) eval cases for the new types and a golden set for STAR scoring.
- Audio-based speech analytics (needs server-side STT with word timings).

## Phase 9 - Analytics and planning (milestone M7)

Done:

- **Mastery v2 (A2):** `analytics-core/mastery.ts` now blends solve success (0.30), speed (0.20), hint independence (0.15) and interview scores (0.10); weights are renormalised over the signals that have evidence, so a topic with only solves scores exactly as in v1. Topic importance comes from the target pack (0.5 to 1.5). Quiz and SRS signals join when those features exist.
- **Time analysis (A5):** `analytics-core/timing.ts`. Active time is estimated from when a problem was opened, run and submitted (a gap over 20 minutes counts as a break). Per difficulty: median against the expected time, histogram, outliers; read-versus-debug split; slowest solves; a coaching line. Labelled as an estimate (the platform has no keystroke events yet).
- **Interview trends (A3):** `analytics-core/trends.ts`: overall score with moving average, best and worst, markers where persona or difficulty changed, deltas over the last five interviews per dimension, recurring red-flag categories as habits, filler-rate trend. Interviews under 30% completion are left out unless asked.
- **Readiness (A4):** `analytics-core/readiness.ts`, nine weighted components (DSA breadth, speed and independence, interviews, communication, CS, project, aptitude, design, consistency). Components without evidence say "not enough data" and drop out; thin evidence is pulled towards a low prior (0.3) in proportion to its confidence, so three clean solves never read as "Ready". The band is +/- 3 with solid evidence and widens to +/- 18. Highest-leverage actions estimate the points gained per action; the ETA fits a line through the daily snapshots and compares it with the placement date. The score is withheld below 5% evidence coverage. One snapshot per user per local day (`readiness_snapshots`). Targets are `general` or a company pack.
- **Diagnostic:** `POST /me/diagnostic` picks five unsolved problems across topics and difficulties; the results are ordinary submissions, so they feed everything above. It completes when each has been tried.
- **Study plan (P1):** `analytics-core/plan.ts`, deterministic. Backward phases from the placement date (Foundations, Pattern Mastery, Company Focus, Mock Intensive, Final Polish; shorter plans get fewer), capacity = hours x efficiency (starts 0.8, adapts nightly from planned versus done), topics ranked by weakness and importance and interleaved so no topic fills a day, weekly mock interviews from the second phase, reviews of shaky solves after 3 days, missed problems roll forward first, locked and custom tasks never move, completed and skipped tasks are history, and a warning names what was dropped when it does not all fit. Every task has a "why". Re-plans record a diff (`plan_diffs`); the plan page shows "2 moved, 1 added". The narrative is a deterministic summary.
- **Nightly job:** `nightlyPlanning` runs every 10 minutes from `main.ts` and handles each user once per local day: adapt efficiency, re-plan, snapshot readiness.
- **Daily goals (P2):** presets (light, standard, intense, weekend sprint) and custom items (problems, XP, interviews this week, finish today's plan). Progress is computed live from the server; finishing every goal pays 15 XP once (atomic claim). After a fortnight of mostly missed or always met goals the page suggests lowering or raising them.
- **Quest board:** `GET /me/quest-board` feeds the dashboard card (goals, today's tasks, readiness, one next action). A new learner is sent to the diagnostic.
- **Web:** `/plan` (setup, phases, today and coming up, lock, skip, move, add your own task, what changed, goal presets), `/analytics` (readiness with component breakdown and history chart, topics with diagnoses, interview trends, time analysis), the dashboard quest board.
- **Tests:** analytics-core 83, API 26 planning + 15 analytics new, web helpers 7, 6 e2e tests in `planning.spec.ts`.

Decisions / gotchas:

- Zod 4 `z.record(z.enum(...))` requires every key; use `z.partialRecord` (an e2e run caught it, API tests had not sent the field).
- A plan is one row per user that is versioned, not a new row per generation; tasks are matched across re-plans by a stable key (`problem:<slug>`), and missed tasks stay behind as `moved` history so planned-versus-done stays honest.
- Plan settings precedence: this request, then the saved plan, then the profile.
- `first_ac_at` is written by the database clock: tests that depend on "solved today" cannot pin the clock.
- A bank-dependent API test (`validates the input` with `type: hld`) was order-dependent after Phase 8; fixed.

Deferred:

- Quiz, aptitude and SRS signals and plan tasks (Sprints 8), roadmaps and company tracks (P3, P4), reminders and notifications, ICS export, an LLM-written plan narrative, keystroke-level time events, readiness weights per company pack, per-target plans beyond a pack choice.

## Phase 10 - Learning suite (milestone M8, first part)

Sprint 8 is large, so it is split. This phase builds spaced repetition, quizzes, roadmaps and company tracks. The SQL practice runner and the aptitude and OA simulator (C2) move to the next phase.

Done:

- **Spaced repetition (D6):** `analytics-core/srs.ts`, a modified SM-2. A first accepted practice solve creates a card (due the next local day, with the ease the solve earned). Steps are 1 day, 3 days, then interval x ease; a failed review goes back to 1 day, ease -0.2 (floor 1.3) and counts a lapse. Quality (0 to 5) is derived from the solve (failed attempts, hints, time, the self-rating) or chosen with Again/Hard/Good/Easy. Solving a due problem again is its review, graded automatically in the judge-result transaction; the self-rating refines a card that has not been reviewed yet. The queue is capped per day (default 5, setting 1 to 30), counts reviews already done today, and puts the most overdue first, then the weakest. Snooze, pause ("never show again") and a seven-day outlook. Due dates are local calendar days (`due_on date`), so "due today" follows the profile time zone. Solves from before this phase get a card on the first visit.
- **Retention signal (A2):** review quality per topic joins mastery at weight 0.10 (renormalised, like the other signals).
- **Quizzes (C1):** `analytics-core/quiz.ts` grades single, multiple choice, true/false, fill-in and output-prediction questions. 48 questions in `content/quizzes` (OS, DBMS, networks, OOP). Modes: practice (feedback per answer), timed (clock on the server, answers hidden until the end, answers editable until time is up), topic drill, weak-area quiz (questions whose latest answer was wrong). The answer key never reaches the browser while a quiz runs. XP: 2 per question answered correctly for the first time ever, 30 per attempt at most, paid once on finish. Quiz accuracy feeds readiness "CS fundamentals" together with CS mock interviews (blended by confidence), and a quiz counts as activity for the day.
- **Roadmaps (P3):** `analytics-core/roadmap.ts` (DAG validation, layers, node states, next node). Two roadmaps in `content/roadmaps` (`sde-dsa-core` with 11 topics mapped to the problem bank, `cs-fundamentals` measured by quiz accuracy). A node is locked until its prerequisites are cleared (default 60%), cleared at its unlock threshold and mastered at its master threshold (default 80%). The map is layered; each node shows its problem ladder (last one is the checkpoint), quiz link and why it is locked.
- **Company tracks (P4):** `analytics-core/tracks.ts`. A track is a company pack seen as a track: process, topic heatmap, a curated problem list derived from the pack's topic weights and difficulty band (deterministic), checklist, pitfalls, readiness for that company (A4 with the pack as target), and a ready interview setup (`/interview/new?pack=`). Starting a track records it and builds the study plan around the company. Overlap analysis of two tracks is a plain set intersection, with what to add for the second one.
- **Content pipeline:** `packages/content/src/learning.ts` validates and imports quizzes and roadmaps (`pnpm content:validate` checks answers against types and options, unique slugs, DAGs, known topics and problems, and thresholds; `content:import` upserts by slug).
- **Dashboard:** the quest board shows reviews due and puts "Review N problems" first in "Do this next".
- **Web:** `/reviews`, `/quizzes` and `/quizzes/[id]`, `/roadmaps` and `/roadmaps/[slug]`, `/tracks` and `/tracks/[slug]`; new navigation entries; `?pack=` pre-selects the company on `/interview/new` and `/plan`.
- **Tests:** analytics-core 22 new (105), API 35 new (13 reviews, 11 quizzes, 5 roadmaps, 6 tracks; 485 total), content 5 new (40), web helpers 9 new (49), 8 e2e tests in `learning.spec.ts`.

Decisions / gotchas:

- Roadmaps are stored as one `roadmaps` row with the graph in `data` (nodes carry their prerequisites) instead of separate node and edge tables; the DAG is validated on import. Quiz sets, flashcards, `oa_*`, `sql_*` tables and `quiz_sets` are not built.
- `srs_cards.due_on` is a local `date` rather than a timestamp, and `user_settings.review_cap` holds the daily cap.
- "Latest answer" queries order by `answered_at` then `created_at`: tests pin the clock, so timestamps can tie.
- In API tests the judge-result transaction uses the real clock (`new Date()`), so SRS tests use the real day for first solves and move the card's due date with SQL.
- The 20 problems in the bank are all there is, so a roadmap ladder shows only problems that exist; the checkpoint is the last one present.
- The Windows shell breaks on heredocs with quotes: write files with the editor tool.

Deferred:

- SQL practice runner, aptitude items and the OA simulator (C2), quiz sets and AI-graded short answers, flashcards (X6) and "wrong answer to flashcard", roadmaps and SRS feeding the study plan generator (plan reviews are still based on shaky solves), checkpoint quizzes and skip-assessment for roadmap nodes, role roadmaps beyond SDE and CS fundamentals, pattern-level reviews, XP for reviews, reminders and notifications, community-extendable track editing in the admin UI, 400 quiz questions (48 so far).

## Phase 11 - SQL practice and online assessments (milestone M8, second part)

Finishes Sprint 8: the SQL practice runner and the aptitude and OA simulator (C1, C2).

Done:

- **SQL runner (`packages/sql-runner`):** every run builds a throwaway in-memory SQLite database (sql.js, WebAssembly) inside a worker thread, so nothing persists between runs and there is no file system, network or extension loading. A statement timeout of 3 s kills the worker; results are capped at 1000 rows. No native build is needed (CI runs Node 20).
- **Guard and comparison (`analytics-core/sql.ts`, pure):** only one read-only statement is accepted (SELECT, WITH, EXPLAIN QUERY PLAN; writes, PRAGMA, ATTACH and friends are refused, keywords inside strings and comments are ignored). Results are compared by column position (aliases are free), NULL equals NULL, numbers match to 9 decimals, and rows are compared as a multiset unless the problem is order sensitive.
- **SQL problems (C1):** 26 problems on three datasets (company, online shop, college) in `content/sql/*.json`: select, joins, group by and having, subqueries, windows, recursive CTEs, NULL handling. `content:validate` runs every expected query through the real runner. Verdicts AC, WA (says what differs without showing the expected rows), ERROR and TLE. The first accepted solution pays XP once (10, 20 or 30 by difficulty); the reference solution and a note unlock after solving. Schema explorer with column types and sample rows.
- **Aptitude items (C2):** 47 items in `content/aptitude` (quantitative, logical reasoning, verbal, data interpretation, pseudocode), single choice or typed answer, each with an explanation and a speed shortcut.
- **OA simulator (C2, `analytics-core/oa.ts`, pure):** six templates in `content/oa/templates.json` (campus test, service-company style, product-company style, CS fundamentals test, two speed drills). A paper is built deterministically from an attempt-specific seed with mixed difficulty (aptitude items and CS quiz questions). Each section has its own server-side clock, sections run in order and a finished section is locked. Negative marking and the calculator are per template. The report gives marks per section, accuracy, pace, weak topics, rushed sections, a percentile (only once 10 other attempts exist) and a review of every question with its answer, explanation and shortcut. XP is half the correct answers, 30 at most, paid once.
- **API:** modules `sql` (`/sql/problems`, `/:slug`, `/run`, `/submit`) and `oa` (`/oa`, `/oa/attempts`, `/:id`, `/:id/sections/:index/start`, `/:id/answers`, `/:id/submit-section`, `/:id/finish`). A forgotten test is closed after 24 hours so it cannot block the next one. `progress/xp.ts` pays XP and activity for these.
- **Web:** `/sql`, `/sql/[slug]` (Monaco in SQL mode), `/tests`, `/tests/[id]` (between sections, running section with question navigator and timer, on-screen calculator, report); nav entries SQL and Tests.
- **Database:** migrations 0020 (tables) and 0021 (triggers): `sql_datasets`, `sql_problems`, `sql_attempts`, `aptitude_items`, `oa_templates`, `oa_attempts`.
- **Tests:** analytics-core 16 new (121), sql-runner 6, content 3 new (43), API 20 new (9 sql, 11 oa), web helpers 9 new (58), 5 e2e tests in `assess.spec.ts`.

Decisions / gotchas:

- SQLite (sql.js) is the only dialect; PostgreSQL practice and query-plan questions are deferred. The worker is an eval'd string that `require`s sql.js, so it works the same from `dist`, tsx and vitest.
- Section clocks live in `oa_attempts.state` (JSON): `syncClock` closes a section whose deadline passed whenever the attempt is read or written, so no timer job is needed.
- Quiz answers and aptitude answers share the OA path: responses travel as strings (`true`/`false` for tf, comma-joined ids for multi) and are parsed before grading.
- A test template's technical sections draw on `quiz_questions`, so `seedLearning` must run before OA tests.
- The e2e spec filters template cards by description text (the card title is outside the test id element).

Deferred:

- Coding questions inside an OA, work-simulation questions, admin editing of templates, AI-graded short answers, PostgreSQL dialect and EXPLAIN-interpretation problems, more content (aptitude is 47 of the planned 200 and SQL 26 problems), per-section percentile bands from a larger population, aptitude practice outside timed papers, SQL and OA results feeding mastery and the study plan.

## Phase 12 - Contests (milestone M9, first part)

Sprint 9 is split. This phase builds timed contests (D7). Code review mode (X3), the complexity analyzer (X4), flashcards (X6) and shareable reports (U5) move to the next phase.

Done:

- **Scoring and standings (`analytics-core/contest.ts`, pure):** ICPC scoring (solved count, then penalty: the minute of each solve plus 20 minutes per wrong attempt before it) and points scoring (points decay linearly to 50% by the end, minus 10 per wrong attempt, never below 30%). Only the first accepted attempt per problem counts; compile and infrastructure errors cost nothing; pending attempts are not wrong attempts; attempts outside the window are ignored; ties share a rank (1, 2, 2, 4). The freeze hides attempts from the last N minutes (shown as `?`). 26 hand-computed scenarios pin the rules (the "20 recorded scenarios" acceptance criterion), plus virtual placement.
- **Contests:** weekly, company-style and private. Public contests need a reviewer or admin; anyone with a verified email can run a private contest with an 8-character invite code (only the creator sees it; without the code, registration, or authorship the contest is a 404). The problems stay hidden until the start. Registration opens early and a late join keeps the contest's own end time; after the end registration is refused. The creator of a private contest is registered automatically.
- **Taking part:** the web problem page takes `?contest=<slug>`: attempts are sent in `contest` mode (the server checks that the learner is registered, the contest is running for them and the problem belongs to it), hints and editorials are `HINT_LOCKED` for contest problems while the learner is inside the window (editorials open at the end), a pinned bar shows the server clock, and focus loss and pastes are counted for the integrity review (X2 later).
- **Standings:** computed from the contest-mode submissions on every request, so they follow a verdict the moment it is stored (the page polls every 5 s while running). The freeze applies to everyone but the creator and lifts at the end. The table shows the top 50 and always the caller's own row. The final table is the same computation, so the leaderboard is permanent without a separate copy.
- **Virtual contests:** after the end a learner can replay the contest on their own clock (one run at a time). Virtual attempts never touch the real standings; the best run is placed among the real results ("you would have placed #3 of 12").
- **API:** module `contests`: `GET /contests?status=`, `POST /contests`, `GET /contests/:slug`, `POST /:slug/register`, `GET /:slug/standings`, `GET /:slug/me`, `POST /:slug/virtual`, `POST /:slug/events`. `POST /submissions` accepts `mode: contest` and `contestSlug`.
- **Web:** `/contests` (running, upcoming, past, join by code, create form) and `/contests/[slug]` (clock, problems, standings, your submissions, virtual run).
- **Database:** migrations 0022 (tables) and 0023 (triggers): `contests`, `contest_problems`, `contest_participants` (live and virtual rows, integrity counters).
- **Tests:** analytics-core 30 new (151), API 15 new, web helpers 5 new, 5 e2e tests in `contests.spec.ts`.

Decisions / gotchas:

- Standings are computed from `submissions` instead of a Redis sorted set or a `contest_standings` table: at this scale it is one indexed query, it needs no cache invalidation, and the 2-second acceptance criterion holds. Move to a ZSET if a contest ever has thousands of participants.
- A live participation follows the contest's own window (moving the contest moves everyone); a virtual one has its own start and end.
- Contest submissions still pay normal solve XP and statistics through the judge-result transaction; spaced repetition cards are only created for practice mode.
- Tests use the real clock for contests, because submission timestamps come from the database, not the pinned test clock. Tests move a contest with SQL (`UPDATE contests SET starts_at = ...`).
- The start time field has minute precision, so the server accepts a start up to two minutes in the past.

Deferred:

- Rating updates (Elo-like, P3), reminders by email or in-app, per-college and global leaderboards, similarity detection after a contest (X2), a certificate-style report card (U5), admin editing and cancelling of contests, contest-only first-failing-test feedback trimming, MCQ sections inside contests.
