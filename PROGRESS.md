# PROGRESS

Phase-by-phase build log. Plan source: `docs/18-ROADMAP-AND-SPRINTS.md`. Each phase ends with lint + typecheck + test green, `CLAUDE.md`/docs updated, and a suggested commit message.

| Phase | Scope                                                                | Milestone | Status                |
| ----- | -------------------------------------------------------------------- | --------- | --------------------- |
| 0     | Foundation: monorepo, CI, Docker Compose, env validation, health API | -         | Done (committed)      |
| 1     | Design system: tokens, `packages/ui`, sprites, Storybook, 3 themes   | -         | Done (pending commit) |
| 2     | DB schema v1, auth, app shell                                        | M0        | Not started           |
| 3     | Problem bank, content pipeline, Monaco editor, admin v0              | M1        | Not started           |
| 4     | Judge (`isolate`), submissions, verdict UI, history/bookmarks/notes  | M2        | Not started           |
| 5     | Hints, editorials, XP/streaks, dashboard, sheets                     | M3        | Not started           |
| 6     | AI interview MVP, resume parse, scorecards                           | M4        | Not started           |
| 7+    | Voice, analytics, planning, SRS, contests, peer, hardening           | M5-M12    | Planned               |

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
