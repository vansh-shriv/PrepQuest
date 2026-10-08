# PROGRESS

Phase-by-phase build log. Plan source: `docs/18-ROADMAP-AND-SPRINTS.md`. Each phase ends with lint + typecheck + test green, `CLAUDE.md`/docs updated, and a suggested commit message.

| Phase | Scope                                                                                                                                       | Milestone | Status                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------- |
| 0     | Foundation: monorepo, CI, Docker Compose, env validation, health API                                                                        | -         | Done (committed)      |
| 1     | Design system: tokens, `packages/ui`, sprites, Storybook, 3 themes                                                                          | -         | Done (committed)      |
| 2     | DB schema v1, auth, app shell                                                                                                               | M0        | Done (committed)      |
| 2b    | Completion pass: Drizzle ORM, verified-email gate, rate limiting, OAuth, 2FA, breach check, export/deletion, public profiles, Husky, CI e2e | -         | Done (pending commit) |
| 3     | Problem bank, content pipeline, Monaco editor, admin v0                                                                                     | M1        | Not started           |
| 4     | Judge (`isolate`), submissions, verdict UI, history/bookmarks/notes                                                                         | M2        | Not started           |
| 5     | Hints, editorials, XP/streaks, dashboard, sheets                                                                                            | M3        | Not started           |
| 6     | AI interview MVP, resume parse, scorecards                                                                                                  | M4        | Not started           |
| 7+    | Voice, analytics, planning, SRS, contests, peer, hardening                                                                                  | M5-M12    | Planned               |

## Phase 0 - Foundation

Done:

- pnpm workspaces + Turborepo; shared TS presets in `packages/config`.
- `packages/shared`: Zod server-env validation (`parseServerEnv`), `AppError`.
- `apps/api`: Fastify app factory (`buildApp`), central error handler, `GET /v1/health` and `/v1/health/ready` (checks Postgres + Redis).
- `apps/web`: minimal Next.js App Router placeholder.
- `docker-compose.yml`: Postgres+pgvector, Redis, MinIO, Mailpit.
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
