# 03. Features: AI Mock Interview Engine and Evaluation

Covers **I1 to I8**, **E1 to E5**, **C3** (system design practice). Prompts and rubrics are in doc 13; screens in doc 06.

---

## I1. Interview types [MVP: coding + project; others P2]

Each type is a **template** with its own state machine, question source, evaluation rubric, and default duration.

| Type                             | Duration                 | Description                                                       | Question source                                            |
| -------------------------------- | ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| **DSA/coding round**             | 45 min                   | Intro, 1 to 2 problems, optimization follow-ups, wrap up          | Problem bank (difficulty and pattern matched)              |
| **Technical CS fundamentals**    | 30 min                   | OS, DBMS, CN, OOP verbal Q&A with follow-ups                      | Question bank + LLM generation                             |
| **System design (LLD)**          | 45 min                   | Class design, SOLID, patterns, code skeleton                      | Prompt bank (parking lot, elevator, library, rate limiter) |
| **System design (HLD)**          | 60 min                   | Requirements, estimates, APIs, data model, scaling, trade-offs    | Prompt bank (URL shortener, chat, feed, notifications)     |
| **Project deep-dive**            | 30 min                   | Probes the candidate's own projects in depth                      | Resume-derived                                             |
| **HR/behavioral**                | 30 min                   | Tell me about yourself, strengths, conflicts, leadership, failure | Behavioral bank mapped to competencies                     |
| **Resume-based**                 | 30 min                   | Walks through resume line by line, tests claims                   | Resume-derived                                             |
| **Full loop** [P2]               | 2 to 3 hours in segments | Sequence of rounds with breaks, final aggregate report            | Composite                                                  |
| **Embedded/hardware round** [P2] | 40 min                   | Interrupts, RTOS, protocols, memory, C pitfalls                   | Question bank (supports ECE-to-SWE users)                  |
| **ML round** [P2]                | 40 min                   | Concepts, math, project, short coding or notebook-style reasoning | Question bank + LLM                                        |

**Behavior**: user picks type on "New Interview" screen; defaults come from target role/company (I2). Each template defines allowed tools (editor, whiteboard, notes), mode (Interview mode of editor), and required rubric dimensions.

### Acceptance criteria

- Every type produces a scorecard with its own rubric dimensions.
- Switching type resets the question plan and timer but keeps the same resume/JD context.

---

## I2. Role and company targeting [MVP basic, P2 full]

### Behavior

- **Tracks**: SDE (backend), Full-stack, Frontend, ML/AI engineer, Embedded/Firmware, Data/Analytics, Consulting-tech (e.g., digital consultant style).
- **Company profiles** (admin-curated JSON packs): typical rounds, difficulty bands, topics emphasis, behavioral competencies (e.g. leadership principles style for some companies), interview style notes, common question patterns, OA style.
- **Difficulty calibration**: an interview for "Product company, SDE-1, high bar" draws medium-hard problems and expects optimal solutions plus deeper follow-ups; "Service company" biases toward fundamentals, output prediction, simpler coding.
- **Interviewer style variations** per company pack (e.g. more behavioral weighting, more system design, more CS fundamentals).
- **Custom target**: user types any company and role; LLM generates a provisional profile flagged as "unverified" and adjustable.
- Company packs never claim to be official; UI states "Practice style inspired by public patterns".

### Acceptance criteria

- Selecting a company changes the question mix and rubric weights visibly in the interview plan preview.
- Users can override any generated plan item before starting.

---

## I3. Resume and JD upload [MVP]

### Behavior

- Upload resume (PDF, DOCX; max 5 MB) and optional job description (paste text, upload, or URL fetch [P2]).
- **Parsing pipeline**: text extraction, section detection (education, experience, projects, skills, achievements), entity extraction (technologies, metrics, dates), claim list ("reduced latency by 40%").
- **User review step**: shows parsed result; user can edit/fix before saving (prevents garbage-in).
- **JD analysis**: required skills, nice-to-haves, responsibilities, seniority signals, keywords; **gap analysis** against resume with a "match" view.
- **Question generation**: pulls from projects and claims: "Why did you choose a RAG pipeline over fine-tuning?", "Walk me through how your PID tuning handles actuator saturation". Questions tagged with source line for transparency.
- Multiple resumes supported (versions per role); one marked default.
- **Embeddings** stored in pgvector for retrieval at interview time (relevant project chunks for a given topic).
- **Privacy controls**: delete resume and derived data in one click; encrypted at rest; never shared in peer mode unless user opts to share a summary.

