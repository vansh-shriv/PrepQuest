# 15. DevOps, CI/CD, and Observability

Covers **G3** and **G4** plus environments, deployment, runbooks, and costs.

## 1. Environments

| Env            | Purpose         | Infra                                                                                  | Data                        |
| -------------- | --------------- | -------------------------------------------------------------------------------------- | --------------------------- |
| **local**      | Dev             | Docker Compose                                                                         | Seed data                   |
| **preview**    | Per-PR          | Vercel preview (web) + ephemeral API stack (Compose on a runner or Fly/Render preview) | Fresh seed                  |
| **staging**    | Pre-prod        | Same topology as prod, smaller                                                         | Anonymized seed + synthetic |
| **production** | Live demo/users | See section 2                                                                          | Real                        |

## 2. Deployment topologies

### 2.1 MVP/demo (low cost)

- **Web**: Vercel (Next.js).
- **API + gateway + worker + scheduler**: one VM (4 vCPU / 8 GB) or Fly.io/Render services with Docker.
- **Postgres**: managed (Neon/Supabase/RDS) with pgvector.
- **Redis**: managed (Upstash/Redis Cloud) or on-VM for demo.
- **Object storage**: Cloudflare R2 / S3.
- **Judge**: **separate VM** (2 to 4 vCPU, cgroups v2, dedicated, no secrets), 2 to 4 worker slots; firewall egress-deny except Redis/storage/metrics.
- **CDN/TLS**: Cloudflare in front.
- **TURN** (P3): coturn on small VM or managed.

### 2.2 Growth

Kubernetes (or Nomad/ECS): API (HPA), gateway (sticky), job workers, scheduler (single leader), judge node pool (tainted, autoscaled by KEDA on queue depth), managed Postgres with read replica, Redis cluster, Grafana stack.

## 3. Docker Compose (local) services

`web`, `api`, `worker`, `scheduler`, `judge` (privileged, with isolate), `postgres` (pgvector image), `redis`, `s3` (S3-compatible object store), `mailpit` (email), `otel-collector`, `prometheus`, `grafana`, `loki` (optional profile `observability`).

## 4. CI pipeline (GitHub Actions)

```
on: pull_request, push to main
jobs:
 1. setup: pnpm install --frozen-lockfile, turbo cache
 2. lint-typecheck: eslint, tsc, prettier --check, content:validate
 3. unit: vitest (packages/*-core coverage gates: judge-core ≥ 90%, analytics-core ≥ 90%, others ≥ 70%)
 4. integration: services (postgres+pgvector, redis, an S3-compatible server) → API tests (supertest/testcontainers), migrations up/down
 5. judge-sandbox (self-hosted/privileged runner): language smoke tests, malicious program suite, determinism checks
 6. ai-eval (on prompt/orchestrator changes): golden sessions, injection suite, leak suite (uses recorded fixtures by default; live-model run nightly)
 7. build: web, api, worker, judge images (buildx, cache), SBOM, Trivy scan, sign (cosign)
 8. e2e: Playwright against preview stack (auth, solve flow, interview text flow with mocked LLM, scorecard view, a11y axe checks, visual regression on key components in 3 themes)
 9. security: CodeQL, Semgrep, gitleaks, osv-scanner, ZAP baseline (staging nightly)
10. deploy-preview: comment URL on PR
```

- Required checks for merge: 1–4, 7–8 (and 5/6 when paths touched).
- Path filters keep CI fast; Turborepo remote cache.
- Nightly: full judge suite, live AI eval, dependency updates, load smoke.

## 5. CD

