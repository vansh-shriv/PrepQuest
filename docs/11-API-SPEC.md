# 11. API Specification

Base URL: `/v1`. JSON over HTTPS. OpenAPI 3.1 is generated from Zod schemas (`/v1/openapi.json`); this doc is the human-readable contract.

## 1. Conventions

| Topic              | Rule                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Auth               | `Authorization: Bearer <access JWT>`; refresh via httpOnly cookie `pq_rt`                         |
| IDs                | UUID strings                                                                                      |
| Time               | ISO 8601 UTC                                                                                      |
| Pagination         | Cursor: `?limit=20&cursor=<opaque>` returns `{items, nextCursor}`                                 |
| Filtering          | Query params; arrays as repeated params or CSV                                                    |
| Idempotency        | `Idempotency-Key` header on `POST /submissions`, `POST /interviews`, `POST /resumes`; 24 h window |
| Trace              | `X-Request-Id` accepted/returned; propagated into jobs and WS                                     |
| Rate limit headers | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; 429 with `Retry-After`               |
| Roles              | `user`, `content_editor`, `reviewer`, `moderator`, `support`, `admin`                             |

### Error format

```json
{
  "error": {
    "code": "SUBMISSION_RATE_LIMITED",
    "message": "Too many submissions. Try again in 12 seconds.",
    "details": { "retryAfterSeconds": 12 },
    "requestId": "01J..."
  }
}
```

Common codes: `VALIDATION_FAILED` (422), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `HINT_LOCKED` (403), `EDITORIAL_LOCKED` (403), `CONTEST_NOT_ACTIVE` (409), `INTERVIEW_NOT_ACTIVE` (409), `QUOTA_EXCEEDED` (402/429), `UPSTREAM_AI_UNAVAILABLE` (503), `JUDGE_BUSY` (503), `INTERNAL` (500).

---

## 2. Auth and account (U1)

| Method  | Path                                                            | Description                                                                     |
| ------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| POST    | `/auth/signup`                                                  | `{email, password, handle, displayName}` creates user, sends verification email |
| POST    | `/auth/verify-email`                                            | `{token}`                                                                       |
| POST    | `/auth/login`                                                   | `{email, password}` returns `{accessToken, user}` + sets refresh cookie         |
| POST    | `/auth/refresh`                                                 | rotates refresh token; reuse detection revokes family                           |
| POST    | `/auth/logout`                                                  | revokes current session                                                         |
| POST    | `/auth/logout-all`                                              | revokes all sessions                                                            |
| POST    | `/auth/forgot-password`, `/auth/reset-password`                 | email reset flow                                                                |
| GET     | `/auth/oauth/:provider/start`, `/auth/oauth/:provider/callback` | Google/GitHub                                                                   |
| POST    | `/auth/2fa/setup`, `/auth/2fa/verify`                           | TOTP [P3]                                                                       |
| GET     | `/me`                                                           | current user + profile + settings summary                                       |
| PATCH   | `/me/profile`                                                   | update profile                                                                  |
| PATCH   | `/me/settings`                                                  | update settings                                                                 |
| GET/PUT | `/me/prep`                                                      | prep settings (targets, date, hours)                                            |
| GET     | `/me/sessions`                                                  | active sessions list                                                            |
| DELETE  | `/me/sessions/:id`                                              | revoke                                                                          |
| POST    | `/me/export`                                                    | request data export (async)                                                     |
| DELETE  | `/me`                                                           | request account deletion (14-day grace)                                         |
| GET     | `/u/:handle`                                                    | public profile (privacy-filtered)                                               |
| GET     | `/me/badges`                                                    | earned badges                                                                   |

---

## 3. Problems, sheets, editor support (D1, D2, D4, D5, U3)

| Method            | Path                                      | Description                                                                                            |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET               | `/problems`                               | Filters: `q, topic[], pattern[], difficulty[], company[], status, sheet, minAcc, maxAcc, sort, cursor` |
| GET               | `/problems/:slug`                         | Statement, examples, constraints, languages with limits/templates, user state                          |
| GET               | `/problems/:slug/similar`                 | Related problems                                                                                       |
| GET               | `/tags`, `/companies`                     | Facets                                                                                                 |
| GET               | `/sheets`, `/sheets/:slug`                | Sheets with user progress                                                                              |
| POST/PATCH/DELETE | `/me/sheets...`                           | Personal sheets [P2]                                                                                   |
| GET/PUT           | `/problems/:slug/draft?language=cpp`      | Autosaved draft (`{code, cursor, version}`; 409 if stale)                                              |
| GET               | `/problems/:slug/draft-history?language=` | Last 5 versions                                                                                        |
| GET/POST/DELETE   | `/problems/:slug/custom-tests`            | Custom tests CRUD                                                                                      |
| POST              | `/problems/:slug/hints/:tier/unlock`      | Returns hint body; enforces order/cooldown; 403 `HINT_LOCKED` with `unlockAt`                          |
| POST              | `/problems/:slug/hints/ask`               | AI Socratic hint `{question, code?}` [P2], streamed                                                    |
| GET               | `/problems/:slug/editorial`               | 403 `EDITORIAL_LOCKED` with `reasons[]` unless unlocked                                                |
| POST              | `/problems/:slug/editorial/give-up`       | Confirm unlock after cooldown                                                                          |
| POST              | `/problems/:slug/rating`                  | Post-solve self-rating `{rating: easy                                                                  | good | hard | again}` |
| PUT/DELETE        | `/me/bookmarks/:problemId`                | `{folder}`                                                                                             |
| GET               | `/me/bookmarks`                           | List                                                                                                   |
| GET/PUT           | `/problems/:slug/note`                    | Markdown note with `version`                                                                           |
| GET               | `/me/notes?q=&tag=`                       | Notes hub search                                                                                       |
| GET/POST/DELETE   | `/me/tags`, `/me/tag-links`               | Personal tags                                                                                          |

---

## 4. Submissions and judge (D3, U2, X3, X4)

| Method | Path                                     | Description                                                       |
| ------ | ---------------------------------------- | ----------------------------------------------------------------- |
| POST   | `/submissions`                           | `{problemSlug, language, code, kind: run                          | submit, customTestIds?, customInputs?, mode?, contestId?, interviewSessionId?}`returns`202 {submissionId, queuePosition?}` |
| GET    | `/submissions/:id`                       | Status/verdict, per-test results (privacy rules)                  |
| GET    | `/me/submissions`                        | History with filters `problem, verdict, language, mode, from, to` |
| PATCH  | `/submissions/:id/note`                  | Note                                                              |
| GET    | `/submissions/:id/diff?against=:otherId` | Code diff                                                         |
| POST   | `/submissions/:id/review`                | Start code review (X3) `{strictness}` returns job id              |
| GET    | `/submissions/:id/review`                | Review result                                                     |
| POST   | `/submissions/:id/complexity`            | `{claimedTime, claimedSpace}` start analysis (X4)                 |
| GET    | `/submissions/:id/complexity`            | Analysis result and chart data                                    |

Example submit request:

```json
POST /v1/submissions
Idempotency-Key: 3b1c...
{
  "problemSlug": "two-sum",
  "language": "cpp",
  "code": "class Solution { ... }",
  "kind": "submit"
}
```