### Acceptance criteria

- A resume with multi-column layout still extracts correct sections on a test set of 20 resumes (90%+ section accuracy).
- Prompt injection text in the resume ("ignore previous instructions") does not change interviewer behavior (see eval set in doc 16).

---

## I4. Realistic conversation flow [MVP text]

### Behavior

The interviewer is not a Q&A bot. It follows a **state machine** (doc 13) with these behaviors:

- **Warm-up**: greeting, small talk of one or two turns, brief introduction request.
- **Problem presentation**: states the problem verbally/in text, waits; does not volunteer constraints until asked (rewards clarifying questions).
- **Clarifying questions**: answers accurately according to the problem spec; if asked something not in spec, makes a consistent decision and records it.
- **Approach discussion**: asks candidate to explain approach before coding; challenges weak reasoning ("what is the worst case here?").
- **Follow-ups and probing**: on vague answers asks for specifics; on strong answers raises difficulty ("what if the stream is unbounded?").
- **Interruptions** (persona-dependent): at most 1 to 2 per interview, e.g., cuts off rambling, or nudges when stuck for too long.
- **Hints in interviews**: given sparingly and recorded as "hint given" which affects scoring.
- **Handling silence**: after a configurable idle period, prompts ("Take your time, what are you thinking?").
- **Handling off-topic or abusive input**: redirects politely; repeated misuse ends the session with a note.
- **Closing**: asks if the candidate has questions; answers a few; thanks them; indicates results available.
- **Consistency**: remembers what has been said in the session (rolling summary + full transcript retrieval), never contradicts earlier answers.

### Acceptance criteria

- Interviewer asks at least one clarifying-aware follow-up per coding problem in 90% of test runs.
- No turn exceeds 120 words in conversation mode unless explaining a problem.
- Session state survives a browser refresh (rejoin and continue).

---

## I5. Voice mode and text mode [P2 voice]

### Behavior

- **Text mode** (MVP): chat panel with typing indicator and streamed tokens.
- **Voice mode**:
  - Speech-to-text: browser Web Speech API for MVP, then streaming STT service for accuracy and word-level timestamps.
  - Text-to-speech: browser SpeechSynthesis for MVP; neural TTS option [P3]. Voice and speed selectable.
  - **Push-to-talk** and **hands-free (voice activity detection)** options.
  - **Barge-in**: user can interrupt the interviewer; TTS stops, partial transcript sent.
  - Captions always on (accessibility and review).
  - Mic check screen: level meter, noise warning, permission help.
  - **Latency target**: end of user speech to first audio of reply under 2.5 s.
- **Mixed mode**: speak while coding, type answers when needed. Mode can be toggled mid-session.
- **Audio retention**: audio is optional to store (default off); transcript always stored with word timestamps for E4.

### Acceptance criteria

- If mic permission is denied, the session continues in text mode without data loss.
- Transcript timestamps align with audio within 300 ms.

---

## I6. Live coding with the AI watching [P2]

### Behavior

- The editor streams **code events** to the session (debounced snapshots every 3 to 5 s, plus run/submit events): code diff, cursor activity, test runs and results, time idle, paste events.
- The interviewer reacts contextually:
  - Candidate starts coding without approach: "Before you write code, can you walk me through your plan?"
  - Candidate runs and fails: waits, then asks "What do you think the failing case tells you?"
  - Candidate stuck over N minutes: offers a graded nudge (and logs it).
  - Candidate reaches AC: asks complexity, then "Can you optimize space?" or "How would this change if input is streamed?"
  - Detects code smells in live code (e.g., nested loops giving O(n^2)): asks about complexity rather than stating it.
- **Think-aloud scoring**: voice transcript aligned with code events to see whether the candidate explains while coding.
- **Rate limiting of AI reactions**: no more than one proactive message per 60 s unless the candidate asks.
- **Privacy**: code events are only used for this session; they are stored in the interview event log for review (E2).

### Acceptance criteria

- Proactive messages never fire during active typing bursts (cooldown after last keystroke).
- Event log replays the candidate's code evolution in the review screen (timeline scrubber).

---

## I7. Adjustable difficulty and persona [MVP basic]

### Personas

| Persona                        | Behavior                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------- |
| **Friendly mentor**            | Encouraging, gives gentle hints, explains afterward, good for beginners      |
| **Neutral professional**       | Realistic default, few hints, polite pushback                                |
| **Strict interviewer**         | Minimal hints, challenges assumptions, tight on edge cases and complexity    |
| **Rapid-fire**                 | Short questions, short time per question, many topics, good for fundamentals |
| **Skeptical senior** [P2]      | Challenges design decisions and trade-offs, ideal for system design          |
| **Behavioral specialist** [P2] | Deep STAR probing, pressure on vague stories                                 |

