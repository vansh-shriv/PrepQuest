# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Built in phases; see `PROGRESS.md` for status and `docs/18-ROADMAP-AND-SPRINTS.md` for the plan. The `docs/` folder (20 specs) is the source of truth for product, architecture, schema, API and design; update the relevant doc when a decision changes. Start with `docs/README.md` (doc map, feature ID index, vocabulary).

**Implemented:** Phase 0 (monorepo scaffold, `packages/shared` env validation + `AppError`, `apps/api` Fastify app + health routes, Docker Compose infra, CI) and Phase 1 (`packages/ui` pixel design system + Storybook; `apps/web` has the home page and a `/design` component showcase). Everything else in the docs is still planned.

**Phase workflow:** at the end of every phase run lint/typecheck/test, update `CLAUDE.md`, `PROGRESS.md` and affected docs, then propose a commit message. Do not commit unless asked. Reference images in `refrence/` plus `docs/07-DESIGN-SYSTEM-PIXEL-UI.md` drive the UI (redraw sprites originally; don't copy the reference artwork).

PrepQuest = placement-prep platform: DSA practice with a real judge, AI mock interviews (resume/company-aware), structured evaluation, analytics + adaptive study plan, all with a 90s pixel-game UI.

## Commands (work today)

```
pnpm install
cp .env.example .env
docker compose up -d postgres redis      # also minio, mailpit when needed
pnpm dev            # turbo: api :4000, web :3000
pnpm lint | typecheck | test | build | format | format:check
pnpm --filter @prepquest/ui storybook                        # component workshop on :6006
pnpm --filter @prepquest/shared test                         # one package
pnpm --filter @prepquest/api exec vitest run -t "liveness"   # one test by name
```

Requirements: Node 20+, pnpm 10. `.env` is read by the API dev script via `tsx --env-file-if-exists`. `turbo` tasks depend on `^build`, so `@prepquest/shared` is built (to `dist/`) before dependents lint/typecheck/test.

Planned (not yet existing): `pnpm db:*`, `content:*`, `judge:*`, `test:e2e`, `storybook` (see docs 09 §6, 19 §5).

Mock modes for dev without keys/sandbox: `LLM_MODE=mock`, `FAKE_JUDGE=true`, `FAKE_STT=true`, `TEST_CLOCK_ISO=<iso>`.

## Layout

```
apps/api       Fastify; src/app.ts (buildApp), src/modules/<module>/routes.ts, src/main.ts (wiring, graceful shutdown)
apps/web       Next.js App Router (src/app)
packages/config  shared tsconfig presets (base/node/next)
packages/shared  Zod env schema, AppError (ESM, built with tsc to dist; imports use .js extensions)
packages/ui    pixel design system, consumed as source (no build): src/styles (tokens/base/components CSS, `pq-` prefix),
               src/components, src/sprites/art.ts (pixel-grid sprites), .storybook, src/stories
docs/          specs; PROGRESS.md tracks phases
```

Later phases add `apps/{worker,judge,scheduler}` and `packages/{ui,db,prompts,judge-core,analytics-core}` per doc 09 §2.

## Architecture (big picture, from docs)

- **Modular monolith API** (Fastify + Zod, Prisma/Postgres 16 + pgvector). Modules (`routes/service/repo/schemas`) talk only through service interfaces, never cross-module repos. Extract services only for the judge and AI orchestrator. API is `/v1`; errors are `AppError` mapped centrally to `{ error: { code, message, details, requestId } }`.
- **Judge**: submissions are enqueued (BullMQ/Redis) and executed by judge workers using `isolate` in hardened Linux containers. Judge workers are the only code that runs untrusted code and have **no DB credentials and no network**. Progress streams via Redis pub/sub -> WebSocket gateway (docs 08 §4.1, 12, 14). `isolate` is Linux-only: on Windows run it in a privileged Docker container (WSL2).
- **Interview engine**: WebSocket gateway -> session orchestrator (state machine, stateless between turns) -> LLM gateway (single entry for all Claude calls: model routing, streaming, budgets, PII-redacted logging, schema-validated JSON with repair loop). Model names come from env config, never hard-coded. Scorecards are generated async with structured JSON that must cite evidence (docs 08, 13).
- **Pure core logic** (scoring, SRS, readiness, planner, verdicts) lives in `packages/*-core` with no I/O. Study plans are deterministic; LLM only for narrative (ADR-007).
- Server-authoritative timers/scoring/unlocks; Zod contracts shared between web, API, workers; trace IDs propagate through HTTP, queues, WS, LLM calls.

## Doc conventions

- Stable feature IDs (D1-D7, I1-I8, E1-E5, A1-A5, P1-P4, C1-C3, U1-U5, X1-X7, G1-G4) are used across schema, API, tests, roadmap. Keep them consistent.
- RFC 2119 MUST/SHOULD/MAY; phase tags `[MVP]`, `[P2]`, `[P3]`; acceptance criteria should be testable.
- A change in one doc (e.g. a table in 10) usually requires updates in others (11 API, 16 tests).

## Code conventions

- TS `strict` (+ `noUncheckedIndexedAccess`), no uncommented `any` (lint-enforced), `consistent-type-imports`; kebab-case files, PascalCase components, plural snake_case tables, UUID v7 PKs, forward-only migrations (expand/contract for destructive changes).
- Frontend: all colors/fonts via design tokens (doc 07), never hard-coded hex; feature folders; no business logic in components; `jsx-a11y` on. Use `@prepquest/ui` components; for a link that looks like a button use `buttonClasses()` (never wrap a button in a link). Pixel look: `.pq-box` (notched outline via box-shadows) + `.pq-lift` (hard `drop-shadow`), see doc 07 §13. Tailwind v4 is CSS-first in `apps/web/src/app/globals.css`. Pixel fonts for chrome only; long text uses the read font.
- Verify UI visually: `pnpm build && npx next start` in `apps/web`, then headless Chrome `--screenshot` of `/design` (Chrome is at `C:\Program Files\Google\Chrome\Application\chrome.exe`).
- API: cursor pagination, idempotency keys on expensive POSTs, OpenAPI from Zod.
- Conventional Commits, trunk-based, squash merge. Never commit `.env` or `secrets/`.
- Use TypeScript `~5.9` (typescript-eslint doesn't support TS 7). `docs/` and `CLAUDE.md` are prettier-ignored.