Response `202`:

```json
{ "submissionId": "01J...", "status": "QUEUED", "queuePosition": 3 }
```

Result (`GET /submissions/:id`):

```json
{
  "id": "01J...",
  "verdict": "WA",
  "passed": 7,
  "total": 12,
  "timeMs": 18,
  "memoryKb": 4120,
  "failing": { "ordinal": 8, "label": "edge: duplicates" },
  "results": [{ "ordinal": 1, "verdict": "AC", "timeMs": 2, "memoryKb": 3800 }],
  "compileOutput": null
}
```

Sample/custom tests include `input`, `expected`, `actual`; hidden tests never include them.

---

## 5. Contests (D7)

| Method | Path                                            | Description                            |
| ------ | ----------------------------------------------- | -------------------------------------- |
| GET    | `/contests?status=`                             | upcoming/running/past                  |
| GET    | `/contests/:slug`                               | Details; problems only after start     |
| POST   | `/contests/:slug/register`                      | Register (invite code for private)     |
| GET    | `/contests/:slug/standings?page=`               | Live or final standings                |
| GET    | `/contests/:slug/me`                            | My status, submissions, remaining time |
| POST   | `/contests/:slug/virtual`                       | Start virtual participation            |
| GET    | `/leaderboards/global`, `/leaderboards/org/:id` | Rating leaderboards                    |

---

## 6. Quizzes, SQL, aptitude/OA (C1, C2)

| Method | Path                                                     | Description                                                                     |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/quizzes`                                               | Subjects, sets, topics                                                          |
| POST   | `/quizzes/attempts`                                      | `{mode: practice                                                                | timed | drill | weak, subject?, topic?, count?, setId?}` returns attempt + questions (without answers in timed mode) |
| POST   | `/quizzes/attempts/:id/answers`                          | `{questionId, response, timeMs}`; practice mode returns correctness/explanation |
| POST   | `/quizzes/attempts/:id/finish`                           | Result summary                                                                  |
| POST   | `/quizzes/questions/:id/to-flashcard`                    | Create flashcard                                                                |
| GET    | `/sql/problems`, `/sql/problems/:slug`                   | List/detail with schema                                                         |
| POST   | `/sql/problems/:slug/run`                                | `{query}` run (preview) with limits                                             |
| POST   | `/sql/problems/:slug/submit`                             | Verdict with result diff                                                        |
| GET    | `/oa/templates`                                          | OA templates                                                                    |
| POST   | `/oa/attempts`                                           | Start OA simulator                                                              |
| GET    | `/oa/attempts/:id`                                       | State with server timers                                                        |
| POST   | `/oa/attempts/:id/sections/:n/answers`                   | Save answers                                                                    |
| POST   | `/oa/attempts/:id/sections/:n/finish`                    | Lock section                                                                    |
| POST   | `/oa/attempts/:id/finish`                                | Report                                                                          |
| GET    | `/aptitude/drills` , `POST /aptitude/drills/:id/answers` | Speed drills                                                                    |

---

## 7. Resumes, JD, question memory (I3, X5)

| Method | Path                       | Description                                                |
| ------ | -------------------------- | ---------------------------------------------------------- |
| POST   | `/resumes/upload-url`      | `{filename, mime, bytes}` returns presigned URL + resumeId |
| POST   | `/resumes/:id/complete`    | Triggers parse job                                         |
| GET    | `/resumes`, `/resumes/:id` | List/detail incl. parsed data and status                   |
| PATCH  | `/resumes/:id/parsed`      | User edits parsed data; `confirm: true` marks reviewed     |
| PUT    | `/resumes/:id/default`     | Mark default                                               |
| DELETE | `/resumes/:id`             | Hard delete incl. chunks                                   |
| POST   | `/jds`                     | `{company, role, text                                      | url}` triggers analysis |
| GET    | `/jds/:id`                 | Analysis + gap vs resume                                   |
| GET    | `/me/question-history`     | Asked questions with outcomes                              |
| DELETE | `/me/question-history/:id` | Remove from memory                                         |

---

## 8. Interviews (I1 to I8, E1 to E5, C3, X5)

### REST

| Method | Path                                          | Description                                                                                |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/interview/templates`                        | Types with defaults                                                                        |
| GET    | `/interview/company-packs`                    | Packs list                                                                                 |
| POST   | `/interviews/plan`                            | Preview plan `{type, role, companyId?, level, resumeId?, jdId?, persona, difficulty, ...}` |
| POST   | `/interviews`                                 | Create session from plan (idempotent) returns `{sessionId, wsTicket}`                      |
| GET    | `/interviews/:id`                             | Session state, remaining time, plan summary                                                |
| POST   | `/interviews/:id/start`                       | Begin timer                                                                                |
| POST   | `/interviews/:id/pause` , `/resume`           | Pause rules enforced                                                                       |
| POST   | `/interviews/:id/end`                         | End early                                                                                  |
| POST   | `/interviews/:id/ws-ticket`                   | New short-lived ticket on reconnect                                                        |
| GET    | `/interviews`                                 | History                                                                                    |
| GET    | `/interviews/:id/review`                      | Scorecard + annotations + strengths + flags + next actions (202 if generating)             |
| GET    | `/interviews/:id/transcript?format=json       | md                                                                                         | pdf` | Export |
| GET    | `/interviews/:id/events?from=&to=`            | Code replay events                                                                         |
| POST   | `/interviews/:id/annotations/:annId/note`     | Attach note                                                                                |
| POST   | `/interviews/:id/moments/:offsetMs/flashcard` | Flashcard from moment                                                                      |
| GET    | `/interviews/:id/ideal-answers`               | E3                                                                                         |
| POST   | `/interviews/:id/retry-question`              | Practice again                                                                             |
| GET    | `/interviews/:id/speech`                      | E4 metrics                                                                                 |
| POST   | `/interviews/:id/feedback`                    | Thumbs/rating on scorecard helpfulness                                                     |
| POST   | `/interviews/:id/audio-upload-url`            | If user opts to store audio                                                                |

### WebSocket `/interview` (Socket.IO namespace)

Auth: `?ticket=<wsTicket>`. All events carry `{sessionId, eventId, ts}`.

Client to server:

| Event                                            | Payload                                           |
| ------------------------------------------------ | ------------------------------------------------- |
| `user.message`                                   | `{clientMsgId, text, modality: 'text'             | 'voice', words?: [{w,startMs,endMs}]}` |
| `user.audio.chunk`                               | binary PCM (P2 server STT)                        |
| `user.typing`, `user.speaking`                   | presence                                          |
| `code.snapshot`                                  | `{language, code, cursor?, problemRef}` debounced |
| `code.event`                                     | `{kind: run                                       | submit                                 | paste | focus_lost | idle, meta}` |
| `user.barge_in`                                  | stop TTS, send partial                            |
| `session.pause`, `session.resume`, `session.end` | controls                                          |
| `sync`                                           | `{lastEventId}` request replay                    |

Server to client:

| Event                 | Payload                                                 |
| --------------------- | ------------------------------------------------------- |
| `session.state`       | `{state, segment, remainingMs, hintsLeft}`              |
| `interviewer.token`   | `{turnId, delta}` streaming                             |
| `interviewer.message` | `{turnId, text, final: true, meta}`                     |
| `interviewer.audio`   | TTS audio chunks [P3 server TTS]                        |
| `timer.tick`          | every 10 s plus warnings `{remainingMs, warning?: '10m' | '5m' | '1m'}` |
| `judge.progress`      | submission progress relayed                             |
| `system.notice`       | e.g. hint given, reconnecting                           |
| `session.ended`       | `{reason, scorecardStatus}`                             |
| `scorecard.ready`     | `{sessionId}`                                           |
| `error`               | `{code, message}`                                       |

Reconnect: client sends `sync` with last event id; server replays from Redis stream; timers are server-authoritative.

---

## 9. Analytics and planning (A1 to A5, P1 to P4)

| Method   | Path                                        | Description                                     |
| -------- | ------------------------------------------- | ----------------------------------------------- |
| GET      | `/me/dashboard?range=30d`                   | All dashboard widgets payload                   |
| GET      | `/me/analytics/topics`                      | Mastery per topic + weakness + diagnoses        |
| GET      | `/me/analytics/recommendations`             | Next problems/quizzes/mocks with "why"          |
| GET      | `/me/analytics/interviews?type=&from=`      | Trends, recurring issues                        |
| GET      | `/me/analytics/time?difficulty=`            | A5 distributions and phase breakdown            |
| GET      | `/me/readiness?target=`                     | Score, band, components, limiting factors, ETA  |
| GET      | `/me/readiness/history?target=`             | Snapshots                                       |
| POST     | `/me/diagnostic` , `GET /me/diagnostic/:id` | Calibration test                                |
| GET      | `/me/activity?from=&to=`                    | Heatmap data                                    |
| GET      | `/me/xp`                                    | Level/XP ledger                                 |
| GET/POST | `/me/plan`                                  | Get active plan / generate `{inputs}`           |
| POST     | `/me/plan/replan`                           | Force re-plan; returns diff                     |
| PATCH    | `/me/plan/tasks/:id`                        | Move/skip/lock/complete                         |
| POST     | `/me/plan/tasks`                            | Add custom task                                 |
| GET      | `/me/plan/diff?from=&to=`                   | Version diff                                    |
| GET/PUT  | `/me/goals/template`                        | Goal presets/items                              |
| GET      | `/me/goals/today` , `PATCH /me/goals/today` | Daily goal state                                |
| GET      | `/roadmaps`, `/roadmaps/:slug`              | Graph with unlocked/mastered state              |
| POST     | `/roadmaps/:slug/nodes/:id/skip-test`       | Start checkpoint                                |
| GET      | `/tracks`, `/tracks/:company`               | Company track details                           |
| POST     | `/tracks/:company/start`                    | Start track (creates plan + interview defaults) |
| GET      | `/tracks/compare?a=&b=`                     | Overlap analysis                                |
| GET      | `/me/reviews/due`                           | SRS due list                                    |
| POST     | `/me/reviews/:cardId`                       | Submit review quality                           |

---

## 10. Flashcards, sharing, system design, peer (X6, U5, C3, X1)

| Method           | Path                                                                   | Description                                                           |
| ---------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET/POST         | `/flashcards/decks`                                                    | List/create                                                           |
| GET/PATCH/DELETE | `/flashcards/decks/:id`                                                | Deck ops                                                              |
| POST             | `/flashcards/decks/:id/cards`, `PATCH/DELETE /flashcards/cards/:id`    | Cards                                                                 |
| POST             | `/flashcards/generate`                                                 | AI suggestions from note/quiz/moment, user approves                   |
| GET              | `/flashcards/due?deckId=`                                              | Due cards                                                             |
| POST             | `/flashcards/sync`                                                     | Offline batch `[{clientId, cardId, quality, reviewedAt}]` idempotent  |
| GET/POST         | `/flashcards/import`, `/flashcards/decks/:id/export`                   | JSON                                                                  |
| POST             | `/shares`                                                              | `{entityType, entityId, visibility, options, expiresIn}` returns link |
| GET              | `/shares` , `DELETE /shares/:id`                                       | Manage/revoke                                                         |
| GET              | `/r/:token` (public)                                                   | Shared report payload (privacy-filtered)                              |
| GET              | `/r/:token/og.png`                                                     | OG image                                                              |
| GET              | `/design/prompts`, `POST /design/canvases`, `PUT /design/canvases/:id` | System design workspace                                               |
| POST             | `/design/canvases/:id/review`                                          | AI review                                                             |
| GET/POST         | `/peer/availability`                                                   | Availability                                                          |
| POST             | `/peer/match` , `POST /peer/invites`                                   | Matching/invite link                                                  |
| GET              | `/peer/sessions`, `POST /peer/sessions/:id/consent`                    | Sessions/consent                                                      |
| POST             | `/peer/sessions/:id/feedback`                                          | Feedback                                                              |
| POST             | `/peer/report` , `POST /peer/block`                                    | Safety                                                                |
| WS               | `/peer`                                                                | Signaling for WebRTC, Yjs sync channel                                |

---

## 11. Notifications

| Method | Path                     | Description                                                                                       |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------- |
| GET    | `/me/notifications`      | List                                                                                              |
| POST   | `/me/notifications/read` | Mark read                                                                                         |
| PUT    | `/me/push-subscription`  | Web push registration                                                                             |
| WS     | `/events`                | User-level events: `submission.*`, `scorecard.ready`, `goal.updated`, `xp.gained`, `badge.earned` |

---

## 12. Admin (X7) (role-gated)

| Method    | Path                                                                           | Description                                                           |
| --------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| CRUD      | `/admin/problems`                                                              | Create/edit; workflow endpoints `submit-review`, `publish`, `archive` |
| POST      | `/admin/problems/:id/tests/upload`                                             | zip upload; returns validation report                                 |
| POST      | `/admin/problems/:id/tests/generate`                                           | Run generator with seeds                                              |
| POST      | `/admin/problems/:id/validate`                                                 | Run reference + mutation checks                                       |
| GET       | `/admin/problems/:id/versions`, `/diff`                                        | Versioning                                                            |
| CRUD      | `/admin/hints`, `/admin/editorials`                                            | Content                                                               |
| CRUD      | `/admin/tags`, `/admin/companies`, `/admin/sheets`, `/admin/roadmaps`          | Taxonomy; DAG validation                                              |
| CRUD      | `/admin/company-packs`                                                         | Schema-validated JSON                                                 |
| CRUD      | `/admin/quizzes`, `/admin/aptitude`, `/admin/sql` , `POST /admin/*/import-csv` | Bulk content                                                          |
| CRUD      | `/admin/contests`, `POST /admin/contests/:id/rejudge`, `/announce`             | Contest ops                                                           |
| GET/PATCH | `/admin/users`, `POST /admin/users/:id/suspend`, `/impersonate`                | User mgmt (audited)                                                   |
| GET/PATCH | `/admin/integrity/flags`                                                       | Review queue                                                          |
| GET       | `/admin/system/queues`, `/judge/workers`, `/llm/usage`                         | Ops dashboards data                                                   |
| GET/PATCH | `/admin/flags`, `/admin/config`                                                | Feature flags, XP tuning, models                                      |
| GET       | `/admin/audit`                                                                 | Audit log                                                             |
| POST      | `/admin/submissions/:id/rejudge`                                               | Single rejudge                                                        |

