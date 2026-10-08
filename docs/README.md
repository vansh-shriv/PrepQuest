# PrepQuest

> **Level up for placements.** A mock AI interview + DSA practice platform with a 90s pixel-game soul.

PrepQuest is a single platform where a placement candidate can (1) grind DSA problems with a real judge, (2) sit AI-driven mock interviews that adapt to their resume and target company, (3) get structured feedback, and (4) see exactly what to do next through analytics and an adaptive study plan.

---

## Documentation map

Read in this order the first time. After that, use the doc index as a reference.

| #   | Doc                                                                                 | What it answers                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | [PRD](01-PRD.md)                                                                    | Why are we building this, for whom, what is in scope, how do we measure success                                                                  |
| 02  | [Features: DSA Practice](02-FEATURES-DSA-PRACTICE.md)                               | Problem bank, editor, judge UX, hints, editorials, spaced repetition, contests, CS quizzes, aptitude, SQL                                        |
| 03  | [Features: AI Interview and Evaluation](03-FEATURES-AI-INTERVIEW-AND-EVALUATION.md) | Interview types, targeting, resume/JD, voice, live coding, personas, timer, scorecards, transcripts, STAR, system design                         |
| 04  | [Features: Analytics and Planning](04-FEATURES-ANALYTICS-AND-PLANNING.md)           | Dashboard, weak areas, trends, readiness score, time analysis, study plans, goals, roadmaps, company tracks                                      |
| 05  | [Features: Platform and Advanced](05-FEATURES-PLATFORM-AND-ADVANCED.md)             | Auth, history, bookmarks, themes, sharing, peer interviews, integrity, code review, complexity analyzer, flashcards, admin, engineering features |
| 06  | [User Flows and Screens](06-USER-FLOWS-AND-SCREENS.md)                              | Every journey and every screen with wireframes                                                                                                   |
| 07  | [Design System: Pixel UI](07-DESIGN-SYSTEM-PIXEL-UI.md)                             | Colors, fonts, components, sprites, motion, CSS and Tailwind tokens                                                                              |
| 08  | [Architecture](08-ARCHITECTURE.md)                                                  | Services, data flow, diagrams, scaling                                                                                                           |
| 09  | [Tech Stack and Project Structure](09-TECH-STACK-AND-PROJECT-STRUCTURE.md)          | Libraries, repo layout, conventions                                                                                                              |
| 10  | [Database Schema](10-DATABASE-SCHEMA.md)                                            | All tables, relations, indexes                                                                                                                   |
| 11  | [API Spec](11-API-SPEC.md)                                                          | REST endpoints, WebSocket events, error format                                                                                                   |
| 12  | [Code Execution and Judge](12-CODE-EXECUTION-JUDGE.md)                              | Sandbox, queue, verdicts, limits, complexity analyzer                                                                                            |
| 13  | [AI Engine: Prompts and Rubrics](13-AI-ENGINE-PROMPTS-AND-RUBRICS.md)               | Interview state machine, prompts, rubrics, guardrails                                                                                            |
| 14  | [Security and Privacy](14-SECURITY-AND-PRIVACY.md)                                  | Threat model, sandbox hardening, data handling                                                                                                   |
| 15  | [DevOps and Observability](15-DEVOPS-AND-OBSERVABILITY.md)                          | CI/CD, environments, logs, metrics, alerts                                                                                                       |
| 16  | [Testing Strategy](16-TESTING-STRATEGY.md)                                          | Unit, integration, e2e, judge and AI evaluation                                                                                                  |
| 17  | [Content and Admin Guide](17-CONTENT-AND-ADMIN-GUIDE.md)                            | How problems, test cases, quizzes are authored and published                                                                                     |
| 18  | [Roadmap and Sprints](18-ROADMAP-AND-SPRINTS.md)                                    | Phases, sprint plan, milestones, risks                                                                                                           |
| 19  | [Local Setup and Env](19-LOCAL-SETUP-AND-ENV.md)                                    | Run it on your laptop, env vars, seed data                                                                                                       |

---

## Feature ID index

Every feature has a stable ID used across all docs (schema, API, tests, roadmap).

| Group        | IDs                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DSA practice | D1 problem bank, D2 editor, D3 judge and verdicts, D4 tiered hints, D5 editorials, D6 spaced repetition, D7 contests                                           |
| AI interview | I1 types, I2 role/company targeting, I3 resume and JD, I4 conversation flow, I5 voice and text, I6 live coding, I7 difficulty and persona, I8 timer and rounds |
| Evaluation   | E1 scorecard, E2 transcript review, E3 ideal answer, E4 STAR and speech analysis, E5 red flags and strengths                                                   |
| Analytics    | A1 dashboard, A2 weak areas, A3 interview trends, A4 readiness score, A5 time per problem                                                                      |
| Planning     | P1 adaptive plan, P2 daily goals, P3 topic roadmaps, P4 company tracks                                                                                         |
| Fundamentals | C1 CS quizzes and SQL, C2 aptitude and OA, C3 system design practice                                                                                           |
| Platform     | U1 auth and profiles, U2 submission history, U3 bookmarks/tags/notes, U4 theme/shortcuts/mobile, U5 shareable reports                                          |
| Advanced     | X1 peer interviews, X2 plagiarism and AI-assist detection, X3 code review mode, X4 complexity analyzer, X5 question memory, X6 flashcards, X7 admin panel      |
| Engineering  | G1 rate limiting and queue execution, G2 caching, async, WebSockets, G3 observability, G4 CI/CD, tests, deployed demo                                          |

---

## One-paragraph architecture

A Next.js (TypeScript, Tailwind) frontend talks to a Node/TypeScript API over REST and WebSockets. Code submissions go into a Redis-backed queue (BullMQ) and are executed by isolated judge workers using `isolate` inside hardened containers. Interview sessions run through a WebSocket gateway and a session orchestrator that calls the Claude API with structured prompts, streams tokens back, and stores every turn and code event in PostgreSQL. pgvector powers resume-aware question generation and question memory. Analytics are computed by background jobs and cached in Redis.

## Vocabulary

- **Quest**: a single practice unit (a problem, a quiz, a mock interview).
- **Boss fight**: a full mock interview round.
- **XP**: points earned from activity; displayed as pixel coins.
- **Streak**: consecutive active days; displayed as a growing sunflower.
- **Skill plant**: per-topic mastery indicator that grows through stages.
- **Judge**: the service that compiles and runs code against test cases.
- **Orchestrator**: the service that runs interview state, prompts the LLM, and records turns.

## Conventions used in these docs

- "MUST", "SHOULD", "MAY" follow RFC 2119.
- Phase tags: **[MVP]**, **[P2]**, **[P3]** map to the roadmap in doc 18.
- Acceptance criteria are written so they can be turned directly into tests.