### Difficulty controls

- Overall level (1 to 5) mapped to problem difficulty, follow-up depth, hint budget, and time pressure.
- **Adaptive mode**: after each answer, the engine adjusts the next question's difficulty (up if strong, down if struggling), bounded by user-defined range.
- Hint budget (0 to 3), interruption frequency (off/low/normal), and speaking pace (voice) configurable.

### Acceptance criteria

- Persona changes tone and behavior in a blind evaluation set (human raters can identify persona 80%+).
- Hint budget is enforced by the engine (not only by prompt).

---

## I8. Timer and round structure [MVP]

### Behavior

- Each template defines **segments** with target durations, e.g. 45-min coding: intro 5, problem 1 (20), problem 2 or follow-up (15), questions and wrap-up 5.
- Visible countdown (pixel clock) with segment markers; **soft warnings** at 10 and 5 minutes remaining; hard end at 0 (graceful: the interviewer asks to wrap up in 60 s).
- Server-authoritative timer (client displays; reconnecting never resets).
- **Pause** is allowed once for up to 3 minutes in practice mode (logged); disabled in "realistic" mode.
- **Round transitions** in full-loop mode with break screens.
- **Early finish** allowed with confirmation; scorecard notes reduced coverage.

### Acceptance criteria

- Session ends within 5 s of timer expiry even if the client is disconnected.
- Reports show actual time spent per segment against plan.

---

## E1. Scorecard per session [MVP]

### Rubric dimensions (coding interview example)

| Dimension       | What is assessed                                   | Weight |
| --------------- | -------------------------------------------------- | ------ |
| Problem solving | Approach quality, decomposition, handling of hints | 25%    |
| Code quality    | Readability, naming, structure, idioms             | 15%    |
| Communication   | Clarity, structure, think-aloud, asking questions  | 20%    |
| Optimization    | Complexity awareness, improvements found           | 15%    |
| Edge cases      | Identification and handling                        | 10%    |
| Testing         | Dry-runs, test choice, debugging approach          | 10%    |
| Correctness     | Final solution result (from judge)                 | 5%     |

Other templates use their own dimensions (e.g., HLD: requirements, estimation, architecture, data modeling, scalability, trade-offs; behavioral: structure, specificity, ownership, impact, reflection).

### Behavior

- Each dimension is scored 1 to 5 with a short justification and **evidence quotes** (transcript spans or code lines) with timestamps.
- Overall score 0 to 100, plus verdict band: "Not ready / Borderline / Ready / Strong".
- Pixel-style radar chart and bar breakdown.
- Comparison to previous sessions and to target company bar.
- Output is **structured JSON** validated against a schema before display (doc 13).
- **Calibration**: scores are anchored by rubric descriptors for each level so 3/5 means the same thing across sessions.

### Acceptance criteria

- Every score has at least one evidence reference; scores without evidence are rejected and regenerated.
- Scorecard generation completes within 30 s of session end (shown with loading bar, then notification).

---

## E2. Transcript review with timestamped feedback [MVP]

### Behavior

- Full transcript with speaker labels, timestamps, and code event markers in a unified timeline.
- **Inline annotations**: AI comments anchored to moments ("0:07:12 You started coding before confirming input constraints", "0:21:40 Good catch on the empty array case").
- Annotation types: positive, improvement, missed opportunity, red flag.
- **Replay**: scrub through the session, watch code evolve alongside transcript.
- **Filters**: by annotation type, by segment, by dimension.
- **Export**: PDF/Markdown transcript with annotations.
- User can add personal notes to any moment and mark moments to convert into flashcards (X6).

### Acceptance criteria

- Annotations link to exact transcript offsets; clicking jumps the playback.
- Review page loads in under 2 s for a 45-minute session.

---

## E3. Ideal answer comparison [P2]

### Behavior

- For each question asked, generate **a strong-candidate answer** at the target level, structured (clarify, approach, complexity, edge cases, code or talk track).
- Side-by-side with the user's answer; highlights **gaps** (missing points) and **extras** (good points the ideal missed).
- For coding: shows an ideal approach progression (brute force to optimal) with how a strong candidate would narrate it.
- For behavioral: rewrites the user's story in STAR form using only the facts the user supplied (no invention), flagged clearly.
- "Practice again" button reopens the same question with the ideal as a hidden benchmark.

