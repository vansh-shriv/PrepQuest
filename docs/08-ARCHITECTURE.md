# 08. System Architecture

## 1. Principles

1. **Modular monolith first**: one API codebase with strict module boundaries; extract services only where scaling or isolation demands (judge, AI orchestrator).
2. **Untrusted code is isolated**: judge workers are the only components that run user code; they have no DB credentials and no network.
3. **Everything async that can be**: slow work goes to queues; the UI streams progress.
4. **Server-authoritative state** for timers, scoring, unlock rules, contests.
5. **Typed contracts** (shared Zod schemas / OpenAPI) between web, API, workers.
6. **Observable by default**: trace IDs flow through HTTP, queue jobs, WS events, LLM calls.

## 2. High-level diagram

```
                        +-----------------------------+
                        |        Browser (Next.js)     |
                        |  React, Monaco, Tailwind     |
                        |  WebAudio/STT, tldraw, Yjs   |
                        +--+------------+-----------+--+
                           |HTTPS/REST |WebSocket  |WebRTC (peer)
                           v           v           v
+---------+        +-------+-----------+------+   +--------------+
|  CDN    |<------>|  Edge / Reverse proxy    |   | TURN/STUN    |
| (static)|        |  (Caddy/Nginx, TLS)      |   +--------------+
+---------+        +-------+-----------+------+
                           |           |
              +------------v--+     +--v--------------------+
              |  API (Fastify) |     |  Realtime Gateway     |
              |  modules:      |     |  (WS: interview, subs,|
              |  auth, problems|     |   contests, peer)     |
              |  submissions   |     +--+---------+----------+
              |  interviews    |        |         |
              |  analytics ... |   Redis pub/sub  |
              +--+---+----+----+        |         |
                 |   |    |       +-----v---+  +--v--------------+
                 |   |    |       | Session |  | Presence/Room   |
                 |   |    |       | Orchestr|  | state (Redis)   |
                 |   |    |       +----+----+  +-----------------+
                 |   |    |            |
                 |   |    +------------v------------------+
                 |   |                 | LLM Gateway       |
                 |   |                 | (Claude API,      |
                 |   |                 |  caching, limits) |
                 |   |                 +-------------------+
        +--------v+ +v------------+  +-------------------+
        |Postgres | | Redis       |  | Object storage    |
        |+pgvector| | cache, queue|  | (S3/R2/MinIO):    |
        |         | | rate limits |  | resumes, audio,   |
        +---------+ +------+------+  | exports, OG imgs  |
                            |         +-------------------+
                   BullMQ queues
        +-------------------+---------------------+
        |                   |                     |
+-------v------+   +--------v-------+    +--------v--------+
| Judge workers|   | Job workers    |    | Scheduler (cron)|
| (isolate in  |   | resume parse,  |    | nightly rollups,|
| hardened ctr)|   | scorecards,    |    | SRS, re-plan,   |
| no network   |   | embeddings,    |    | cleanup         |
+--------------+   | analytics, OG  |    +-----------------+
                   +----------------+
```

## 3. Components

### 3.1 Web app (Next.js App Router, TypeScript)

- Server components for SEO pages (landing, public profiles, shared reports).
- Client components for editor, interview room, charts.
- State: TanStack Query for server state; Zustand for local UI state; WebSocket client wrapper with auto-reconnect and event replay.
- Feature modules mirror backend modules.

### 3.2 API service (Fastify + TypeScript)

Modules (each with routes, service, repository, schemas, tests):
`auth`, `users`, `problems`, `sheets`, `submissions`, `hints`, `editorials`, `srs`, `contests`, `quizzes`, `sql`, `oa`, `interviews`, `resumes`, `evaluation`, `analytics`, `planning`, `roadmaps`, `tracks`, `notes`, `flashcards`, `sharing`, `peer`, `integrity`, `admin`, `notifications`, `billing-lite` (quota only).

Cross-cutting: authN/Z (RBAC), validation (Zod), rate limiting, idempotency, audit logging, feature flags, error mapping.

