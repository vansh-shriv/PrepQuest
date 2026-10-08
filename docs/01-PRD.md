# 01. Product Requirements Document (PRD)

## 1. Vision

Give every placement candidate the experience of a top-tier prep program: a real judge, a patient but realistic AI interviewer, honest feedback, and a plan that adapts to them. Wrap it in a nostalgic 90s pixel-game interface that makes daily practice feel like leveling up instead of grinding.

## 2. Problem statement

Candidates preparing for campus placements and off-campus SDE/ML/embedded roles face fragmented tooling:

- DSA platforms give problems but no interview simulation.
- Mock interview tools give conversation but no code judge, no resume awareness, no longitudinal tracking.
- Peer mocks are hard to schedule and feedback quality varies.
- Nobody tells the candidate which topic to practice next or whether they are actually ready for company X.
- Practice feels like a chore, so streaks collapse.

## 3. Goals and non-goals

### Goals

1. One place for DSA practice, CS fundamentals, aptitude, system design, and AI mock interviews.
2. Interviews that feel real: follow-ups, probing, time pressure, persona variety.
3. Feedback specific enough to act on (timestamped, rubric-based, with ideal answers).
4. Personalization: resume, JD, target company, placement date, available hours.
5. Measurable readiness: a score per company/role that the user can watch rise.
6. A distinctive, cohesive pixel-art experience.
7. A portfolio-grade engineering project (queues, sandboxing, WebSockets, observability, CI/CD).

### Non-goals (v1)

- Native mobile apps (responsive web only).
- Video interviews with facial analysis.
- Paid marketplace of human mentors.
- Supporting more than 3 judge languages at launch (C++, Java, Python).
- Interactive or multi-process problem types.

## 3b. Personas

| Persona                            | Description                                                    | Key needs                                                                    |
| ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Aarav, the CS final-year**       | Strong on basics, weak on interviews, 2 months to placements   | Mock interviews, company tracks, readiness score                             |
| **Vansh, the branch-switcher**     | ECE student targeting SWE/ML, has projects but thin DSA volume | Roadmaps from prerequisites, weak-area detection, project deep-dive practice |
| **Meera, the off-campus switcher** | Working, 1 hour per day                                        | Adaptive plan, daily goals, spaced repetition                                |
| **Rohan, the peer mentor**         | Senior who wants to mock-interview juniors                     | Peer interview mode, shareable reports                                       |
| **Admin / content curator**        | Maintains problem bank and quizzes                             | Admin panel, test case tooling, versioning                                   |

## 4. Scope by phase

| Phase   | Contents                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MVP** | D1, D2, D3, D4 (basic), D5, I1 (coding + project), I3, I4 (text), I7 (basic), I8, E1, E2, E5, A1, A2, U1, U2, U3, U4, G1, G2 (core), G3 (basic), G4, X7 (basic) |
| **P2**  | I5 voice, I6 live coding observation, I2 full targeting, D6, D7, E3, E4, A3, A4, A5, P1, P2, P3, P4, C1, C2, U5, X3, X4, X5, X6                                 |
| **P3**  | C3 system design canvas, X1 peer interviews, X2 integrity, advanced admin, mobile polish, plugin-style company packs                                            |

## 5. Functional requirements summary

Full detail lives in docs 02 to 05. Summary by area:

1. **Practice**: tagged problem bank, curated sheets, multi-language editor, sandboxed judge, tiered hints, editorials, spaced repetition, timed contests.
2. **Interview**: many round types, role/company targeting, resume + JD grounding, human-like conversation, voice and text, live coding awareness, persona and difficulty control, realistic timing.
3. **Feedback**: rubric scorecards, timestamped transcripts, ideal answers, STAR scoring, speech analytics, strengths and red flags.
4. **Analytics and planning**: dashboard, weak areas, trends, readiness, time analysis, adaptive plan, goals, roadmaps, company tracks.
5. **Fundamentals**: CS quizzes, SQL editor, aptitude/OA, system design canvas with AI feedback.
6. **Platform**: auth, profiles, history, notes, themes, shortcuts, mobile layout, shareable reports.
7. **Advanced**: peer mocks, integrity detection, code review, complexity analyzer, question memory, flashcards, admin panel.
8. **Engineering**: queues, caching, async jobs, WebSockets, observability, CI/CD, deployed demo.