| Step           | Detail                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Main → staging | Auto on merge: build images tagged `sha`, run migrations (`db:migrate deploy` in a job with lock), rolling update, smoke tests (health, login, submit AC, interview start with mock) |
| Staging → prod | Git tag `vX.Y.Z` triggers pipeline; manual approval gate; blue/green or rolling with readiness probes; automatic rollback on failed health checks/smoke tests                        |
| Migrations     | Expand/contract; never destructive in same release as code relying on it; backup snapshot before; rollback plan documented per migration                                             |
| Feature flags  | Gradual rollout (voice, peer, contests), kill switch for AI features and judge languages                                                                                             |
| Content        | `content:import` job on content repo changes; versioned; validation gate                                                                                                             |
| Config         | Env-specific, validated at boot, secrets via manager                                                                                                                                 |

## 6. Observability

### 6.1 Logging

- JSON logs via `pino`: `ts, level, msg, requestId, traceId, spanId, userIdHash, route, submissionId, sessionId, jobId, durationMs`.
- Ship to Loki/ELK/Cloud logging; retention 30 days (hot), 90 days (cold) except audit (24 months).
- No PII/resume text/code bodies in logs (hash/size only).

### 6.2 Metrics (Prometheus / OpenTelemetry)

| Domain    | Metrics                                                                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API       | `http_request_duration_seconds{route,method,status}`, error rate, in-flight, rate-limit hits                                                                                           |
| Judge     | `judge_queue_depth{lane}`, `judge_wait_seconds`, `judge_run_seconds{lang}`, `judge_verdict_total{verdict}`, `judge_ie_total`, `judge_slots_busy`, `testdata_cache_hit_ratio`           |
| Realtime  | `ws_connections{ns}`, `ws_events_total`, reconnect rate, replay lag                                                                                                                    |
| Interview | `interview_active_sessions`, `interview_turn_latency_seconds`, `llm_first_token_seconds`, `policy_clamps_total`, `scorecard_generation_seconds`, `scorecard_validation_failures_total` |
| LLM       | `llm_requests_total{model,task,status}`, `llm_tokens_total{type}`, `llm_cost_usd_total`, cache read ratio                                                                              |
| Jobs      | `bull_job_duration_seconds{queue}`, `bull_failed_total`, backlog                                                                                                                       |
| DB        | pool usage, slow queries, replication lag, locks                                                                                                                                       |
| Redis     | memory, evictions, latency                                                                                                                                                             |
| Product   | signups, DAU/WAU, submissions/day, interviews/day, completion rates, streak retention                                                                                                  |

### 6.3 Tracing

OpenTelemetry SDK in web (browser traces for key interactions), API, workers, judge. Context propagated via headers, job data (`traceparent`), and WS event metadata. Exemplars link metrics to traces. Example trace: `POST /submissions` → enqueue → judge claim → compile → tests → ingest → WS emit.

### 6.4 Error tracking

Sentry for web and backend with release/commit tagging, source maps (private), PII scrubbing, user feedback widget on crash screen (dino 404 style).

### 6.5 Product analytics

PostHog (self-host or cloud, EU region): event taxonomy (`problem_viewed`, `submission_completed`, `hint_unlocked`, `interview_started`, `interview_completed`, `scorecard_viewed`, `plan_generated`, `goal_completed`), funnels (onboarding → first AC → first mock), retention cohorts. Respect Do Not Track and cookie consent.

### 6.6 Dashboards (Grafana)

1. **Service overview**: RED metrics per service.
2. **Judge**: queue depth/wait, verdict distribution, IE rate, worker health.
3. **Interview/AI**: concurrent sessions, latency, cost per session, validation failures.
4. **Business**: DAU, activation funnel, retention.
5. **Infra**: nodes, DB, Redis.

### 6.7 Alerts (severity → channel)

| Alert                | Condition                                 | Sev       |
| -------------------- | ----------------------------------------- | --------- |
| Judge canary failing | ≥ 2 consecutive failures                  | P1 (page) |
| Judge IE rate        | > 2% over 5 min                           | P1        |
| Queue wait high      | p95 wait > 30 s for 5 min                 | P2        |
| API error rate       | 5xx > 2% for 5 min                        | P1        |
| API latency          | p95 > 1.5 s for 10 min                    | P2        |
| LLM errors           | > 5% for 5 min                            | P2        |
| First-token latency  | p95 > 3 s for 10 min                      | P2        |
| Scorecard failures   | > 5% validation failures                  | P2        |
| DB                   | connections > 85%, replication lag > 30 s | P2        |
| Disk                 | > 80%                                     | P3        |
| Cost                 | daily LLM spend > budget × 1.5            | P2        |
| Auth anomalies       | login failure spike                       | P2        |
| Cert expiry          | < 14 days                                 | P3        |