### 3.3 Realtime gateway

- WebSocket server (Socket.IO or `ws`) with namespaces: `/interview`, `/submissions`, `/contest`, `/peer`.
- Authenticates with a short-lived ticket obtained via REST.
- Scales horizontally using Redis adapter; sticky sessions at the proxy.
- Event log per interview session in Redis streams for **resume after reconnect** (last-event-id).

### 3.4 Session orchestrator (interview engine)

- Pure TypeScript module (can be extracted to its own service): holds the **interview state machine**, selects questions, builds prompts, calls the LLM gateway, validates structured outputs, enforces hint budgets and timers, writes turns/events to Postgres.
- Stateless between turns: loads state from Redis/Postgres each turn (enables horizontal scaling and crash recovery).
- See doc 13.

### 3.5 LLM gateway

- Single entry for all model calls: model routing per task (interviewer: higher-capability model; classification/extraction/filler analysis: cheaper model), streaming, retries with backoff, timeouts, prompt caching, token accounting per user, per-feature budgets, request/response logging with PII redaction, schema-validated JSON mode with repair loop.
- Model names come from config (e.g., `claude-sonnet-5-5` for interviewer, `claude-haiku-5-5` for light tasks), never hard-coded in business logic.

### 3.6 Judge subsystem (doc 12)

- **Dispatcher** (in API): validates, stores submission, enqueues.
- **Judge workers**: pull jobs, fetch test data (from object storage cache), run in `isolate`, push results via Redis pub/sub and DB.
- Language runners defined as config (compile/run commands, limits, multipliers).

### 3.7 Job workers

BullMQ processors: `parse-resume`, `analyze-jd`, `embed-chunks`, `generate-scorecard`, `annotate-transcript`, `analyze-speech`, `ideal-answer`, `code-review`, `complexity-analyze`, `rollup-analytics`, `snapshot-readiness`, `srs-schedule`, `replan-study-plan`, `send-notification`, `render-og-image`, `integrity-scan`, `rejudge`, `cleanup`.

### 3.8 Data stores

| Store                                    | Use                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| PostgreSQL 16 (+ pgvector, pg_trgm)      | System of record, vectors, full-text                                             |
| Redis 7                                  | Cache, queues (BullMQ), rate limits, leaderboards (ZSET), session state, pub/sub |
| Object storage (S3-compatible: R2/MinIO) | Resume files, audio, test data archives, exports, OG images                      |
| (Optional later) ClickHouse/TimescaleDB  | Event analytics at scale                                                         |

### 3.9 Third-party services

| Need              | Choice                                                          |
| ----------------- | --------------------------------------------------------------- |
| LLM               | Claude API                                                      |
| STT/TTS           | Browser APIs (MVP); streaming STT + neural TTS provider (P2/P3) |
| Email             | Resend/SES                                                      |
| Error tracking    | Sentry                                                          |
| Product analytics | PostHog                                                         |
| WebRTC TURN       | coturn or managed                                               |
| OAuth             | Google, GitHub                                                  |

## 4. Key sequences

### 4.1 Submit code

```
Browser -> API POST /submissions (code, lang, problemId, idempotency-key)
API: authz, rate limit, size check, create submission(status=QUEUED)
API -> BullMQ judge queue (priority by mode)
API -> 202 {submissionId}
Browser opens WS /submissions (subscribe submissionId)
Judge worker: claim job -> fetch tests (cache) -> compile (isolate) -> run each test
   -> emit progress events {stage, i/N} via Redis pub/sub
Gateway -> Browser: progress events -> loading bar
Worker: write results (DB), final verdict, update user_problem_state, emit events:
   submission.completed -> (a) analytics invalidation (b) SRS update (c) XP award (d) contest standings
Browser: render verdict, sparkles on AC
```

### 4.2 Interview turn (text)

