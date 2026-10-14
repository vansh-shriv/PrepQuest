# 19. Local Setup and Environment

## 1. Prerequisites

| Tool                              | Version     | Notes                                                                                                          |
| --------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| Node.js                           | 20 LTS+     | via nvm/Volta                                                                                                  |
| pnpm                              | 9+          | `corepack enable`                                                                                              |
| Docker + Compose                  | recent      | Linux host or WSL2/Docker Desktop                                                                              |
| Git                               | any         |                                                                                                                |
| (Judge dev) Linux with cgroups v2 | kernel 5.x+ | Required for `isolate`; on macOS/Windows run the judge container inside Docker Desktop's Linux VM (privileged) |
| Claude API key                    |             | For interviews and evaluation (or run `LLM_MODE=mock`)                                                         |

## 2. First run

> Built so far: Docker services, `pnpm db:migrate`, `pnpm db:seed`, `pnpm content:*`, `pnpm dev`, tests and e2e (below). `pnpm dev` also starts the judge worker (development process sandbox); the real `isolate` sandbox runs in a container (section 4). Postgres is published on host port **5433** (a native Postgres often owns 5432). The API generates dev JWT keys into `secrets/` on first start. Git hooks (Husky) install on `pnpm install`: staged files are formatted and linted, and commit messages must follow Conventional Commits.

```bash
git clone <repo> prepquest && cd prepquest
corepack enable && pnpm install
cp .env.example .env            # fill secrets (see section 3)
docker compose up -d postgres redis mailpit     # add `s3` only if you set STORAGE_DRIVER=s3
pnpm db:migrate
pnpm db:seed                    # tags + demo player, content editor and reviewer (password: demo-password)
pnpm content:validate && pnpm content:import --publish   # imports the 20 problems and the sheet (needs tags, so seed first)
pnpm dev                        # web :3000, api :4000, judge worker (JUDGE_SANDBOX=process)
# later phases: worker, scheduler. The isolate judge: docker compose --profile judge up -d --build judge
```

Open `http://localhost:3000`, log in with `demo@prepquest.dev / demo-password` (seeded, local only). `editor@prepquest.dev` (content editor) and `reviewer@prepquest.dev` (reviewer) use the same password and open the Admin section. Python 3.9+ must be on PATH (or set `PYTHON`) for `content:build-tests` and `content:verify`. To run code locally you also need Redis (compose) and, for C++/Java solutions, `g++` and a JDK on PATH (Python is enough to try the app). The dev judge runs submitted code in a plain child process: fine for your own code, never for strangers'.