### 6.8 Health and status

`/healthz` (process), `/readyz` (DB, Redis, storage), judge self-test canary job each minute, public `/status` page (judge wait, AI availability).

## 7. Runbooks (store in `docs/runbooks/`)

- Judge backlog / slow verdicts.
- Judge worker unhealthy (drain, replace).
- LLM provider outage (switch model, enable degraded mode).
- Redis failover / data loss.
- DB migration rollback.
- Suspected sandbox escape (isolate nodes, rotate credentials, forensic capture).
- Mass rejudge procedure.
- Leaked secret rotation.
- GDPR/DPDP deletion request handling.

## 8. Backups and DR

- Postgres: PITR (WAL archiving), daily snapshots, 14-day retention (30 for prod).
- Object storage: versioning + lifecycle, cross-region copy optional.
- Redis: AOF/RDB for queues (job loss tolerated, resubmittable), not authoritative.
- Restore drill monthly; documented RPO 15 min, RTO 2 h.

## 9. Cost estimate (MVP demo, monthly, approximate)

| Item                                                                                            | Cost        |
| ----------------------------------------------------------------------------------------------- | ----------- |
| Vercel hobby/pro                                                                                | $0 to $20   |
| API VM (4 vCPU/8 GB)                                                                            | $20 to $40  |
| Judge VM (4 vCPU)                                                                               | $20 to $40  |
| Managed Postgres                                                                                | $0 to $25   |
| Redis                                                                                           | $0 to $10   |
| R2/S3                                                                                           | < $5        |
| LLM (50 interviews/week @ ~$0.15)                                                               | ~$30 to $50 |
| Monitoring (self-host/free tiers)                                                               | $0 to $20   |
| Total: roughly $70 to $200 depending on usage; use free tiers and student credits for the demo. |

## 10. Release management

- Semantic versioning, changelog from Conventional Commits, release notes in-app ("What's new" window).
- Canary releases for risky features via flags.
- Definition of Done: tests, docs updated, a11y checked, observability added (metrics/logs), feature flag if risky, migration reviewed.

## 11. Deployed demo checklist (G4)

- [ ] Public URL with HTTPS and custom domain.
- [ ] Seeded with ≥ 100 problems, 3 sheets, quizzes, 5 company packs.
- [ ] Demo account (`demo@prepquest.dev`) with realistic history, one completed interview with scorecard.
- [ ] Guest mode for trying a problem without signup (rate-limited).
- [ ] README with architecture diagram, GIFs, setup instructions, live link, tech highlights (sandbox, queue, WebSockets, LLM guardrails).
- [ ] Short walkthrough video (2 to 3 min).
- [ ] Status page and uptime monitor.

### Judge image and CI (as built)

`apps/judge/Dockerfile` builds from the repository root (`docker build -f apps/judge/Dockerfile -t prepquest-judge .`): stage 1 compiles isolate 2.0, stage 2 is `node:20-bookworm-slim` with g++, Python 3, OpenJDK 17, the isolate binary and config (`isolate.conf`), and the built worker. Run it privileged with `JUDGE_SANDBOX=isolate JUDGE_CGROUPS=true`; the entrypoint prepares the cgroup subtree. It needs `REDIS_URL` and read access to the object store, nothing else. CI job `judge-sandbox` builds the image and runs the malicious suite and driver tests in it. Not done yet: a slimmer runtime image (it currently carries the whole workspace), seccomp/AppArmor profiles, read-only root filesystem, image signing, metrics (`judge_*`).
