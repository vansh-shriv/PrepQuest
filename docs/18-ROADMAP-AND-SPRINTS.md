# 18. Roadmap, Sprints, and Milestones

Assumes **one primary developer** (you), ~15 to 20 productive hours/week, alongside placements prep. Adjust durations if time differs. Total: ~24 weeks for P1 + P2 core; P3 is optional polish.

## 1. Phase overview

| Phase                       | Weeks    | Outcome                                                       | Features                                                                                                                          |
| --------------------------- | -------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **P0: Foundations**         | 1 to 2   | Repo, CI, design system skeleton, DB, auth                    | G4 (CI base), U1 (basic), U4 (themes, tokens)                                                                                     |
| **P1: MVP**                 | 3 to 10  | Usable practice + text AI interview + feedback, deployed demo | D1 to D5, I1 (coding, project), I3, I4, I7 (basic), I8, E1, E2, E5, A1, A2 (basic), U2, U3, X7 (basic), G1, G2 (core), G3 (basic) |
| **P2: Depth**               | 11 to 20 | Voice, live coding, analytics, planning, fundamentals         | I5, I6, I2 (full), D6, D7, E3, E4, A3 to A5, P1 to P4, C1, C2, U5, X3 to X6                                                       |
| **P3: Polish and advanced** | 21 to 28 | Peer mocks, canvas, integrity, hardening                      | X1, X2, C3, mobile polish, advanced admin, pen test                                                                               |

## 2. Detailed sprint plan (2-week sprints)

### Sprint 0 (Weeks 1 to 2): Foundations

- Monorepo (pnpm + Turborepo), TS configs, ESLint/Prettier, Husky.
- GitHub Actions: lint, typecheck, unit; preview deploys.
- Docker Compose: Postgres+pgvector, Redis, S3-compatible store (Zenko CloudServer), Mailpit.
- DB schema v1 (users, profiles, problems, tags, test_cases, submissions) + migrations + seed script.
- Auth: signup/login/refresh/logout, email verification, Google/GitHub OAuth.
- Design system: tokens, fonts, Button, Card, Input, Tabs, Dialog, Toast, Loading bar, Sprite component; Storybook with 3 themes.
- **Milestone M0**: login works, themed shell with nav, CI green.

### Sprint 1 (Weeks 3 to 4): Problem bank + editor

- Problems API + filters + full-text search + sheets.
- Problem list and problem page UI (split panes), Monaco editor, language switch, autosave drafts, custom tests UI.
- Content pipeline: `content:validate`, `content:import`; author first 20 problems with tests.
- Admin v0: create/edit problem (basic), test upload.
- **Milestone M1**: browse and read problems, edit code with autosave.

### Sprint 2 (Weeks 5 to 6): Judge + submissions

- `judge-core` (verdict logic, checkers, drivers for function-style problems).
- Judge worker with `isolate` (C++, Python first, Java next), BullMQ lanes, progress via Redis → WS.
- Submit/Run APIs, results UI (verdict banner, per-test table, diff), loading stage bar.
- Rate limiting, idempotency, IE retry; malicious test suite v1.
- User problem state, history page (U2), bookmarks, notes (U3).
- **Milestone M2**: solve problems end-to-end with real verdicts (C++/Python/Java). Content up to 60 problems.

### Sprint 3 (Weeks 7 to 8): Hints, editorials, dashboard, XP

- Tiered hints with unlock rules; editorial viewer with lock logic; self-rating.
- XP, levels, streaks (timezone aware), activity heatmap, basic dashboard (A1) and basic weak-area (A2 v1).
- Sheets progress UI; pixel sprites (sunflower, plant, coin, sparkles).
- Admin: hints/editorial editors, validation panel, mutation checks.
- **Milestone M3**: complete practice loop with progress and gamification. Content up to 100 problems.

### Sprint 4 (Weeks 9 to 10): AI interview MVP + deployment

- LLM gateway, prompt registry, interview state machine, WS gateway, text chat UI, timer, editor integration (Interview mode).
- Resume upload + parse + review (I3), project deep-dive and DSA round templates, personas (basic), hint budget.
- Scorecard generation job (rubric, evidence validation), review page with transcript + annotations (E1, E2, E5).
- Observability basics (logs, metrics, Sentry), deploy: web on Vercel, API/worker on VM, judge VM; demo seed; README + GIFs.
- **Milestone M4 (MVP launch)**: public demo with practice + AI mock + scorecards. Collect first user feedback.

### Sprint 5 (Weeks 11 to 12): Voice + live coding

- Voice mode with browser STT/TTS, push-to-talk, barge-in, captions, mic check.
- Code event streaming, proactive interviewer reactions with cooldown, replay timeline in review.
- Reconnect/replay robustness; AI eval harness v1 (golden sessions, injection set).
- **Milestone M5**: voice interview with live coding awareness.

### Sprint 6 (Weeks 13 to 14): Evaluation depth

- Ideal answer comparison (E3), STAR scoring and speech analytics (E4), more interview types (CS fundamentals, HR, resume-based, HLD/LLD text-only).
- Question memory (X5) with embeddings; company packs v1 + targeting (I2).
- **Milestone M6**: full set of interview types with deep feedback.

### Sprint 7 (Weeks 15 to 16): Analytics + planning

- Mastery and weakness engine (analytics-core), recommendations with "why".
- Interview trends (A3), time analysis (A5), readiness score (A4) with confidence bands, diagnostic test.
- Study plan generator (P1) + daily goals (P2) + diff view; nightly re-plan job.
- **Milestone M7**: personalized plan and readiness.