Mailpit UI: `http://localhost:8025` (verification emails). Hidden test data is stored under `.data/objects` (gitignored) by default; `docker compose up -d s3` starts a local S3-compatible server on `:9000` (Zenko CloudServer; MinIO's community images are no longer published) for `STORAGE_DRIVER=s3`.

### Tests

```bash
docker compose up -d postgres            # API integration tests use a separate prepquest_test database (created and reset automatically)
pnpm test                                # unit + API integration
docker compose up -d postgres redis mailpit && pnpm db:seed && pnpm content:import --publish && pnpm build && pnpm test:e2e   # Playwright against real web + API + Mailpit, uses installed Chrome
pnpm content:validate && pnpm content:verify   # content gates (CI runs these too)
```
Override the test database with `TEST_DATABASE_URL`. CI runs the same suites (the e2e job is new and only verified locally). The e2e API server is started with `BREACH_CHECK=off` and generous rate limits so the suite is offline-safe.

## 3. Environment variables (`.env.example`)

```bash
# --- App ---
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
CORS_ORIGINS=http://localhost:3000

# --- Database / cache ---
DATABASE_URL=postgresql://prepquest:prepquest@localhost:5433/prepquest
REDIS_URL=redis://localhost:6379

# --- Auth ---
JWT_PRIVATE_KEY_PATH=../../secrets/jwt_ed25519_private.pem   # relative to apps/api; auto-generated in dev if missing
JWT_PUBLIC_KEY_PATH=../../secrets/jwt_ed25519_public.pem
JWT_ACCESS_TTL_SECONDS=900
REFRESH_TTL_DAYS=30
COOKIE_DOMAIN=localhost
TRUST_PROXY=false                   # true behind a reverse proxy/CDN so IP rate limits see real client IPs
DATA_ENCRYPTION_KEY=                # base64, 32 bytes; encrypts TOTP seeds. REQUIRED in production
                                    #   generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
BREACH_CHECK=on                     # on | off: reject passwords found in breach data (HIBP, k-anonymity)

# OAuth: a provider is enabled when both values are set.
# Redirect URI to register with the provider: ${API_URL}/v1/auth/oauth/<google|github>/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# --- Rate limits (per minute unless noted) ---
RL_ANON_PER_MIN=120                 # anonymous, per IP
RL_USER_PER_MIN=600                 # signed in, per user
RL_AUTH_PER_MIN=20                  # credential endpoints per IP (refresh gets 6x)
RL_LOGIN_PER_10MIN=10               # login attempts per IP+email per 10 minutes
RL_FORGOT_PER_HOUR=3                # password-reset emails per address per hour

# --- Storage (hidden test data, uploads) ---
STORAGE_DRIVER=fs                   # fs | s3
STORAGE_FS_DIR=../../.data/objects  # relative to the process working directory (apps/api, packages/content)
S3_ENDPOINT=http://localhost:9000   # `docker compose up -d s3`
S3_REGION=us-east-1
S3_BUCKET=prepquest
S3_ACCESS_KEY=prepquest
S3_SECRET_KEY=prepquest-secret
S3_FORCE_PATH_STYLE=true

# --- Content workflow ---
ALLOW_SELF_PUBLISH=false            # true lets authors publish their own problems

# --- Email ---
SMTP_URL=smtp://localhost:1025
EMAIL_FROM="PrepQuest <no-reply@prepquest.local>"

# --- LLM ---
LLM_MODE=live                      # live | mock | record
ANTHROPIC_API_KEY=
LLM_MODEL_INTERVIEWER=claude-sonnet-5-5
LLM_MODEL_EVALUATOR=claude-sonnet-5-5
LLM_MODEL_LIGHT=claude-haiku-5-5
LLM_DAILY_TOKEN_BUDGET_PER_USER=400000
LLM_SESSION_TOKEN_CAP=250000
LLM_MODEL_FALLBACK=claude-haiku-5-5  # used when the primary model fails or declines
RL_INTERVIEWS_PER_HOUR=5
RL_INTERVIEWS_PER_DAY=15
RL_RESUMES_PER_DAY=10
EMBEDDING_PROVIDER=             # provider key or "local"
EMBEDDING_DIM=1024

# --- Judge worker (apps/judge). It reads only Redis and the object store: no database, JWT or SMTP settings ---
JUDGE_SANDBOX=process            # process (dev only, refused when NODE_ENV=production) | isolate (Linux container)
JUDGE_CONCURRENCY=2              # concurrent submissions; runs get half as many slots on top
JUDGE_CGROUPS=false              # true in the container: exact memory limits and peak usage via cgroup v2
ISOLATE_BIN=isolate
# process sandbox only: PYTHON_BIN, CXX_BIN, JAVA_HOME pick the interpreter/compilers on this machine

# --- Rate limits (overridable at runtime via admin config) ---
RL_SUBMIT_PER_MIN=10
RL_SUBMIT_PER_DAY=200
RL_RUN_PER_MIN=30

# --- Observability ---
LOG_LEVEL=debug
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
SENTRY_DSN=
POSTHOG_KEY=
POSTHOG_HOST=

# --- Feature flags (defaults) ---
FF_VOICE=true                       # voice interviews (browser speech); false hides them
FF_PEER=false
FF_CONTESTS=false
FF_CANVAS=false
```

Generate JWT keys:

```bash
mkdir -p secrets && openssl genpkey -algorithm ed25519 -out secrets/jwt_ed25519_private.pem
openssl pkey -in secrets/jwt_ed25519_private.pem -pubout -out secrets/jwt_ed25519_public.pem
```

Never commit `.env` or `secrets/` (gitignored; gitleaks pre-commit).

## 4. Judge dev setup

Two ways to run the judge worker (both consume the same BullMQ queues and write to the same results stream):

1. **Process sandbox** (default with `pnpm dev`): `JUDGE_SANDBOX=process`. A temp directory plus a child process with a wall-clock limit and an output cap. No memory limit, no filesystem or network isolation. For your own code only.
2. **isolate** (the real thing, Linux only, so on Windows/macOS inside Docker Desktop's Linux VM):

```bash
docker compose --profile judge up -d --build judge     # apps/judge/Dockerfile: isolate 2.0 built from source, g++, Python 3, OpenJDK 17
docker compose --profile judge logs judge              # {"msg":"judge ready","sandbox":"isolate",...}
```

The container is privileged (isolate needs namespaces and cgroups); `docker-entrypoint.sh` prepares a cgroup v2 subtree for it. It reaches Redis by service name and reads hidden tests from `./.data/objects` (mounted read-only); with `STORAGE_DRIVER=s3` point it at the `s3` service. Stop your local `pnpm dev` judge first, or both will pull jobs.

Run the malicious-program suite and the language driver tests under isolate:

```bash
docker build -f apps/judge/Dockerfile -t prepquest-judge .
docker run --rm --privileged -e JUDGE_ISOLATE_TESTS=1 -e JUDGE_CGROUPS=true prepquest-judge \
  sh -c "cd apps/judge && pnpm exec vitest run src/sandbox src/drivers.test.ts src/pipeline.test.ts"
# iterate without rebuilding: add  -v "$PWD/apps/judge/src:/app/apps/judge/src:ro"
```

E2E against the isolate worker: start the container, then `E2E_EXTERNAL_JUDGE=1 pnpm test:e2e` (otherwise Playwright starts its own process-sandbox worker).

On cgroup v1 hosts, enable cgroup v2 (`systemd.unified_cgroup_hierarchy=1`) or run the judge on a Linux VM. If cgroups can't be delegated, set `JUDGE_CGROUPS=false`: limits fall back to rlimits (memory is then address space, which is coarser).

## 5. Useful scripts

```
pnpm --filter @prepquest/judge dev          # the judge worker alone
pnpm dev:web | dev:api | dev:worker | dev:scheduler   (planned shortcuts; today use pnpm dev or --filter)
pnpm test | test:e2e | (later: test:ai-eval)
pnpm lint | typecheck | format
pnpm db:generate | db:migrate | db:reset | db:seed | db:studio   # generate = diff the Drizzle schema into a new migration
pnpm --filter @prepquest/api db:purge   # hard-delete accounts past the 14-day deletion grace period (daily)
pnpm content:new <slug>                       # scaffold a problem folder
pnpm content:build-tests [slug]               # generate tests/*.in|out from examples + cases.json + gen.py via the reference solution
pnpm content:validate [slug]                  # schemas, tag taxonomy, test format and counts (no code execution)
pnpm content:verify [slug]                    # re-run reference solutions against the committed tests
pnpm content:import [--publish] [slug]        # idempotent upsert into the database (new version only when content changed); also syncs hints and editorials
pnpm content:judge [slug]                     # references, editorial code and mutants through the real judge (needs python; g++/javac when present)
pnpm sprites:build | storybook
pnpm llm:record                 # record LLM fixtures for tests
```

## 6. Dev workflow

1. Branch from `main`: `feat/<short-name>`.
2. Write tests first for core logic (analytics-core, judge-core).
3. Run `pnpm lint && pnpm typecheck && pnpm test` before pushing.
4. Open PR â†’ preview deploy + CI â†’ review checklist â†’ squash merge.
5. After merge, staging auto-deploys; verify smoke checklist.

## 7. Mock modes for fast development

- `LLM_MODE=mock`: deterministic scripted interviewer, scorecard from fixture (no API key needed).
- The judge needs no mock: `JUDGE_SANDBOX=process` runs real code with real verdicts on any OS (`FAKE_JUDGE` was removed).
- `FAKE_STT=true`: use transcript fixtures for voice flows.
- Time travel: `TEST_CLOCK_ISO=2026-11-01T09:00:00Z` for streak/SRS/plan testing.

## 8. Troubleshooting

| Symptom                                | Fix                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `isolate: Cannot create control group` | cgroups v2 not delegated; run container privileged with `cgroup: host`, or enable unified hierarchy              |
| Java MLE on trivial programs           | Increase memory base for Java (JVM overhead) or reduce `-Xss`; verify `-Xmx` equals problem limit minus overhead |
| Monaco workers blocked by CSP          | Add worker blob source to CSP in dev config (see doc 14)                                                         |
| WebSocket drops behind proxy           | Enable sticky sessions and upgrade headers; check idle timeouts > 60 s                                           |
| pgvector extension missing             | Use `pgvector/pgvector` image or `CREATE EXTENSION vector;` as superuser                                         |
| Voice not working                      | Use Chrome/Edge/Safari over HTTPS or localhost; check mic permission; fall back to text mode                     |
| Slow first judge run                   | Warm test-data cache; pre-pull images; check Java startup flags                                                  |

## 9. Production configuration notes

- Separate secrets per environment, managed in a secret manager.
- Judge nodes: no DB/LLM secrets; egress deny-all except Redis/storage/metrics.
- Replace `privileged: true` with minimal capabilities + seccomp/AppArmor profiles (doc 12, doc 14).
- Enable `FF_*` flags progressively; keep kill switches for AI and judge languages.

## 10. Repo bootstrap checklist

- [ ] `README.md` (link to docs folder), `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`
- [ ] `.env.example`, `.gitignore`, `.nvmrc`, `.editorconfig`
- [ ] `docs/` (these 20 files) and `docs/adr/`
- [ ] Issue/PR templates, CODEOWNERS
- [ ] GitHub Actions workflows (ci, deploy, nightly)
- [x] Commit lint + lint-staged (Husky)
- [ ] Renovate config, gitleaks config

## Phase 8 notes

`pnpm content:import --publish` now also imports the question bank (72 questions) and the company packs (5). After changing `packages/content` or `packages/shared` exports, rebuild them (`pnpm --filter @prepquest/content build`, `pnpm --filter @prepquest/shared build`) before API tests: the API reads their `dist/`. Run Playwright one spec file at a time (`pnpm exec playwright test e2e/interview-rounds.spec.ts` in `apps/web`, after `pnpm build`).

Phase 9: the nightly job runs inside the API process (`main.ts`, every 10 minutes). `pnpm db:migrate` applies migrations 0015 and 0016. API tests for planning pin the clock with `t.app.ai.now`; tests that count "solved today" use the real clock.

Phase 10: `pnpm db:migrate` applies migrations 0017 to 0019 (tables, triggers, `review_cap`). After pulling, run `pnpm content:import --publish` so the dev database gets the quizzes and roadmaps. API tests import them with `seedLearning` from `src/test/content.ts`.

Phase 11: `pnpm db:migrate` applies migrations 0020 and 0021; run `pnpm content:import --publish` to load the SQL problems, aptitude items and test templates. SQL runs on `sql.js` (WebAssembly, installed by `pnpm install`, no native build or Docker needed). `pnpm build` must have built `@prepquest/sql-runner` before the API or the content CLI runs. API tests for OA pin the clock with `t.app.ai.now` and call `seedLearning` and `seedAssess`; e2e specs need the content imported.

Phase 12: `pnpm db:migrate` applies migrations 0022 and 0023 (contests). No new content import is needed: contests are created in the app (`/contests`, or `POST /contests`). API contest tests use the real clock and move windows with SQL; e2e `contests.spec.ts` needs the problems imported.

Phase 13: `pnpm db:migrate` applies migrations 0024 to 0026 (flashcards, shared reports, flashcard limits). Run `pnpm content:import --publish` to load the starter decks. No new environment variables. Shared links use the web origin the learner is on, and the preview image is served by the API (`/v1/r/:token/og.png`), so `NEXT_PUBLIC_API_URL` must be reachable by link-preview crawlers in production. `DATA_ENCRYPTION_KEY` must be 32 bytes in base64 (for example `openssl rand -base64 32`) or empty in development.

Phase 14: `pnpm db:migrate` applies migrations 0027 and 0028 (code reviews, complexity analyses, review strictness, `problems.scale`). Run `pnpm content:import --publish` to load the `scale.json` files. No new environment variables. Code review uses the evaluator model class; with `LLM_MODE=mock` a deterministic reviewer answers. The complexity check needs a running judge worker; timings from the development process sandbox are noisy, so use the isolate sandbox for realistic confidence.

Phase 15: `pnpm db:migrate` applies migrations 0029 and 0030 (`integrity_flags`, `contest_participants.disqualified_at`). No new environment variables or content. To try it, sign in as `reviewer@prepquest.dev` (seed, no two-factor needed for reviewers), open `/integrity`, enter a contest slug and scan.