---

## 13. Health

| Method | Path       | Description                                 |
| ------ | ---------- | ------------------------------------------- |
| GET    | `/healthz` | Liveness                                    |
| GET    | `/readyz`  | Readiness (DB, Redis, queue)                |
| GET    | `/status`  | Public status: judge queue wait, LLM status |

## 14. Rate limits (defaults, configurable)

| Endpoint group                       | Limit                                    |
| ------------------------------------ | ---------------------------------------- |
| `POST /submissions` kind=submit      | 10/min, 200/day per user                 |
| `POST /submissions` kind=run         | 30/min                                   |
| `POST /interviews`                   | 5/hour, 15/day                           |
| WS `user.message`                    | 20/min                                   |
| AI hints, code review, ideal answers | 20/day per feature (higher for verified) |
| `POST /auth/login`                   | 10/10 min per IP+email                   |
| `POST /auth/forgot-password`         | 3/hour per email                         |
| Resume upload                        | 10/day                                   |
| Anonymous GET                        | 120/min per IP                           |

---

## 15. Implementation status

**Built (auth, account, privacy):**

| Area | Endpoints |
| ---- | --------- |
| Account lifecycle | `POST /auth/signup`, `/auth/verify-email`, `/auth/resend-verification` (auth), `/auth/forgot-password`, `/auth/reset-password` |
| Sessions | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all` (auth) |
| Two-factor (TOTP) | `POST /auth/2fa/setup` (auth), `/auth/2fa/verify` (auth, returns recovery codes), `/auth/2fa/login`, `/auth/2fa/disable` (auth) |
| OAuth | `GET /auth/oauth/providers`, `/auth/oauth/:provider/start`, `/auth/oauth/:provider/callback` (Google, GitHub) |
| Me | `GET /me`, `PATCH /me/profile`, `PATCH /me/settings`, `GET/PUT /me/prep`, `GET /me/sessions`, `DELETE /me/sessions/:id` |
| Data rights | `POST /me/export`, `DELETE /me`, `POST /me/cancel-deletion` |
| Public | `GET /u/:handle` |
| AI interview gate | `GET /interviews/access` (verified email required; placeholder until the interview engine) |
| Health | `GET /health`, `GET /health/ready` |

**Not built yet:** `/me/badges` and every later section. `/healthz`, `/readyz`, `/status` from §13 are served as `/v1/health` and `/v1/health/ready` for now.

**Login with 2FA.** `POST /auth/login` returns `{ accessToken, user }`, or for an account with 2FA `{ mfaRequired: true, mfaToken }` (5-minute token; not usable as an access token). Finish with `POST /auth/2fa/login { mfaToken, code | recoveryCode }`. Social sign-in redirects to `/oauth/callback?mfa=<token>` in that case.

**Behavior notes**
- Login does not require a verified email; `emailVerified` is returned and the UI nudges. **AI interviews require it**: every `/interviews/*` route runs `requireVerifiedEmail` (403 `EMAIL_NOT_VERIFIED`), read from the database so verifying takes effect immediately.
- Access token: EdDSA JWT, 15 min, claims `sub`, `role`, `sid` (session id), `mfa`. Refresh token: random 256-bit, only its SHA-256 is stored, httpOnly `pq_rt` cookie (`SameSite=Lax`, `Path=/v1/auth`, `Secure` in production). Refresh rotates on every use; replaying a rotated token revokes the whole family; `mfa` carries over. The web client shares one in-flight refresh.
- Cookie endpoints (`/auth/refresh`, `/auth/logout`) reject requests whose `Origin` is not in `CORS_ORIGINS` (403). CORS allows GET/HEAD/POST/PUT/PATCH/DELETE and exposes `x-request-id`, `retry-after`, `ratelimit-*`, `content-disposition`.
- **Roles:** `admin` and `moderator` tokens must carry `mfa: true` (403 `MFA_REQUIRED` otherwise).
- **Rate limits** (429 `RATE_LIMITED` with `Retry-After`; `RateLimit-Limit/Remaining/Reset` headers on every response):

  | Scope | Default | Env |
  | ----- | ------- | --- |
  | Anonymous, per IP | 120/min | `RL_ANON_PER_MIN` |
  | Signed in, per user | 600/min | `RL_USER_PER_MIN` |
  | Credential endpoints, per IP | 20/min (`/auth/refresh` 6x) | `RL_AUTH_PER_MIN` |
  | Login, per IP + email | 10 / 10 min | `RL_LOGIN_PER_10MIN` |
  | Password-reset emails, per address | 3/hour (silently dropped beyond that) | `RL_FORGOT_PER_HOUR` |
  | Verification emails, per user | 3/hour | |
  | Wrong 2FA codes, per user | 5 / 10 min (successes don't count) | |
  | Data exports, per user | 3/day | |

  Health checks are exempt. Counters live in Redis when available (per-process memory otherwise) and **fail open** if the store errors, so an outage degrades protection instead of blocking sign-in. Set `TRUST_PROXY=true` behind a reverse proxy so IP limits see real client addresses.
- **Account lockout:** after 5 failed logins for an email within 15 min, further attempts are refused for 30 s, doubling per failure up to 15 min (429 `ACCOUNT_LOCKED`). Keyed by the submitted email whether or not it exists (no enumeration); a success clears it. Trade-off: someone can lock a victim out for up to 15 min.
- **Passwords:** min 10 chars; Argon2id (64 MiB, t=3, p=1); checked against Have I Been Pwned with k-anonymity (only a 5-char hash prefix leaves the server) at signup and reset (422 `fields.password`); fails open if HIBP is unreachable; disable with `BREACH_CHECK=off`.
- **OAuth:** authorization-code flow with PKCE (S256); `state` is stored server-side (single use, 10 min) and bound to the browser with an httpOnly cookie. Only providers that vouch for the email can sign in. Linking: existing verified account with the same email is linked; an existing **unverified** account (possible pre-hijack) has its password cleared and sessions revoked, then is linked; otherwise a new verified, password-less account is created. A provider is enabled when its `*_CLIENT_ID` and `*_CLIENT_SECRET` are set; redirect URI is `${API_URL}/v1/auth/oauth/:provider/callback`.
- **2FA:** RFC 6238 TOTP (SHA-1, 6 digits, ±1 step). Seeds are AES-256-GCM encrypted (`DATA_ENCRYPTION_KEY`, required in production). 10 single-use recovery codes, stored hashed. A code's time step can't be reused.
- **Public profile:** private by default; private, missing, suspended and pending-deletion profiles all return the same 404. Fields shown follow `profile.privacy` (`showBio`, `showCollege`, `showStats`).
- **Export:** `POST /me/export` returns the JSON as an attachment (built inline for now; becomes an async job when the worker exists). No hashes or secrets included.
- **Deletion:** `DELETE /me { confirm: "DELETE", password?, code? }` needs the password if the account has one and a current 2FA code if 2FA is on; schedules deletion in 14 days, signs out everywhere and emails. Signing in during the grace period works (`deletionRequestedAt` is returned) and `POST /me/cancel-deletion` reverts it.
- `PATCH /me/*` bodies are strict: unknown fields (e.g. `role`, `xp`) return 422. Validation errors: `error.details.fields` maps field name to message.
- Signup returns 409 with `details.field` (`email` or `handle`) on conflicts, which discloses that an email is registered; rate limiting is the mitigation.
- Unknown routes return 404 `NOT_FOUND`; malformed requests return `BAD_REQUEST`. Every response carries `x-request-id` (an incoming value is reused).

### Problems and editor support (Phase 3)

| Area | Endpoints |
| ---- | --------- |
| Browse | `GET /problems`, `/problems/:slug`, `/tags` (`?all=1` includes unused tags), `/companies`, `/sheets`, `/sheets/:slug` |
| Editor | `GET/PUT /problems/:slug/draft?language=`, `GET /problems/:slug/draft-history?language=`, `GET/POST /problems/:slug/custom-tests`, `DELETE /problems/:slug/custom-tests/:id` |
| Admin (content roles) | `GET/POST /admin/problems`, `GET/PATCH /admin/problems/:id`, `GET /admin/problems/:id/validation`, `GET .../versions`, `POST .../tests/upload` (multipart zip), `POST .../submit-review`, `.../publish`, `.../archive` (reason required), `GET /admin/audit` (reviewer/admin) |

Not built yet: hints, editorial, rating, bookmarks, notes, `/problems/:slug/similar`, personal sheets, and the other admin CRUD groups.

**Behavior notes**
- **List** filters: `q`, `topic[]`, `pattern[]`, `topicMode=any|all`, `difficulty[]`, `company[]`, `status[]` (`unsolved|attempted|solved`, needs sign-in), `sheet`, `minAcc`, `maxAcc`, `maxMinutes`, `sort=default|difficulty|acceptance|recent`, `limit` (max 50), `cursor`. Arrays accept repeated or CSV values. Only published problems are listed; archived ones stay reachable by slug (`archived: true`); drafts and in-review problems 404. Pagination is offset-based behind an opaque cursor; the response carries `total`. Anonymous callers get public data; a valid token personalises `status`/`state`; an invalid token is a 401 (not silently anonymous).
- **Search** is Postgres full-text (stemmed, title weighted over statement) OR trigram similarity, so typos like "edt distnce" still find Edit Distance. Default order with `q` is relevance; with `sheet` it is the sheet's order; otherwise easy to hard, then estimated time.
- **Problem detail** returns statement, constraints, formatted examples, tags, per-language limits and starter code. It never returns hidden tests, drivers or storage keys. Language limits follow doc 12: C++ base, Java 2x + 300 ms and 2x memory, Python 5x.
- **Drafts:** optimistic concurrency. `PUT` carries `baseVersion` (0 for a new draft); a stale version returns 409 `CONFLICT` with `details.current` (the newer draft). Unchanged code is a no-op. Code is capped at 64 KB. Replaced code is snapshotted into history at most once a minute (5 kept). Concurrent saves: exactly one wins.
- **Custom tests:** up to 20 per user per problem (429 `QUOTA_EXCEEDED`, race-safe), input up to 64 KB, private to the user.
- **Admin permissions:** content editors create problems and edit/upload/submit **their own drafts**; reviewers and admins edit anything not archived and are the only ones who publish or archive; an author can't publish their own problem unless `ALLOW_SELF_PUBLISH=true`; admin tokens also need 2FA. `submit-review` and `publish` require the validation checklist to pass (422 lists what to fix); archiving requires a reason. Every write is recorded in `admin_audit_log`.
- **Edits and versions:** changes to statement, constraints, examples, limits or starters create a new version (tests are copied forward); title, tags and estimates don't. Files in `content/` remain the source of truth for imported problems: the next `content:import` replaces admin edits with the file contents (as a new version).
- **Test upload:** zip with `manifest.json` and `NN.in`/`NN.out` in its root; at most 25 MB zipped, 200 tests, 5 MB per file, 50 MB total, checked from the zip headers before anything is inflated; no nested folders or stray files; UTF-8 only; every input/output is parsed against the signature; the first N tests must be samples (N = number of examples). A bad zip changes nothing (422 with up to 50 issues).
- **Validation checklist:** tags, statement, constraints, examples, signature, three starters, test validity (format, counts: 10/15/20 non-sample tests for easy/medium/hard, at least 2 stress, labelled edge/stress), hints (warning). Reference-solution and mutant runs are listed as "later" until the judge exists.

### Submissions, history, bookmarks and notes (Phase 4)

| Area | Endpoints |
| ---- | --------- |
| Judge | `POST /submissions` (202 `{submissionId, status, queuePosition}`), `GET /submissions/:id`, `GET /me/submissions`, `PATCH /submissions/:id/note`, `GET /submissions/:id/diff?against=` |
| Library | `GET /me/bookmarks`, `PUT/DELETE /me/bookmarks/:slug` (slug, not id), `GET/PUT /problems/:slug/note`, `GET /me/notes?q=` |

Not built yet: review (X3) and complexity (X4) endpoints, personal tags, notes export, note version history, `/me/tag-links`.

**Behavior notes**
- **Create:** body `{problemSlug, language, code, kind, customTestIds?, customInputs?}`. `kind=submit` judges every test of the problem's current version; `kind=run` judges the samples plus the chosen saved custom tests (numbered 1001+) and up to 5 ad-hoc inputs (each up to 256 KB). Custom tests on a submit, someone else's custom test id, an unavailable language, a problem without tests or with a special checker: 422. Only published problems accept code (404 otherwise). `Idempotency-Key` (8 to 100 chars, per user): a repeat returns the original submission with `Idempotent-Replay: true` and does not cost rate-limit budget.
- **Limits:** submit 10/min and 200/day, run 30/min (429 `RATE_LIMITED`), at most 5 queued or running at once (429 `TOO_MANY_PENDING`). Queue unreachable: 503 `JUDGE_UNAVAILABLE`.
- **Read:** only the owner sees a submission (404 for anyone else). `verdict` is `QUEUED`, `COMPILING`, `RUNNING` while judging; `finished` becomes true on any final verdict (including `IE`), and `code` is included from then on. `results[]` per test: hidden tests expose only `ordinal`, `kind`, `verdict`, `timeMs`, `memoryKb` (plus `stderr` for a runtime error and a fixed message for WA); samples and custom runs add `input`, `expected`, `stdout`, `stderr`, `checkerMsg`. `failing` names the first failing test and, for hidden ones, its author's label.
- **Effects of a finished submit:** `user_problem_state` (status, attempts, first AC, first-try flag, best time) and the problem's submission/acceptance counters. Runs and `IE` never count.
- **History:** `GET /me/submissions` filters `problem`, `verdict`, `language`, `mode`, `from`, `to`, `q` (problem title) and `kind` (`submit` default, `run`, `all`), newest first with an opaque cursor (`limit` up to 100). `diff` compares two of your attempts at the same problem (line diff).
- **Notes:** `PUT` carries `baseVersion` (0 for a new note); a stale version is 409 `CONFLICT` with `details.current`; saving an empty body deletes the note; at most 20,000 characters. Notes of archived problems stay and are marked `archived` in the hub. `GET /problems/:slug` now includes `bookmarked` for signed-in users.

### Hints, editorial, rewards and the dashboard (Phase 5)

| Area | Endpoints |
| ---- | --------- |
| Hints | `GET /problems/:slug/hints`, `POST /problems/:slug/hints/:tier/unlock` |
| Editorial | `GET /problems/:slug/editorial`, `GET /problems/:slug/editorial/status`, `POST /problems/:slug/editorial/give-up` `{confirm: true}`, `POST /problems/:slug/rating` `{rating}` |
| Progress | `GET /me/xp`, `GET /me/badges`, `GET /me/dashboard?range=7d\|30d\|90d\|all` |
| Admin | `PUT /admin/problems/:id/hints`, `PUT` and `DELETE /admin/problems/:id/editorial` (same permissions as editing; audited; no new version) |

Settings gained `openEditorials` (`PATCH /me/settings`); `hintMode` (strict or relaxed) now has an effect.

**Behavior notes**
- **Hints:** tiers must be viewed in order. Strict mode: the first hint unlocks 3 minutes after the problem was first opened, each next one 5 minutes after the previous; relaxed: 0 and 1 minute. A locked tier is `403 HINT_LOCKED` with `details: {reason: "cooldown", unlockAt}` or `{reason: "previous_tier", missingTier}`. Hint text is never in the overview until viewed. Viewed hints can be read again free. Once a problem is solved the waits no longer apply (order still does). The highest tier viewed is `user_problem_state.hints_used` and is copied onto each new submission.
- **Editorial:** `403 EDITORIAL_LOCKED` with `details: {reasons[], giveUpAt, canGiveUp}` until the user has solved the problem, viewed all three hints, turned on "open editorials", or gave up. `give-up` needs `confirm: true` and 10 minutes (strict) or 2 minutes (relaxed) after first opening the problem (`403 GIVE_UP_TOO_EARLY`); it is recorded and counts like using all three hints for XP. No editorial row: 404. The rating (`easy|good|hard|again`) needs a solved problem (`403 NOT_SOLVED`) and feeds spaced repetition later.
- **XP:** only the first accepted solution of a problem earns XP: base 10 / 25 / 50 by difficulty, +20% first try, +20% with no hints, -10% per hint tier (whole-percent arithmetic, minimum 1). Levels: `xp_to_next(level) = round(100 * level^1.4)`. Any accepted submit counts as activity for the streak and the heatmap.
- **Streak:** per the player's time zone; the next day extends it, one missed day is bridged by a grace day (one is kept; a new one is earned at each multiple of 7 days), a longer gap restarts it at 1 (best is kept). Bonus XP at 7, 30 and 100 days (50, 200, 500). A lapsed streak reads as 0 on the dashboard.
- **Rewards** arrive on `GET /submissions/:id` as `rewards` for an accepted submit (XP split, level before and after, streak, new badge ids). They are written in the same transaction as the verdict, so a redelivered judge event can never pay twice.
- **Dashboard:** one call returns everything: level and XP, streak, solved by difficulty with a 30-day daily series, accuracy (acceptance, first-try rate, average submissions to first AC), a 26-week heatmap, a skill plant per topic (seed, sprout, bud, bloom), weak areas with a diagnosis, three recommended problems, recent submissions, sheet progress, badges and the placement countdown. `range` filters the "solved in range" and accuracy numbers; totals ignore it. Numbers reconcile with the raw tables (tested).
- **Badges** today: First Blood, Ten Down, Week Warrior, Hard Mode, Clean Sheet (5 first-try solves without hints), Polyglot (accepted in three languages).

### Resumes, job descriptions and interviews (Phase 6, as built)

All routes need a verified email (`403 EMAIL_NOT_VERIFIED`). Deviations from sections 7 and 8 above:

| Area | As built |
| ---- | -------- |
| Resume upload | `POST /resumes` takes `multipart/form-data` (`file`, optional `label`) instead of a presigned URL: PDF or DOCX up to 5 MB, content sniffed (a renamed file is `422`), max 10 resumes, 10 uploads/day. Answers `202`; parsing runs as a background job (`status`: `parsing`, then `needs_review` or `failed`; `POST /resumes/:id/retry`). Nothing is used until the user confirms (`PATCH /resumes/:id/parsed` with `confirm: true` makes it `ready`, rebuilds the retrieval chunks and sets the first one as default). |
| Retrieval | Chunks per project, job and the skills block, embedded with a local hashing embedder into `vector(1024)` and searched with pgvector cosine distance. The embedder is swappable. |
| JD | `POST /jds` analyses synchronously (required skills, gap against a resume). Text only; URL fetch is P2. |
| Plan | `POST /interviews/plan` never calls the model. DSA: picks problems by level, weak topics, recent questions (60 days) and cleanly solved problems; `problemSlugs` overrides. Project: lists resume items, `projectRefs` overrides. |
| Create | `POST /interviews` (idempotent, 5/hour, 15/day) returns `{session, wsTicket}`. Project questions are written here by the model (each cites a resume item) and hidden until asked. A never-started plan is replaced by the next one; only one interview can be live (`409 INTERVIEW_IN_PROGRESS`). |
| Control | `POST /interviews/:id/start`, `pause`, `resume`, `end`. Pause is practice-mode only, once, up to 3 minutes (a longer pause is credited 3). |
| Conversation | WebSocket (Socket.IO namespace `/interview`, path `/ws`, `auth: {ticket}`); tickets are single use and live 60 s. REST equivalent: `POST /interviews/:id/messages` (`clientMsgId` makes a retry idempotent, and a retry after a model outage answers once). Events: `candidate.message`, `interviewer.token`, `interviewer.retract` (a streamed reply that failed a check is withdrawn), `interviewer.message`, `interviewer.typing`, `session.state`, `timer.tick` (with `warning` at 10, 5, 1 minutes), `system.notice`, `session.ended`, `scorecard.ready`, `error`. `sync {lastSeq}` returns the turns the client missed; replay comes from Postgres, not a Redis stream. |
| Code | `POST /interviews/:id/events` with `snapshot`, `run`, `submit`, `paste`, `focus_lost`. For `run`/`submit` the browser sends only the submission id: the verdict is read from the judge's own record. Submissions accept `mode: "interview"` + `interviewSessionId`. While a problem is part of a live interview, its hints and editorial are `403 HINT_LOCKED`. |
| Review | `GET /interviews/:id/review` (`202` while generating, `409` while running), `POST .../review/retry` after a failure, `GET .../transcript?format=json\|md`, `POST .../annotations/:id/note`, `POST .../feedback`, `GET .../events` (replay data). `GET /interviews` is the history with score and band. |
| Not built yet | PDF export, audio upload. (Company packs, ideal answers, STAR, speech analytics, `retry-question` and question history arrived in Phase 8.) |

Errors added: `INTERVIEW_IN_PROGRESS` (409), `INTERVIEW_PAUSED` (409), `RESUME_REQUIRED` (422), `QUOTA_EXCEEDED` (429, daily or per-session token budget), `UPSTREAM_AI_UNAVAILABLE` (503).

### Voice and live coding (Phase 7, as built)

| Area | As built |
| ---- | -------- |
| Mode | `POST /interviews` takes `mode: text \| mixed \| voice` (default `text`); anything else than `text` is `422 VOICE_DISABLED` unless `FF_VOICE` is on. `GET /interview/templates` returns `{items, features: {voice}}`. Speech runs in the browser (Web Speech API); the server never receives audio. |
| Spoken answers | `user.message` and `POST /interviews/:id/messages` accept `modality: "voice"` and `words: [{w, startMs, endMs}]` (up to 1500; malformed stamps are dropped). Turns store `modality` and `words`; `GET /interviews/:id` and the transcript return `modality` and `interrupted` per turn. |
| Barge-in | `POST /interviews/:id/barge-in {turnId, charIndex}` (or socket `user.barge_in`): marks the interviewer turn `meta.interrupted` with `meta.heard` (the part spoken), logs a `barge_in` event, and the next turn's history shows the reply as cut short. The transcript keeps the full text. |
| Reactions | Proactive interviewer messages are ordinary interviewer turns with `meta.proactive` = `ac_reached`, `run_failed`, `no_approach_before_code`, `complexity_smell` or `idle_coding`. Nothing new on the wire. |
| Replay | `GET /interviews/:id/events` now also carries `barge_in` and `paste` markers used by the replay tab. |

### Evaluation depth (Phase 8, as built)

| Area | As built |
| ---- | -------- |
| Types | `type` is one of `dsa, project, resume, cs, behavioral, lld, hld`. `GET /interview/templates` lists all seven. `resume` needs a ready resume (`422 RESUME_REQUIRED`). `questionSlugs` (bank questions of that type) overrides the pick. |
| Packs | `GET /interview/company-packs` returns curated packs plus the caller's provisional ones (`provisional: true`, unverified). `POST /interviews/plan` and `POST /interviews` take `packSlug` or a free-text `company`; the plan preview adds `pack`, `packEffects` and `rubricWeights` and never calls the model; a provisional pack is created only on `POST /interviews`. Unknown or foreign slug: `422`. |
| Ideal answers | `GET /interviews/:id/ideal-answers` returns `{status, items}`; `202` while `pending` or `running`. `POST /interviews/:id/review/retry-extras` (202) reruns the extras job. |
| STAR | `GET /interviews/:id/star` returns `{items}` with s/t/a/r, specificity, impact, reflection, completeness, ownership ratio and a justification, plus a STAR rewrite. |
| Speech | `GET /interviews/:id/speech` returns `{speech}` (words, wpm, fillers, hedging, pauses, flags and a "not a diagnosis" note) or `null`. |
| Practise again | `POST /interviews/:id/retry-question {questionIndex}` (finished interviews only) creates a one-question interview and returns `{session, wsTicket}`; missed points are added as hidden rubric points. |
| Memory | `GET /me/question-history`, `DELETE /me/question-history/:id` (404 if not yours), `DELETE /me/question-history` (`{deleted}`). `PATCH /me/settings {personalizedCallbacks}` turns off references to past practice. |

### Analytics and planning (Phase 9, as built)

| Method | Path | As built |
| ------ | ---- | -------- |
| GET | `/me/analytics/topics?target=` | Mastery, confidence, weakness, signals and diagnosis per topic, plus next actions with a "why" |
| GET | `/me/analytics/interviews?type=&company=&persona=&includeAbandoned=` | Trends, deltas, habits, speech series |
| GET | `/me/analytics/time?difficulty=` | Medians, histograms, read versus debug split, slowest solves, coaching |
| GET | `/me/readiness?target=` | Score or null, band, components, limiting factors, levers, ETA; records today's snapshot |
| GET | `/me/readiness/history?target=` | Snapshots |
| POST / GET | `/me/diagnostic`, `/me/diagnostic/:id` | Five-problem calibration; reuses the open one |
| GET / POST | `/me/plan` | Active plan (or `{plan: null}`); POST generates or re-plans with `{placementDate, hoursPerDay, defaultHours, restDays, mockPerWeek, mockTypes, packSlug}` |
| POST | `/me/plan/replan` | Re-plan now; the response carries `lastDiff` |
| GET | `/me/plan/diff?from=&to=` | One version's change |
| PATCH / POST | `/me/plan/tasks/:id`, `/me/plan/tasks` | Done, skipped, locked, moved (422 when the day has no room or is in the past); custom tasks are locked |
| GET / PUT | `/me/goals/template` | Presets and items |
| GET / PATCH | `/me/goals/today` | Live progress; PATCH is refused (409) once the day's bonus is paid |
| GET | `/me/quest-board` | Goals, today's tasks, readiness headline, next action |

Not built: `/me/xp` ledger changes, `/roadmaps`, `/tracks`, `/me/reviews`.

### Learning suite (Phase 10, as built)

| Method | Path | As built |
| ------ | ---- | -------- |
| GET | `/me/reviews` | Today's queue (capped), waiting count, seven-day outlook, paused cards, stats; creates cards for older solves |
| POST | `/me/reviews/:id/grade` | `{rating: again, hard, good, easy}`; 409 `NOT_DUE` or `SUSPENDED` |
| POST | `/me/reviews/:id/snooze`, `/suspend` | `{days}` (1 to 30); `{suspended}` |
| PUT | `/me/reviews/settings` | `{cap}` (1 to 30) |
| GET | `/quizzes` | Subjects with topics, the learner's record, weak count, recent attempts |
| POST | `/quizzes/attempts` | `{mode: practice, timed, drill, weak, subject?, topic?, count?, minutes?}`; questions come without answers |
| GET | `/quizzes/attempts/:id` | Resume (`attempt`) or the result |
| POST | `/quizzes/attempts/:id/answers` | `{questionId, response, timeMs}`; feedback in practice-style modes, none in timed; 409 `ALREADY_ANSWERED`, `QUIZ_EXPIRED`, `QUIZ_FINISHED` |
| POST | `/quizzes/attempts/:id/finish` | Scores, pays XP once, returns the review with answers |
| GET | `/roadmaps`, `/roadmaps/:slug` | Progress per roadmap; nodes with state, mastery, ladder, blockers |
| GET | `/tracks`, `/tracks/:slug` | Company tracks with progress; one track in full |
| POST | `/tracks/:slug/start` | Records the track and builds the plan; returns the track and `planCreated` |
| GET | `/tracks/compare?a=&b=` | Shared problems, what is only in each, and what to add for B |

Not built: `/quizzes/questions/:id/to-flashcard`, the `/sql/*`, `/oa/*` and `/aptitude/*` endpoints, `/roadmaps/:id/nodes/:id/skip`, `/tracks/:slug/progress`.

### SQL practice and online assessments (Phase 11, as built)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sql/problems`, `/sql/problems/:slug` | List with solved state; detail with statement, tables and sample rows, the learner's last query and (after solving) the reference solution |
| POST | `/sql/problems/:slug/run` | `{query}`; one read-only statement; returns columns, rows (at most 1000), time or an error; own rate limit (40 a minute) |
| POST | `/sql/problems/:slug/submit` | Verdict AC, WA, ERROR or TLE with the reason, the expected column and row counts, XP on the first accepted solution |
| GET | `/oa` | Templates with the learner's attempts and best score, recent results, an open attempt to resume |
| POST | `/oa/attempts` | `{template}`; builds the paper; 409 `OA_OPEN` while another test is open |
| GET | `/oa/attempts/:id` | Step (between, section, finished), section list, the running section's questions without keys, saved answers, seconds left; the report when finished |
| POST | `/oa/attempts/:id/sections/:index/start` | Starts the next section (409 `OA_ORDER` out of order or while one runs) |
| PUT | `/oa/attempts/:id/answers` | `{itemId, response|null}`; 409 `OA_SECTION_CLOSED` after the deadline |
| POST | `/oa/attempts/:id/submit-section`, `/finish` | Hand in the running section; end the whole test (waiting sections score zero) |

Not built: `/aptitude/*` practice endpoints, `/admin/sql`, `/admin/aptitude` and `POST /admin/*/import-csv`.

### Contests (Phase 12, as built)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/contests?status=upcoming\|running\|past` | Public contests plus private ones you created or joined |
| POST | `/contests` | Verified email. `kind: private` for everyone (returns an invite code to the creator); `weekly` and `oa` need a reviewer or admin; the start may be at most 2 minutes in the past |
| GET | `/contests/:slug?code=` | Details; problems only after the start (or for the creator); a private contest is 404 without the code, registration or authorship |
| POST | `/contests/:slug/register` | `{inviteCode?}`; idempotent; 409 `CONTEST_ENDED` after the end |
| GET | `/contests/:slug/standings?page=` | Top 50 plus your own row; frozen for non-creators during the freeze minutes |
| GET | `/contests/:slug/me` | Your running participation and seconds left, your contest submissions, your best virtual result and where it would place |
| POST | `/contests/:slug/virtual` | Starts a virtual run of a finished contest (409 `CONTEST_NOT_OVER`, `VIRTUAL_RUNNING`) |
| POST | `/contests/:slug/events` | `{type: blur\|paste}`; counted on your running participation |
| POST | `/submissions` | `mode: contest` with `contestSlug`: 403 `CONTEST_NOT_REGISTERED`, 409 `CONTEST_NOT_RUNNING`, 422 for a problem outside the contest |

