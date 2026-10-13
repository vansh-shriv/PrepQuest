# 09. Tech Stack and Project Structure

## 1. Stack summary

| Layer            | Choice                                                              | Why                                                               |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Language         | TypeScript everywhere (Node 20+)                                    | One language, shared types; matches existing TS + Tailwind skills |
| Frontend         | Next.js 14+ (App Router), React 18, Tailwind CSS                    | SSR for public pages, great DX, deploys on Vercel                 |
| UI state         | TanStack Query, Zustand                                             | Server vs local state separation                                  |
| Forms/validation | React Hook Form + Zod                                               | Shared schemas with API                                           |
| Editor           | Monaco (`@monaco-editor/react`)                                     | VS Code-grade editing                                             |
| Collaboration    | Yjs + y-monaco, y-websocket                                         | Peer shared editor (X1)                                           |
| Whiteboard       | tldraw (custom pixel shapes)                                        | System design canvas (C3)                                         |
| Charts           | visx or Recharts with custom pixel shapes                           | Pixel-style charts                                                |
| Markdown         | `react-markdown`, `remark-math`, `rehype-katex`, `rehype-highlight` | Problem statements                                                |
| Backend          | Fastify + TypeScript, Zod type provider                             | Fast, schema-first                                                |
| ORM/DB access    | **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`) on `pg`, raw SQL for analytics (built; see doc 10 §7) | TS schema is the source of truth, typed queries, no codegen step |
| DB               | PostgreSQL 16 + pgvector + pg_trgm                                  | Relational + vectors + fuzzy search                               |
| Cache/Queue      | Redis 7 + BullMQ                                                    | Queues, rate limits, ZSET leaderboards                            |
| Realtime         | Socket.IO (Redis adapter) or `ws`                                   | Interview, submissions, contests                                  |
| Judge            | `isolate` in Docker (Linux cgroups v2)                              | Battle-tested sandbox                                             |
| LLM              | Claude API via SDK (`@anthropic-ai/sdk`)                            | Interview, evaluation                                             |
| Embeddings       | Provider embedding API or local model via worker                    | Resume chunks, question memory                                    |
| File parsing     | `pdf-parse`/`pdfjs`, `mammoth` (docx), optional `unstructured`      | Resume parsing                                                    |
| Voice            | Web Speech API (MVP), streaming STT + TTS provider (P2/P3)          | Voice mode                                                        |
| Auth             | Custom JWT + refresh rotation (or Lucia/Auth.js) with Argon2id      | Control + OAuth                                                   |
| Email            | Resend/SES + React Email                                            | Transactional                                                     |
| Storage          | S3-compatible (R2/MinIO local)                                      | Files                                                             |
| Testing          | Vitest, Supertest, Playwright, k6, Testcontainers                   | Full pyramid                                                      |
| Lint/format      | ESLint, Prettier, TypeScript strict, Husky + lint-staged            | Quality gates                                                     |
| Monorepo         | pnpm workspaces + Turborepo                                         | Shared packages                                                   |
| CI/CD            | GitHub Actions                                                      | Build/test/deploy                                                 |
| Infra            | Docker, Docker Compose (dev/demo), Terraform optional               | Reproducible                                                      |
| Observability    | OpenTelemetry, Prometheus, Grafana, Loki, Sentry, PostHog           | See doc 15                                                        |

## 2. Monorepo layout

```
prepquest/
├─ apps/
│  ├─ web/                      # Next.js frontend
│  │  ├─ src/
│  │  │  ├─ app/                # routes (App Router)
│  │  │  │  ├─ (marketing)/
│  │  │  │  ├─ (app)/dashboard, problems, interview, quizzes, plan, analytics, ...
│  │  │  │  ├─ admin/
│  │  │  │  └─ r/[token]/       # shared reports
│  │  │  ├─ components/         # feature components
│  │  │  ├─ features/           # feature modules (hooks, api clients, stores)
│  │  │  ├─ lib/                # utils, ws client, a11y helpers
│  │  │  └─ styles/             # tokens.css, globals.css
│  │  └─ public/sprites/        # pixel art
│  ├─ api/                      # Fastify API
│  │  └─ src/
│  │     ├─ modules/<module>/   # routes.ts, service.ts, repo.ts, schemas.ts, tests
│  │     ├─ plugins/            # auth, rate-limit, idempotency, audit, otel
│  │     ├─ realtime/           # gateway namespaces
│  │     ├─ orchestrator/       # interview engine (state machine, prompts)
│  │     ├─ llm/                # LLM gateway, prompt registry, schemas
│  │     └─ main.ts
│  ├─ worker/                   # BullMQ job processors (non-judge)
│  ├─ judge/                    # judge worker (runs in sandbox container)
│  └─ scheduler/                # cron jobs
├─ packages/
│  ├─ ui/                       # pixel design system + Storybook
│  ├─ shared/                   # Zod schemas, types, constants, enums
│  ├─ db/                       # Drizzle schema (src/schema), generated + custom SQL migrations, migrate runner, db/tx helpers, seed data
│  ├─ config/                   # eslint, tsconfig, tailwind presets
│  ├─ prompts/                  # versioned prompt templates + eval fixtures
│  ├─ judge-core/               # verdict logic, checkers, language configs
│  └─ analytics-core/           # mastery, readiness, SRS, planner (pure functions)
├─ content/
│  ├─ problems/<slug>/          # problem.md, meta.json, tests/, solutions/
│  ├─ quizzes/                  # CSV/JSON
│  ├─ company-packs/            # JSON
│  ├─ roadmaps/                 # JSON
│  └─ flashcards/
├─ infra/
│  ├─ docker/                   # Dockerfiles, compose, seccomp profiles
│  ├─ terraform/                # optional
│  ├─ grafana/                  # dashboards
│  └─ k6/                       # load tests
├─ docs/                        # these docs + ADRs
├─ .github/workflows/
├─ turbo.json, pnpm-workspace.yaml, package.json
└─ README.md
```

## 3. Conventions

### Code

- TypeScript `strict: true`, no `any` without comment; exhaustive switch checks.
- Module boundaries: modules call each other only via service interfaces; no cross-module repo access.
- Pure core logic (scoring, SRS, readiness, planner, verdict aggregation) lives in `packages/*-core` with no I/O, fully unit-tested.
- Errors: typed `AppError(code, httpStatus, details)`, mapped centrally.
- Validation at every boundary with Zod; DB writes through repositories.
- Config via env validated at startup (`zod-env`); no secrets in code.

### Naming and git

- Files `kebab-case`, React components `PascalCase`, DB tables `snake_case` plural.
- Conventional Commits (`feat:`, `fix:`, `chore:`), PR template with checklist (tests, docs, migrations).
- Trunk-based with short-lived branches; squash merge; semantic version tags for releases.

### API

- REST resource-oriented, versioned `/v1`, OpenAPI generated from Zod, cursor pagination, idempotency keys on POSTs that create expensive jobs.

### Frontend

- Feature folders; colocate hooks and components; no business logic in components.
- All colors/fonts through tokens (doc 07), never hard-coded hex in components.
- Accessibility lint rules (`jsx-a11y`) enabled.

### Database

- Migrations are forward-only, reviewed; destructive changes use expand/contract pattern.
- UUID v7 primary keys (time-sortable); `created_at`, `updated_at` on all tables; soft delete where history matters.

## 4. Key libraries by feature (quick map)

| Feature        | Libraries/tools                                                  |
| -------------- | ---------------------------------------------------------------- |
| D2 editor      | monaco, vim mode plugin                                          |
| D3 judge       | isolate, Docker, BullMQ                                          |
| D7 contests    | Redis ZSET, cron                                                 |
| I3 resume      | pdf-parse, mammoth, LLM extraction, pgvector                     |
| I5 voice       | Web Speech API, WebAudio, later Deepgram/Whisper-streaming + TTS |
| I6 live coding | debounced Monaco change events, diff-match-patch                 |
| E4 speech      | word timestamps, regex + small LLM for hedging classification    |
| A4/P1          | packages/analytics-core (pure TS)                                |
| C3 canvas      | tldraw                                                           |
| X1 peer        | WebRTC, Yjs, coturn                                              |
| X2 plagiarism  | tree-sitter (AST), winnowing fingerprints                        |
| X4 complexity  | judge runner + regression in TS (simple-statistics)              |
| U5 sharing     | satori / @vercel/og for OG images                                |
| X6 flashcards  | Dexie (IndexedDB), Workbox service worker                        |

## 5. Version pinning and tooling

- Node via `.nvmrc`/Volta, pnpm via `packageManager` field, Renovate/Dependabot weekly.
- Lockfile committed; CI uses `--frozen-lockfile`.

## 6. Build and run scripts (root `package.json`)

```
pnpm dev            # turbo run dev (web, api, worker, judge-dev)
pnpm build          # turbo run build
pnpm lint | typecheck | test | test:e2e
pnpm db:migrate | db:seed | db:studio
pnpm content:validate   # validate problems, quizzes, packs against schemas
pnpm content:import     # import content/ into DB
pnpm sprites:build      # PNG -> SVG rect sprites + manifest
pnpm storybook
```

## 7. Implementation notes (as built through Phase 3)

- **New packages:** `packages/storage` (`ObjectStore` interface with a filesystem implementation for dev/tests and an S3 implementation, same behavioural contract tests; keys are validated, no traversal) and `packages/content` (problem loader, validator, canonical I/O codec, starter-code generator, Python reference harness, test builder, versioned importer, `content:*` CLI). `apps/api` depends on both: the admin module reuses the validator and importer helpers so uploads and the CLI enforce identical rules.
- **Content lives in `content/`** (`problems/<slug>/`, `sheets/*.json`, `_lib/gentools.py` for test generators). Generated tests are committed.
- **Frontend libraries added:** `@monaco-editor/react` (Monaco is loaded from a CDN at runtime; a plain textarea takes over if it can't load), `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` (no raw HTML is ever rendered), `qrcode` (2FA setup), `fflate` (e2e zip building). API: `@fastify/multipart`, `fflate` (zip reading with size checks before inflating).
- **Object storage dev default** is the `fs` driver under `.data/objects`; production uses S3/R2.

### Phase 4 additions

- **`packages/judge-core`**: language table, driver generators (Python, C++, Java), checkers, verdict mapping and the job pipeline over a `Sandbox` interface (no I/O of its own). Shared queue names and the results-stream name live here.
- **`apps/judge`**: the worker. BullMQ 6 consumers, `IsolateSandbox` and `ProcessSandbox`, a results publisher, its own minimal config. It depends on judge-core and storage only (no `@prepquest/db`, no `@prepquest/shared`), which is what keeps database credentials off judge hosts. Ships as `apps/judge/Dockerfile` (isolate built from source, g++, Python, OpenJDK 17).
- **API**: `modules/submissions` (service, routes, `queue.ts` with BullMQ and in-memory implementations, `ingest.ts` with the stream consumer) and `modules/library` (bookmarks, notes). New dependency `bullmq`.
- **Web**: `features/submissions/use-judge.ts` (send + poll), `components/problems/{ResultPanel,NotesPanel,SubmissionHistory}`, `components/library/*`, pages `/submissions`, `/submissions/[id]`, `/notes`. `packages/ui` gains `VerdictBanner` and eight verdict sprites, and `Tabs` can be controlled.

### Phase 5 additions

- **`packages/analytics-core`** (pure, no I/O, no clock): XP rules and the level curve, timezone-aware streaks with a grace day, hint and editorial unlock rules, topic mastery and weak-area detection v1, recommendations, badge rules. The API applies it (`modules/progress`, `modules/practice`) and the web app imports the badge catalog and display helpers.
- **API:** `modules/practice` (hints, editorial, give up, self-rating), `modules/progress` (XP ledger, badges, dashboard; `award.ts` runs inside the judge-result transaction), admin hint and editorial editors.
- **Content tooling:** `editorial.json` and `hints/` per problem, known-wrong `solutions/mutants/*.py`, and `pnpm content:judge` (`apps/judge/src/content-judge.ts`) that runs references, editorial code and mutants through the real judge pipeline.
- **UI:** `ActivityHeatmap`, plant and sunflower growth sprites in `packages/ui`; `HintsPanel`, `EditorialPanel`, rewards in `ResultPanel`, `components/dashboard/Dashboard`, admin `LearningTabs`.

### As built (Phase 13)

X6 uses a `localStorage` queue and cache with an injected storage interface instead of Dexie and Workbox (no service worker yet). U5 draws the preview image with a small dependency-free PNG renderer instead of satori / `@vercel/og`; PDF export is the browser's print dialog.
