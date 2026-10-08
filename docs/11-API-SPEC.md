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