Hints and editorials answer 403 `HINT_LOCKED` for a contest problem while you are inside the window. Not built: `/contests/:slug/export`, rating updates.

### Flashcards and shared reports (Phase 13, as built)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/flashcards` | Decks with due and new counts, starter decks (with `adoptedAs`), daily limits and what was done today |
| PUT | `/flashcards/settings` | `{newPerDay, reviewsPerDay}` |
| POST, GET, PATCH, DELETE | `/flashcards/decks`, `/flashcards/decks/:id` | Deck detail includes its cards (rendered prompt and answer) |
| GET | `/flashcards/decks/:id/export` | `{format: "prepquest-deck", version: 1, title, kind, cards[]}` as an attachment |
| POST | `/flashcards/import` | The same JSON; 422 names the first bad card |
| POST | `/flashcards/decks/:id/cards`, PATCH and DELETE `/flashcards/cards/:id` | Cloze needs a `{{c1::...}}` part, other types need a back |
| POST | `/flashcards/starters/:slug/adopt` | Copies a starter deck once (returns the existing copy the second time) |
| GET | `/flashcards/study?deckId=&cram=true` | Due reviews then new cards within the limits; cram ignores dates and limits |
| POST | `/flashcards/sync` | `{reviews: [{clientId, cardId, quality 0-5, reviewedAt}]}` (1 to 500); each result is `applied`, `stale`, `duplicate` or `unknown_card` |
| POST | `/flashcards/from-quiz` | `{attemptId}` or `{questionId}`: wrong answers of a finished quiz become cards in the "Quiz mistakes" deck |
| POST | `/shares` | Verified email. `{entityType: scorecard\|contest\|readiness, ref?, visibility, options, expiresIn}`; returns the link once (`token`, `path`) |
| GET | `/shares`, DELETE `/shares/:id` | The owner's links (status, views) and revoke |
| GET | `/r/:token` | Public, no sign-in, `no-store`; 404 for unknown, revoked and expired links |
| GET | `/r/:token/og.png` | Public 1200x630 preview image; does not count a view |