```
Browser WS: interview.user_message {sessionId, text, clientMsgId}
Gateway -> Orchestrator.handleTurn
  load state (Redis) + recent turns + rolling summary + retrieved resume chunks
  policy checks (hint budget, time, injection filter on user text)
  build prompt (system persona + state + context)
  LLM Gateway stream -> tokens forwarded to Browser as interview.token events
  on completion: validate/parse control tags (e.g. next_state, hint_given), persist turn
  update state machine, timers, event log
  optional: enqueue background annotation
```

### 4.3 Interview end to scorecard

```
Timer expiry or user ends -> state=ENDING -> closing turn -> state=COMPLETED
Enqueue generate-scorecard(sessionId)
Worker: assemble transcript + code events + judge results + rubric
  -> LLM (structured JSON) -> validate (schema + evidence present) -> repair if needed
  -> store scorecard, annotations, strengths/flags, next actions
  -> enqueue analytics rollup, readiness snapshot, plan update, flashcard suggestions
Notify user (WS + in-app + optional email)
```

### 4.4 Resume upload

```
Browser: presigned upload -> object storage
API: create resume record -> enqueue parse-resume
Worker: extract text (pdf/docx) -> section segmentation -> LLM extraction (JSON)
  -> store structured profile + claims -> chunk + embed -> pgvector
User reviews/edit parsed data -> confirm
```

## 5. Scalability plan

| Stage    | Setup                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Demo/MVP | 1 VM (4 vCPU, 8 GB): web, API, gateway, Postgres, Redis, 2 judge workers in Docker Compose; or split web on Vercel            |
| Growth   | Managed Postgres + Redis; API 2 to 4 replicas; judge workers on dedicated VMs (autoscale by queue depth); object storage; CDN |
| Scale    | Separate orchestrator service, read replicas, analytics store, multi-region edge for static, per-region judge pools           |

Bottlenecks and responses:

- **Judge CPU**: horizontal workers, per-language pools, CPU pinning, cap concurrent runs per core.
- **WS connections**: stateless gateways + Redis adapter; budget ~5k connections per instance.
- **LLM latency/cost**: streaming, prompt caching, model tiering, summaries instead of full history.
- **Postgres**: indexes (doc 10), partition large tables (`submissions`, `interview_turns`, `code_events`) by month at scale, move heavy aggregates to rollup tables.

## 6. Reliability

- Idempotent jobs, retries with exponential backoff, dead-letter queues, visibility timeouts.
- Judge **canary** (known problem every minute) feeds health status and auto-drains unhealthy workers.
- Graceful degradation matrix:
  | Failure             | Behavior                                                                                                                               |
  | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
  | Judge down          | Browsing, quizzes, interviews (non-coding) continue; submit shows queue status/wait                                                    |
  | LLM down/slow       | Interview shows "interviewer is reconnecting", falls back to cheaper model; if prolonged, session pauses (timer paused, not penalized) |
  | Redis down          | Rate limits fail open for reads, fail closed for submits; queue unavailable error                                                      |
  | Object storage down | Resume upload disabled; everything else works                                                                                          |
  | WS disconnect       | Auto-reconnect and replay from last event; timer continues server side                                                                 |
- Backups: PITR for Postgres, daily snapshots, tested restore monthly.

## 7. Multi-tenancy and orgs (future)

Org entity (college/company) with members, private contests, private sheets, and admin dashboards; schema already includes nullable `org_id` where relevant.

## 8. Architecture Decision Records (starter list)

1. ADR-001: Modular monolith over microservices.
2. ADR-002: `isolate` + Docker over Firecracker for MVP.
3. ADR-003: BullMQ over Kafka/SQS for queues.
4. ADR-004: Postgres + pgvector over a separate vector DB.
5. ADR-005: Socket.IO/ws over SSE for interview channel (bi-directional, binary for audio).
6. ADR-006: Browser STT first, server STT later.
7. ADR-007: Deterministic scheduling for study plans, LLM only for narrative.
8. ADR-008: Structured JSON outputs with evidence requirement for scorecards.
   Store ADRs in `/docs/adr/NNN-title.md` using the standard Context/Decision/Consequences template.
