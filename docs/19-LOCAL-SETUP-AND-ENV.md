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

```bash
git clone <repo> prepquest && cd prepquest
corepack enable && pnpm install
cp .env.example .env            # fill secrets (see section 3)
docker compose up -d postgres redis minio mailpit
pnpm db:migrate
pnpm content:validate && pnpm content:import   # imports problems, quizzes, packs
pnpm db:seed                    # demo user, badges, templates
pnpm dev                        # web :3000, api :4000, worker, scheduler
docker compose up -d judge      # judge worker (privileged, isolate)
```

Open `http://localhost:3000`, log in with `demo@prepquest.dev / demo-password` (seeded, local only).

Mailpit UI: `http://localhost:8025` (verification emails). MinIO console: `http://localhost:9001`.

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
JWT_PRIVATE_KEY_PATH=./secrets/jwt_ed25519_private.pem
JWT_PUBLIC_KEY_PATH=./secrets/jwt_ed25519_public.pem
JWT_ACCESS_TTL_SECONDS=900
REFRESH_TTL_DAYS=30
COOKIE_DOMAIN=localhost
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# --- Storage ---
S3_ENDPOINT=http://localhost:9000
S3_REGION=auto
S3_BUCKET=prepquest
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_FORCE_PATH_STYLE=true

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
EMBEDDING_PROVIDER=             # provider key or "local"
EMBEDDING_DIM=1024

# --- Judge ---
JUDGE_WORKER_SLOTS=2
JUDGE_TESTDATA_CACHE_DIR=/var/cache/prepquest/tests
JUDGE_TESTDATA_CACHE_GB=5
JUDGE_RESULT_STREAM=judge:results
ISOLATE_BIN=/usr/local/bin/isolate

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
FF_VOICE=false
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

`infra/docker/judge.Dockerfile` builds an image with: compilers (g++, OpenJDK 17, Python 3.11), `isolate` built from source, the judge worker (Node). Run:

```bash
docker compose up -d judge
docker compose exec judge isolate --version
pnpm judge:selftest          # runs canary (AC + TLE + MLE + CE programs)
pnpm judge:malicious         # runs malicious suite (needs privileged container)
```

Compose service snippet:

```yaml
judge:
  build: { context: ., dockerfile: infra/docker/judge.Dockerfile }
  privileged: true # needed for isolate cgroups; production uses tuned caps instead
  cgroup: host
  environment: [REDIS_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, JUDGE_WORKER_SLOTS]
  networks: [internal] # no DB access; no internet
  read_only: true
  tmpfs: ["/var/local/lib/isolate:size=1g,exec", "/tmp:size=256m"]
```

On cgroup v1 hosts, enable cgroup v2 (`systemd.unified_cgroup_hierarchy=1`) or run the judge on a Linux VM.

## 5. Useful scripts

```
pnpm dev:web | dev:api | dev:worker | dev:scheduler
pnpm test | test:unit | test:int | test:e2e | test:judge | test:ai-eval
pnpm lint | typecheck | format
pnpm db:migrate | db:reset | db:seed | db:studio
pnpm content:validate | content:import | content:new-problem <slug>   # scaffolds a problem folder
pnpm problem:validate <slug>    # run reference, validators, mutants for one problem locally
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
- `FAKE_JUDGE=true`: API returns scripted verdicts without sandbox (UI work on non-Linux hosts).
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
- [ ] Renovate config, gitleaks config, commit lint