## 6. Non-functional requirements

| Category            | Requirement                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Performance**     | Judge verdict for a typical submission (10 tests, C++) in under 3 s p95. Page TTI under 2.5 s on a mid-range laptop. First AI token in under 1.5 s p95. |
| **Availability**    | 99.5% for MVP demo deployment. Judge outage must not break browsing or interviews.                                                                      |
| **Scalability**     | 200 concurrent judge submissions and 100 concurrent interview sessions on modest infra via horizontal worker scaling.                                   |
| **Security**        | All user code runs in a sandbox with no network, strict CPU/memory/pid limits. See doc 14.                                                              |
| **Privacy**         | Resumes encrypted at rest, deletable on request, never used to train anything.                                                                          |
| **Accessibility**   | WCAG AA contrast for text, keyboard navigable, reduced-motion respected, readable body font despite pixel theme.                                        |
| **Compatibility**   | Latest two versions of Chrome, Edge, Firefox, Safari. Voice mode requires mic permission and Chrome/Edge/Safari.                                        |
| **Cost**            | Target under $0.15 average LLM cost per 45-minute interview via model tiering and caching.                                                              |
| **Maintainability** | Typed end to end, 80%+ coverage on judge and scoring logic, documented ADRs.                                                                            |
| **Observability**   | Every submission and interview turn traceable by ID across services.                                                                                    |

## 7. Success metrics

| Metric                                                  | Target (first 3 months of use) |
| ------------------------------------------------------- | ------------------------------ |
| Weekly active practicers / registered                   | 40%                            |
| Median sessions per active user per week                | 4                              |
| Mock interviews completed per active user per month     | 3                              |
| 7-day streak retention                                  | 25%                            |
| Scorecard "helpfulness" thumbs-up                       | 80%                            |
| Readiness score improvement over 4 weeks (active users) | +15 points average             |
| Judge verdict correctness vs reference solutions        | 100% on seed problems          |
| AI interviewer quality rating (1 to 5)                  | 4.0+                           |

## 8. Assumptions and constraints

- LLM access via Claude API with configurable model names per task.
- Speech-to-text via browser Web Speech API for MVP voice, upgradeable to server-side streaming STT.
- Single-region deployment initially.
- Problem content is authored in-house or from legally reusable sources; no scraping of third-party platforms.
- Free tier hosting limits shape the demo (see doc 15).

## 9. Risks

| Risk                               | Impact   | Mitigation                                                                            |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| Sandbox escape                     | Critical | `isolate` + container hardening + no network + seccomp, see doc 12 and 14             |
| LLM hallucinated feedback          | High     | Rubric-constrained JSON outputs, evidence quotes required, evaluation set, see doc 13 |
| Prompt injection through resume/JD | High     | Treat uploads as data, delimiters, output schema validation                           |
| Cost overrun                       | Medium   | Model tiering, caching, per-user daily caps                                           |
| Content licensing                  | Medium   | Original problems, public domain classics, clear provenance field                     |
| Scope explosion                    | High     | Phased roadmap, strict MVP cut                                                        |
| Voice reliability across browsers  | Medium   | Text fallback always available                                                        |
| Pixel theme hurting readability    | Medium   | Pixel fonts only for headings/UI chrome, readable mono/body for long text             |

## 10. Open questions

1. Hosted judge on a single VM vs managed container service for the demo?
2. Own problem authoring vs importing open datasets for the first 150 problems?
3. Should the leaderboard be global, per college, or both?
4. Voice: stay on browser STT or move to server STT in P2?

## 11. Glossary

See README vocabulary section.