### Acceptance criteria

- Ideal answers for fact-based questions are checked against the question bank reference answers when available.
- Behavioral rewrites never add facts not present in the transcript (verified by an eval check).

---

## E4. Behavioral STAR scoring and speech analysis [P2]

### STAR scoring

- Detect Situation, Task, Action, Result components in each behavioral answer; score each 0 to 2 and check for **specifics** (numbers, names, timelines), **ownership** ("I" vs "we"), **impact** and **reflection/learning**.
- Output: STAR completeness bar and rewrite suggestions.

### Speech analytics (voice sessions)

- **Filler words**: count and rate per minute (um, uh, like, you know, basically, actually, so...), top offenders.
- **Pace**: words per minute overall and over time graph; flags too fast (over 170) or too slow (under 110).
- **Pauses**: long pauses (over 4 s) timeline; distinguishes thinking pauses (good while coding) vs dead air.
- **Clarity indicators**: sentence length, hedging language ("maybe", "I guess"), confidence markers.
- **Trend** across sessions.

### Acceptance criteria

- Filler counts are within 10% of a human-labeled sample of 10 transcripts.
- Speech analytics are optional and clearly labeled as indicative, not diagnostic.

---

## E5. Red flags and strengths summary [MVP]

### Behavior

- **Strengths**: 3 to 5 concrete bullets with evidence ("Strong complexity analysis, quickly identified O(n log n) bound").
- **Red flags**: 0 to 5 items categorized as technical (wrong complexity claims), process (no testing), communication (long silences, no clarification), professionalism (dismissive tone), integrity (suspicious paste during interview mode).
- **Next actions**: 3 specific recommendations that deep-link into the platform (practice set, quiz, roadmap node, flashcards).
- Severity levels (low/medium/high) with explanation of why an interviewer would care.

### Acceptance criteria

- Every red flag has evidence and a suggested remedy.
- Next actions create tasks in the study plan with one click (P1).

---

## C3. System design practice with canvas and AI feedback [P3]

### Behavior

- **Canvas**: whiteboard with pixel-styled shapes (service box, database cylinder, queue, cache, load balancer, client, CDN), arrows with labels, text notes, grouping, snap-to-grid; export to PNG/JSON. Built on tldraw or Excalidraw with custom pixel shape library.
- **Structured side panel**: requirements (functional/non-functional), capacity estimates calculator (QPS, storage, bandwidth), API list, data model, deep-dive notes.
- **AI feedback**:
  - Converts canvas JSON to a structured graph description for the model.
  - Reviews for: missing components, single points of failure, bottlenecks, consistency/availability trade-offs, data partitioning, caching strategy, failure handling, cost.
  - Interactive mode: AI asks probing questions as an interviewer ("What happens when the cache node dies?") during the HLD interview type.
  - After session: rubric scorecard (requirements, estimation, architecture, data, scalability, trade-offs, communication).
- **Reference solutions** for each prompt with a layered view (v1 simple, v2 scaled, v3 global) for learning.
- **LLD mode**: UML-lite class diagram editor plus code stub generation and review against SOLID.

### Acceptance criteria

- Canvas autosaves and restores; undo/redo works for 100 steps.
- Canvas to graph conversion preserves node types and edge direction on 20 sample designs.

## As built (Phase 16): C3 system design practice

Canvas with ten pixel component types, labelled arrows, snap to grid, undo and redo for 100 steps (met: `design.test.ts`), autosave with versions, export to PNG and JSON. Structured side panel with requirements, a capacity calculator, API list, data model and notes. Review: the canvas becomes a graph (types and edge direction preserved on 20 sample designs: met), automatic checks run without a model, and the model returns scores for the seven rubric areas, findings that cite components, and five probing questions. Reference designs in three layers (simple, scaled, global) for four prompts, opened after the learner's own attempt is reviewed. Not built: the interviewer asking about the drawing during the HLD interview, the after-session scorecard from a live interview, LLD mode.

## As built (Phase 17): drawing board in the HLD interview

The system design round has a drawing board beside the chat. The interviewer reads the drawing (components, arrows, automatic checks) on every turn, asks about it by component name and never draws for the candidate. The scorecard may quote the drawing as evidence (`ref: "design"`), verified against the drawing text; with an empty board it is told so. The review has a "Your drawing" tab with the final board and the checks. Not built: proactive reactions to drawing activity, a drawing replay, LLD diagrams.