### Sprint 8 (Weeks 17 to 18): Spaced repetition + fundamentals

- SRS for problems (D6) with review queue and caps.
- Quiz modules (C1), SQL practice runner, aptitude and OA simulator (C2); content expansion (quizzes 400, aptitude 200).
- Roadmaps (P3) + company tracks (P4) UI and overlap analysis.
- **Milestone M8**: complete prep suite.

### Sprint 9 (Weeks 19 to 20): Contests + code tools + flashcards

- Contests (D7): registration, live standings (Redis ZSET), ICPC/points scoring, virtual contests.
- Code review mode (X3), complexity analyzer (X4), flashcards with offline sync (X6), shareable reports + OG images (U5).
- **Milestone M9**: community and review features.

### Sprint 10 (Weeks 21 to 22): Integrity + system design

- Plagiarism/AI-assist detection (X2) with admin review queue.
- System design canvas (C3) with AI review and HLD interview integration.
- **Milestone M10**.

### Sprint 11 (Weeks 23 to 24): Peer mocks

- WebRTC audio + Yjs shared editor + whiteboard, matching, scheduling, feedback, reputation, consent flows (X1).
- **Milestone M11**.

### Sprint 12 (Weeks 25 to 26): Hardening

- Load tests, security review, sandbox pen test, accessibility audit, mobile polish, performance tuning, backups/DR drill, docs and runbooks complete.
- **Milestone M12 (v1.0)**.

### Buffer (Weeks 27 to 28)

Bug bash, content improvements, user-requested features, portfolio write-up/blog post.

## 3. MVP cut checklist (must ship in M4)

- [ ] Auth + profile + themes (Cream, Night)
- [ ] 100+ problems with tests, tags, sheets
- [ ] Editor, Run/Submit, verdicts, C++/Python/Java
- [ ] Hints (3 tiers) + editorials
- [ ] Dashboard, streak, XP, weak areas v1
- [ ] Submission history, bookmarks, notes
- [ ] Resume upload/parse/review
- [ ] AI interview: DSA + project rounds, text mode, timer, persona basic, hint budget
- [ ] Scorecard + transcript annotations + strengths/red flags
- [ ] Admin basic (problems/tests)
- [ ] Rate limiting + queue + observability basics + CI + deployed demo

## 4. Dependencies and critical path

`Auth → Problems → Judge → Submissions → (Dashboard, SRS, Contests, Analytics)`
`Resume parsing + LLM gateway + WS gateway → Interview engine → Scorecard → (Trends, Readiness, Plan)`
`Content volume` gates quality of everything: start authoring in Sprint 1 and keep a steady weekly quota (≈ 10 problems/week).

## 5. Risk register (delivery)

| Risk                               | Likelihood | Impact | Mitigation                                                                                                             |
| ---------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Judge sandbox complexity           | Medium     | High   | Start in Sprint 2 with `isolate` docs; keep language set minimal; use malicious suite early                            |
| Content creation bottleneck        | High       | High   | Weekly quota, templates, reference solution generators, reuse classic patterns, AI-assisted drafting with human review |
| LLM quality inconsistency          | Medium     | High   | Rubric + evidence validation; eval harness from Sprint 5; fallback prompts                                             |
| Scope creep                        | High       | High   | Phase gates, strict MVP, backlog grooming every sprint                                                                 |
| Time constraints (placements prep) | High       | Medium | Treat as portfolio and prep tool simultaneously; dogfood daily; reduce P3                                              |
| Voice browser variability          | Medium     | Medium | Text fallback; feature flag; test matrix                                                                               |
| Hosting cost                       | Low        | Medium | Free tiers, student credits, per-user AI budgets                                                                       |
| Pixel UI hurting readability       | Medium     | Medium | Readable mode, content fonts, usability test in Sprint 3                                                               |

## 6. Definition of Done (feature level)

1. Acceptance criteria in docs 02 to 05 pass (automated where possible).
2. Unit + integration tests; e2e for user-facing flows.
3. Accessibility checks pass; works in 3 themes.
4. Metrics/logs/traces added; alerts if critical.
5. Docs updated (API, schema, user-facing help).
6. Behind a feature flag if risky; migration reviewed.

## 7. KPIs per milestone

- M2: judge p95 < 3 s; 0 IE in 1,000 submissions.
- M4: ≥ 10 pilot users, ≥ 3 interviews each, scorecard helpfulness ≥ 75%.
- M7: ≥ 60% of active users with an active plan.
- M9: weekly contest participation ≥ 20% of WAU.
- M12: uptime ≥ 99.5%, all go-live gates (doc 14) passed.

## 8. Portfolio and resume packaging (since this is also a career project)

- Architecture diagram + README with live link and GIFs.
- Highlight talking points: sandboxed execution (`isolate`, seccomp, cgroups), queue fairness, WebSockets with replay, LLM guardrails + evaluation harness, pgvector retrieval, deterministic planning engine, observability stack, CI/CD with security scanning.
- Metrics to quote after launch: submissions judged, p95 verdict latency, users, interviews run.
- Write 2 blog posts: "Building a sandboxed judge" and "Evaluating an AI interviewer".

**Status:** Sprint 8 is finished across Phases 10 and 11 (SRS, quizzes, roadmaps, tracks, SQL practice, aptitude and the OA simulator). The next scope is Sprint 9: contests, code review mode, complexity analyzer, flashcards and shareable reports.