A scorecard needs a finished interview with a ready scorecard (409 otherwise); a contest result needs a finished contest the learner took part in; a readiness summary needs enough data.

## Phase 14 additions (as built)

- `POST /submissions/:id/review` body `{strictness?, refactor?}`: verified email; 202 with the review (pending); asking again for the same strictness returns the same review at no cost. 409 while the judge is still working, 429 over the limits.
- `GET /submissions/:id/review?strictness=`: `{review}` or `{review: null}`. The refactor code is present only when its status is `verified`.
- `GET|PUT /code-review/settings`: `{strictness}`.
- `POST /submissions/:id/complexity` body `{claimed}`: 202, status `running`. 422 when the problem has no `scale.json` or the code did not compile, 409 while the judge is busy.
- `GET /submissions/:id/complexity`: `{supported, analysis}`; the analysis is finished lazily when the judge run is over.

## Phase 15 additions (as built)

- `POST /admin/integrity/scan` `{contestSlug}`: moderator, reviewer or admin (admin and moderator tokens need two-factor). Returns participants, pairs compared and flags created or refreshed.
- `GET /admin/integrity/flags?status=&contest=`: queue (`{items, open}`), waiting first, then by severity.
- `GET /admin/integrity/flags/:id`: detail with both programs and the matching lines.
- `PATCH /admin/integrity/flags/:id` `{decision: confirm|dismiss|escalate, note}`: audited; 403 when a non-admin decides an escalated flag, 409 when escalating a decided flag.
- `GET /me/integrity`: the learner's decided flags (outcome, reason, `canAppeal`), no evidence.
- `POST /me/integrity/:id/appeal` `{text}`: once, for a confirmed flag of one's own.

## Phase 16 additions (as built)

- `GET /design/prompts`, `GET /design/prompts/:slug`: prompts and the requirement questions; never the reference.
- `GET /design/prompts/:slug/reference`: the three layers; 403 `REFERENCE_LOCKED` until the learner has a reviewed canvas for that prompt.
- `GET|POST /design/canvases`, `GET|PUT|DELETE /design/canvases/:id`: a learner keeps up to 20; `PUT {canvas, panel, baseVersion}` returns the new version and the automatic checks, 409 `VERSION_CONFLICT` (with the stored version) when the base is stale, 422 when the drawing is invalid.
- `POST /design/canvases/:id/review`: verified email; 202 with the canvas (`reviewStatus: pending`); 422 with fewer than two components; 429 over 3 a minute or 10 a day.

## Phase 17 additions (as built)

- `POST /interviews/:id/events` accepts `{kind: "canvas", canvas}` for a round with a drawing board (422 for other rounds or an invalid drawing); unchanged and blank boards are ignored.
- `GET /interviews/:id/design`: `{canvas, offsetMs, findings[]}` for the latest drawing (404 when the round has no board).
- Session and template DTOs have `usesCanvas`.
