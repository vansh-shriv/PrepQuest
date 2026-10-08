# PROGRESS

Phase-by-phase build log. Plan source: `docs/18-ROADMAP-AND-SPRINTS.md`. Each phase ends with lint + typecheck + test green, `CLAUDE.md`/docs updated, and a suggested commit message.

| Phase | Scope | Milestone | Status |
| ----- | ----- | --------- | ------ |
| 0 | Foundation: monorepo, CI, Docker Compose, env validation, health API | - | Done (pending commit) |
| 1 | Design system: tokens, `packages/ui`, sprites, Storybook, 3 themes | - | Not started |
| 2 | DB schema v1, auth, app shell | M0 | Not started |
| 3 | Problem bank, content pipeline, Monaco editor, admin v0 | M1 | Not started |
| 4 | Judge (`isolate`), submissions, verdict UI, history/bookmarks/notes | M2 | Not started |
| 5 | Hints, editorials, XP/streaks, dashboard, sheets | M3 | Not started |
| 6 | AI interview MVP, resume parse, scorecards | M4 | Not started |
| 7+ | Voice, analytics, planning, SRS, contests, peer, hardening | M5-M12 | Planned |

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
- Heredocs with some content failed in the Bash tool; use the Write tool for file creation.
