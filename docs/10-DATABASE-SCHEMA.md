# 10. Database Schema (PostgreSQL 16)

Conventions: UUID v7 PKs, `created_at`/`updated_at` timestamptz on every table (omitted below for brevity), snake_case, FK `ON DELETE` behavior noted, enums as Postgres enums or check constraints. Extensions: `pgcrypto`, `pg_trgm`, `vector`, `citext`.

Feature tags in comments map to feature IDs.

---

## 1. Entity overview

```
users ─┬─ profiles ─ user_settings
       ├─ oauth_accounts, auth_sessions, email_tokens
       ├─ resumes ─ resume_chunks(vector)      job_descriptions
       ├─ submissions ─ submission_results     code_drafts, custom_tests
       ├─ user_problem_state ─ srs_cards ─ srs_reviews
       ├─ bookmarks, notes, user_tags
       ├─ interview_sessions ─ interview_turns, interview_events,
       │                       interview_scorecards ─ scorecard_scores,
       │                       transcript_annotations, ideal_answers, speech_metrics
       ├─ question_memory(vector)
       ├─ quiz_attempts ─ quiz_attempt_answers
       ├─ study_plans ─ plan_tasks   daily_goals   topic_mastery
       ├─ readiness_snapshots        xp_events, badges_earned
       ├─ flashcard_decks ─ flashcards ─ flashcard_reviews
       ├─ shared_reports             notifications
       └─ peer_availability, peer_sessions, peer_feedback

problems ─┬─ problem_tags ─ tags
          ├─ problem_companies ─ companies
          ├─ test_cases, problem_languages (limits/templates)
          ├─ hints, editorials, problem_versions
          └─ sheet_problems ─ sheets
contests ─ contest_problems, contest_registrations, contest_submissions
company_packs, roadmaps ─ roadmap_nodes ─ roadmap_edges
quiz_questions, quiz_sets, aptitude_items, oa_templates, sql_problems, sql_datasets
system_design_prompts, design_canvases
integrity_flags, code_reviews, complexity_analyses
admin_audit_log, feature_flags, rate_limit_overrides, llm_usage
```

---

## 2. Core DDL

### 2.1 Identity and accounts (U1)

```sql
CREATE TYPE user_role AS ENUM ('user','content_editor','reviewer','moderator','support','admin');

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email citext UNIQUE NOT NULL,
  email_verified_at timestamptz,
  password_hash text,                       -- argon2id, null for OAuth-only
  role user_role NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending_deletion')),
  deletion_requested_at timestamptz,
  last_login_at timestamptz
);

CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  handle citext UNIQUE NOT NULL,
  display_name text NOT NULL,
  avatar_key text,                          -- preset id or storage key
  bio text, college text, branch text, grad_year int,
  country text, timezone text NOT NULL DEFAULT 'UTC',
  links jsonb NOT NULL DEFAULT '{}',        -- github, linkedin, leetcode, codeforces
  public_profile boolean NOT NULL DEFAULT false,
  privacy jsonb NOT NULL DEFAULT '{}',
  placement_date date,
  hours_per_day jsonb,                      -- {"mon":2,"tue":1.5,...}
  target_roles text[] , target_companies text[],
  track text,                               -- sde | fullstack | ml | embedded | data
  onboarding_completed_at timestamptz,
  xp bigint NOT NULL DEFAULT 0, level int NOT NULL DEFAULT 1,
  streak_current int NOT NULL DEFAULT 0, streak_best int NOT NULL DEFAULT 0,
  streak_last_active date, streak_freezes int NOT NULL DEFAULT 1
);

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  theme text DEFAULT 'system',              -- cream | night | contrast | system
  readable_mode boolean DEFAULT false, retro_cursor boolean DEFAULT true,
  sound boolean DEFAULT false, reduced_motion boolean DEFAULT false,
  editor jsonb DEFAULT '{}',                -- font, tab size, vim, minimap
  shortcuts jsonb DEFAULT '{}',
  hint_mode text DEFAULT 'strict',          -- strict | relaxed
  open_editorials boolean DEFAULT false,
  default_language text DEFAULT 'cpp',
  notifications jsonb DEFAULT '{}', quiet_hours jsonb,
  personalized_callbacks boolean DEFAULT true   -- X5
);

CREATE TABLE oauth_accounts (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider text NOT NULL, provider_user_id text NOT NULL, UNIQUE(provider, provider_user_id)
);

CREATE TABLE auth_sessions (          -- refresh token families
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  family_id uuid NOT NULL, token_hash text NOT NULL, user_agent text, ip inet,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, replaced_by uuid
);
CREATE INDEX ON auth_sessions (user_id, revoked_at);

CREATE TABLE email_tokens (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL, token_hash text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz
);
```

### 2.2 Problem bank (D1, D2, D4, D5, X7)

```sql
CREATE TYPE difficulty AS ENUM ('easy','medium','hard');
CREATE TYPE publish_status AS ENUM ('draft','in_review','published','archived');

CREATE TABLE problems (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  statement_md text NOT NULL,
  constraints_md text,
  difficulty difficulty NOT NULL,
  examples jsonb NOT NULL,                -- [{input, output, explanation}]
  checker text NOT NULL DEFAULT 'exact',  -- exact | tokens | float | special
  checker_config jsonb,
  est_minutes int, acceptance_rate numeric(5,2) DEFAULT 0,
  submissions_count int DEFAULT 0, accepted_count int DEFAULT 0,
  source text, license text,              -- provenance
  status publish_status NOT NULL DEFAULT 'draft',
  current_version int NOT NULL DEFAULT 1,
  search tsvector,
  created_by uuid REFERENCES users
);
CREATE INDEX problems_search_idx ON problems USING gin(search);
CREATE INDEX problems_title_trgm ON problems USING gin(title gin_trgm_ops);
CREATE INDEX problems_filter_idx ON problems (status, difficulty);

CREATE TABLE problem_versions (
  problem_id uuid REFERENCES problems ON DELETE CASCADE, version int,
  snapshot jsonb NOT NULL, changed_by uuid REFERENCES users, change_note text,
  PRIMARY KEY (problem_id, version)
);

CREATE TABLE tags (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('topic','pattern')),
  slug text UNIQUE NOT NULL, name text NOT NULL, parent_id uuid REFERENCES tags
);
CREATE TABLE problem_tags (
  problem_id uuid REFERENCES problems ON DELETE CASCADE,
  tag_id uuid REFERENCES tags, PRIMARY KEY (problem_id, tag_id)
);
CREATE INDEX ON problem_tags (tag_id);

CREATE TABLE companies (
  id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, pack_id uuid
);
CREATE TABLE problem_companies (
  problem_id uuid REFERENCES problems ON DELETE CASCADE,
  company_id uuid REFERENCES companies,
  frequency smallint DEFAULT 1, last_seen_year smallint,
  PRIMARY KEY (problem_id, company_id)
);

CREATE TABLE problem_languages (         -- per-language limits + templates
  problem_id uuid REFERENCES problems ON DELETE CASCADE,
  language text NOT NULL,                -- cpp | java | python | ...
  time_limit_ms int NOT NULL, memory_limit_kb int NOT NULL,
  starter_code text NOT NULL, driver_code text,   -- hidden harness
  PRIMARY KEY (problem_id, language)
);

CREATE TABLE test_cases (
  id uuid PRIMARY KEY, problem_id uuid NOT NULL REFERENCES problems ON DELETE CASCADE,
  version int NOT NULL, ordinal int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sample','hidden','edge','stress')),
  label text,                              -- shown on failure: "edge: empty input"
  input_key text NOT NULL, output_key text NOT NULL,   -- object storage keys
  input_bytes int, weight int DEFAULT 1,
  UNIQUE (problem_id, version, ordinal)
);

CREATE TABLE hints (                      -- D4
  id uuid PRIMARY KEY, problem_id uuid REFERENCES problems ON DELETE CASCADE,
  tier smallint NOT NULL CHECK (tier BETWEEN 1 AND 3), body_md text NOT NULL,
  UNIQUE (problem_id, tier)
);

CREATE TABLE editorials (                 -- D5
  id uuid PRIMARY KEY, problem_id uuid REFERENCES problems ON DELETE CASCADE,
  approaches jsonb NOT NULL,              -- [{name, intuition, steps, code:{lang:code}, time, space, pitfalls}]
  talk_track_md text, related_problem_ids uuid[]
);

CREATE TABLE sheets (
  id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, title text NOT NULL, description text,
  owner_id uuid REFERENCES users, visibility text DEFAULT 'public',   -- public | private
  company_id uuid REFERENCES companies, version int DEFAULT 1
);
CREATE TABLE sheet_problems (
  sheet_id uuid REFERENCES sheets ON DELETE CASCADE,
  problem_id uuid REFERENCES problems, section text, ordinal int NOT NULL,
  PRIMARY KEY (sheet_id, problem_id)
);
```

### 2.3 Submissions and judge (D3, U2, A5)

```sql
CREATE TYPE verdict AS ENUM ('QUEUED','COMPILING','RUNNING','AC','WA','TLE','MLE','RE','CE','OLE','IE');

CREATE TABLE submissions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  problem_id uuid NOT NULL REFERENCES problems,
  problem_version int NOT NULL,
  language text NOT NULL, code text NOT NULL, code_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('run','submit')),
  mode text NOT NULL DEFAULT 'practice' CHECK (mode IN ('practice','contest','interview','review')),
  contest_id uuid, interview_session_id uuid,
  verdict verdict NOT NULL DEFAULT 'QUEUED',
  time_ms int, memory_kb int, passed int, total int,
  failing_test_ordinal int, compile_output text, stderr_tail text,
  hints_used smallint DEFAULT 0, note text,
  active_seconds int, first_run_seconds int,      -- A5 metrics
  idempotency_key text, queued_at timestamptz, started_at timestamptz, finished_at timestamptz
);
CREATE INDEX ON submissions (user_id, created_at DESC);
CREATE INDEX ON submissions (user_id, problem_id, created_at DESC);
CREATE INDEX ON submissions (problem_id, verdict, time_ms);
CREATE INDEX ON submissions (contest_id, user_id) WHERE contest_id IS NOT NULL;
CREATE UNIQUE INDEX ON submissions (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE submission_results (
  submission_id uuid REFERENCES submissions ON DELETE CASCADE,
  test_ordinal int, verdict verdict NOT NULL,
  time_ms int, memory_kb int, stdout_tail text, stderr_tail text, checker_msg text,
  PRIMARY KEY (submission_id, test_ordinal)
);

CREATE TABLE code_drafts (                -- D2 autosave
  user_id uuid REFERENCES users ON DELETE CASCADE, problem_id uuid REFERENCES problems,
  language text, code text NOT NULL, cursor jsonb, version int DEFAULT 1,
  PRIMARY KEY (user_id, problem_id, language)
);
CREATE TABLE draft_history (user_id uuid, problem_id uuid, language text, code text, saved_at timestamptz DEFAULT now());

CREATE TABLE custom_tests (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE,
  problem_id uuid REFERENCES problems, label text, input text NOT NULL
);

CREATE TABLE problem_events (             -- A5 raw timing events (partition monthly at scale)
  id bigserial PRIMARY KEY, user_id uuid, problem_id uuid, kind text, at timestamptz DEFAULT now(), meta jsonb
);
CREATE INDEX ON problem_events (user_id, problem_id, at);
```

### 2.4 Per-user problem state, SRS (D6, U3)

```sql
CREATE TABLE user_problem_state (
  user_id uuid REFERENCES users ON DELETE CASCADE, problem_id uuid REFERENCES problems,
  status text NOT NULL DEFAULT 'unseen' CHECK (status IN ('unseen','attempted','solved')),
  attempts int DEFAULT 0, first_ac_at timestamptz, first_try_ac boolean,
  best_time_ms int, hints_used smallint DEFAULT 0, clean_solve boolean DEFAULT false,
  total_active_seconds int DEFAULT 0, solve_rating text,   -- easy|good|hard|again
  last_submission_at timestamptz,
  PRIMARY KEY (user_id, problem_id)
);

CREATE TABLE srs_cards (                  -- shared for problems; flashcards use own table
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE,
  problem_id uuid REFERENCES problems, ease numeric(4,2) DEFAULT 2.5,
  interval_days int DEFAULT 0, repetitions int DEFAULT 0, lapses int DEFAULT 0,
  due_at timestamptz NOT NULL, suspended boolean DEFAULT false,
  UNIQUE (user_id, problem_id)
);
CREATE INDEX ON srs_cards (user_id, due_at) WHERE suspended = false;
CREATE TABLE srs_reviews (id uuid PRIMARY KEY, card_id uuid REFERENCES srs_cards ON DELETE CASCADE,
  quality smallint, reviewed_at timestamptz DEFAULT now(), prev_interval int, new_interval int);

CREATE TABLE hint_usage (user_id uuid, problem_id uuid, tier smallint, used_at timestamptz DEFAULT now(),
  mode text, PRIMARY KEY (user_id, problem_id, tier));
CREATE TABLE bookmarks (user_id uuid, problem_id uuid, folder text DEFAULT 'default', PRIMARY KEY (user_id, problem_id));
CREATE TABLE user_tags (id uuid PRIMARY KEY, user_id uuid, name text, color text, UNIQUE (user_id, name));
CREATE TABLE user_tag_links (tag_id uuid REFERENCES user_tags ON DELETE CASCADE, entity_type text, entity_id uuid, PRIMARY KEY (tag_id, entity_type, entity_id));
CREATE TABLE notes (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE,
  entity_type text NOT NULL,              -- problem | interview_moment | quiz_question | general
  entity_id uuid, body_md text NOT NULL, version int DEFAULT 1, search tsvector
);
CREATE TABLE note_versions (note_id uuid REFERENCES notes ON DELETE CASCADE, version int, body_md text, PRIMARY KEY (note_id, version));
```

### 2.5 Contests (D7)

```sql
CREATE TABLE contests (
  id uuid PRIMARY KEY, slug text UNIQUE, title text, kind text,   -- weekly | oa | private | virtual
  scoring text NOT NULL DEFAULT 'icpc',                          -- icpc | points
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  freeze_minutes int DEFAULT 0, visibility text DEFAULT 'public', invite_code text,
  org_id uuid, rated boolean DEFAULT false, status text DEFAULT 'scheduled'
);
CREATE TABLE contest_problems (contest_id uuid REFERENCES contests ON DELETE CASCADE, problem_id uuid REFERENCES problems,
  label text, points int DEFAULT 100, ordinal int, PRIMARY KEY (contest_id, problem_id));
CREATE TABLE contest_registrations (contest_id uuid REFERENCES contests ON DELETE CASCADE, user_id uuid REFERENCES users,
  joined_at timestamptz DEFAULT now(), rating_before int, rating_after int, final_rank int, PRIMARY KEY (contest_id, user_id));
CREATE TABLE contest_standings (contest_id uuid, user_id uuid, solved int, penalty_minutes int, score int, per_problem jsonb,
  PRIMARY KEY (contest_id, user_id));   -- persisted at end; live standings in Redis ZSET
```

### 2.6 Resumes and JDs (I3)

```sql
CREATE TABLE resumes (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE,
  label text, file_key text NOT NULL, mime text, bytes int,
  status text DEFAULT 'uploaded',         -- uploaded | parsing | needs_review | ready | failed
  parsed jsonb,                           -- {education[], experience[], projects[], skills[], achievements[]}
  claims jsonb,                           -- [{text, source_section, metric}]
  is_default boolean DEFAULT false, user_confirmed_at timestamptz
);
CREATE TABLE resume_chunks (
  id uuid PRIMARY KEY, resume_id uuid REFERENCES resumes ON DELETE CASCADE,
  section text, text text NOT NULL, embedding vector(1024)
);
CREATE INDEX ON resume_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE job_descriptions (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE,
  company text, role text, raw_text text NOT NULL,
  analysis jsonb,                         -- {required[], nice[], responsibilities[], seniority}
  gap jsonb, resume_id uuid REFERENCES resumes
);
```

### 2.7 Interviews and evaluation (I1 to I8, E1 to E5, X5)

```sql
CREATE TYPE interview_state AS ENUM ('SETUP','WARMUP','PROBLEM','CLARIFY','APPROACH','CODING','TESTING','OPTIMIZE','FOLLOWUP','WRAPUP','ENDING','COMPLETED','ABANDONED','FAILED');

CREATE TABLE interview_templates (
  id uuid PRIMARY KEY, type text NOT NULL, title text, default_minutes int,
  segments jsonb NOT NULL,                -- [{name, minutes, kind}]
  rubric_id text NOT NULL, config jsonb, status publish_status DEFAULT 'published'
);

CREATE TABLE interview_sessions (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE,
  template_id uuid REFERENCES interview_templates, type text NOT NULL,
  role text, company_id uuid REFERENCES companies, level text,
  resume_id uuid REFERENCES resumes, jd_id uuid REFERENCES job_descriptions,
  persona text NOT NULL DEFAULT 'neutral', difficulty smallint NOT NULL DEFAULT 3,
  adaptive boolean DEFAULT true, hint_budget smallint DEFAULT 2, interruption_level text DEFAULT 'normal',
  mode text NOT NULL DEFAULT 'text',      -- text | voice | mixed
  realistic boolean DEFAULT true,
  state interview_state NOT NULL DEFAULT 'SETUP',
  plan jsonb NOT NULL,                    -- selected questions/problems, segments
  state_data jsonb NOT NULL DEFAULT '{}', rolling_summary text,
  hints_given smallint DEFAULT 0, pauses_used smallint DEFAULT 0,
  planned_seconds int NOT NULL, started_at timestamptz, ends_at timestamptz, ended_at timestamptz,
  end_reason text,                        -- completed | timer | user | abandoned | error
  prompt_version text, model_config jsonb
);
CREATE INDEX ON interview_sessions (user_id, created_at DESC);

CREATE TABLE interview_turns (
  id uuid PRIMARY KEY, session_id uuid REFERENCES interview_sessions ON DELETE CASCADE,
  seq int NOT NULL, speaker text NOT NULL CHECK (speaker IN ('interviewer','candidate','system')),
  text text NOT NULL, offset_ms int NOT NULL,              -- time since start
  modality text DEFAULT 'text', words jsonb,               -- word-level timestamps for voice (E4)
  meta jsonb,                                              -- {hint_given, state_before/after, tokens}
  UNIQUE (session_id, seq)
);
CREATE TABLE interview_events (           -- I6 code + system events (partition monthly)
  id bigserial PRIMARY KEY, session_id uuid REFERENCES interview_sessions ON DELETE CASCADE,
  offset_ms int NOT NULL, kind text NOT NULL,  -- code_snapshot | run | submit | paste | focus_lost | idle | pause
  payload jsonb NOT NULL
);
CREATE INDEX ON interview_events (session_id, offset_ms);

CREATE TABLE interview_scorecards (
  id uuid PRIMARY KEY, session_id uuid UNIQUE REFERENCES interview_sessions ON DELETE CASCADE,
  rubric_id text NOT NULL, rubric_version text NOT NULL,
  overall smallint NOT NULL, band text NOT NULL,
  summary text, strengths jsonb, red_flags jsonb, next_actions jsonb,
  model text, prompt_version text, status text DEFAULT 'ready'
);
CREATE TABLE scorecard_scores (
  scorecard_id uuid REFERENCES interview_scorecards ON DELETE CASCADE,
  dimension text, score smallint CHECK (score BETWEEN 1 AND 5), weight numeric(4,3),
  justification text, evidence jsonb NOT NULL,             -- [{type:'turn'|'code', ref, quote}]
  PRIMARY KEY (scorecard_id, dimension)
);
CREATE TABLE transcript_annotations (
  id uuid PRIMARY KEY, session_id uuid REFERENCES interview_sessions ON DELETE CASCADE,
  offset_ms int, turn_seq int, kind text CHECK (kind IN ('positive','improve','missed','red_flag')),
  dimension text, text text NOT NULL, severity text
);
CREATE TABLE ideal_answers (
  id uuid PRIMARY KEY, session_id uuid REFERENCES interview_sessions ON DELETE CASCADE,
  question_ref text, user_answer_summary text, ideal_md text, gaps jsonb, extras jsonb
);
CREATE TABLE speech_metrics (
  session_id uuid PRIMARY KEY REFERENCES interview_sessions ON DELETE CASCADE,
  wpm numeric, filler_counts jsonb, filler_per_min numeric, long_pauses jsonb,
  hedging_rate numeric, series jsonb
);
CREATE TABLE star_scores (
  id uuid PRIMARY KEY, session_id uuid REFERENCES interview_sessions ON DELETE CASCADE, turn_seq int,
  s smallint, t smallint, a smallint, r smallint, specificity smallint, ownership smallint, reflection smallint, rewrite_md text
);

CREATE TABLE question_memory (            -- X5
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE,
  session_id uuid REFERENCES interview_sessions ON DELETE SET NULL,
  kind text,                              -- problem | cs | behavioral | design
  ref_id uuid, question_text text NOT NULL, embedding vector(1024),
  outcome smallint, weak boolean DEFAULT false, asked_at timestamptz DEFAULT now()
);
CREATE INDEX ON question_memory USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON question_memory (user_id, asked_at DESC);

CREATE TABLE question_bank (              -- CS/behavioral/embedded/ML verbal questions
  id uuid PRIMARY KEY, category text, topic text, difficulty smallint, text text NOT NULL,
  reference_answer text, followups jsonb, tags text[], status publish_status DEFAULT 'published'
);
```

### 2.8 Quizzes, aptitude, SQL (C1, C2)

```sql
CREATE TABLE quiz_questions (
  id uuid PRIMARY KEY, subject text NOT NULL, topic text, difficulty smallint,
  type text NOT NULL,                     -- single | multi | tf | blank | short | output
  body_md text NOT NULL, options jsonb, answer jsonb NOT NULL, explanation_md text,
  interview_line text, status publish_status DEFAULT 'published', tags text[]
);
CREATE TABLE quiz_sets (id uuid PRIMARY KEY, title text, subject text, question_ids uuid[], minutes int, kind text);
CREATE TABLE quiz_attempts (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE, set_id uuid, mode text,
  started_at timestamptz, finished_at timestamptz, score numeric, total int, meta jsonb
);
CREATE TABLE quiz_attempt_answers (
  attempt_id uuid REFERENCES quiz_attempts ON DELETE CASCADE, question_id uuid REFERENCES quiz_questions,
  response jsonb, correct boolean, time_ms int, PRIMARY KEY (attempt_id, question_id)
);
CREATE TABLE aptitude_items (id uuid PRIMARY KEY, section text, topic text, difficulty smallint,
  body_md text, options jsonb, answer jsonb, explanation_md text, shortcut_md text, est_seconds int);
CREATE TABLE oa_templates (id uuid PRIMARY KEY, company_id uuid, title text, sections jsonb, negative_marking numeric, calculator boolean);
CREATE TABLE oa_attempts (id uuid PRIMARY KEY, user_id uuid, template_id uuid, state jsonb, started_at timestamptz,
  section_deadlines jsonb, finished_at timestamptz, report jsonb);

CREATE TABLE sql_datasets (id uuid PRIMARY KEY, slug text UNIQUE, schema_sql text, seed_sql text, dialect text);
CREATE TABLE sql_problems (id uuid PRIMARY KEY, dataset_id uuid REFERENCES sql_datasets, slug text UNIQUE, title text,
  statement_md text, expected_query text, order_sensitive boolean DEFAULT false, difficulty difficulty, allowed_statements text[]);
```

### 2.9 Planning, goals, mastery, readiness (A1 to A5, P1 to P4)

```sql
CREATE TABLE topic_mastery (
  user_id uuid REFERENCES users ON DELETE CASCADE, topic_slug text,
  mastery numeric(4,3), confidence numeric(4,3), evidence_count int, components jsonb,
  weakness numeric(5,3), diagnosis text, updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, topic_slug)
);
CREATE TABLE readiness_snapshots (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE, target_key text NOT NULL, -- company:role
  score numeric(5,2), band numeric(4,2), components jsonb, limiting jsonb, eta_date date, snap_date date NOT NULL,
  UNIQUE (user_id, target_key, snap_date)
);
CREATE TABLE study_plans (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE, target_key text,
  placement_date date, inputs jsonb NOT NULL, phases jsonb, version int DEFAULT 1, active boolean DEFAULT true, narrative_md text
);
CREATE TABLE plan_tasks (
  id uuid PRIMARY KEY, plan_id uuid REFERENCES study_plans ON DELETE CASCADE,
  planned_date date NOT NULL, kind text NOT NULL,   -- problem | quiz | review | mock | aptitude | reading | flashcards
  ref_type text, ref_id uuid, title text, est_minutes int, status text DEFAULT 'todo',  -- todo | done | skipped | moved
  locked boolean DEFAULT false, why text, completed_at timestamptz
);
CREATE INDEX ON plan_tasks (plan_id, planned_date);
CREATE TABLE plan_diffs (id uuid PRIMARY KEY, plan_id uuid, from_version int, to_version int, diff jsonb, created_at timestamptz DEFAULT now());

CREATE TABLE daily_goals (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE, goal_date date NOT NULL,
  items jsonb NOT NULL,                  -- [{type,target,progress,done}]
  completed boolean DEFAULT false, UNIQUE (user_id, goal_date)
);
CREATE TABLE goal_templates (user_id uuid PRIMARY KEY, items jsonb, preset text);

CREATE TABLE roadmaps (id uuid PRIMARY KEY, slug text UNIQUE, title text, track text, version int);
CREATE TABLE roadmap_nodes (id uuid PRIMARY KEY, roadmap_id uuid REFERENCES roadmaps ON DELETE CASCADE, topic_slug text,
  title text, summary_md text, resources jsonb, problem_ids uuid[], checkpoint_quiz_id uuid, unlock_threshold numeric DEFAULT 0.6, master_threshold numeric DEFAULT 0.8);
CREATE TABLE roadmap_edges (roadmap_id uuid, from_node uuid, to_node uuid, PRIMARY KEY (from_node, to_node));
CREATE TABLE company_packs (
  id uuid PRIMARY KEY, company_id uuid REFERENCES companies, role text, level text, version int,
  data jsonb NOT NULL,                   -- rounds, topic weights, rubric weights, behavioral competencies, OA template, checklist
  status publish_status, reviewed_at date
);
CREATE TABLE user_tracks (user_id uuid, company_pack_id uuid, started_at timestamptz DEFAULT now(), progress jsonb, PRIMARY KEY (user_id, company_pack_id));

CREATE TABLE xp_events (id bigserial PRIMARY KEY, user_id uuid, delta int, reason text, ref_type text, ref_id uuid, at timestamptz DEFAULT now());
CREATE TABLE badges (id text PRIMARY KEY, name text, description text, sprite text, rule jsonb);
CREATE TABLE badges_earned (user_id uuid, badge_id text REFERENCES badges, earned_at timestamptz DEFAULT now(), PRIMARY KEY (user_id, badge_id));
CREATE TABLE activity_days (user_id uuid, day date, problems int DEFAULT 0, quizzes int DEFAULT 0, interviews int DEFAULT 0, minutes int DEFAULT 0, PRIMARY KEY (user_id, day));
CREATE TABLE analytics_rollups (user_id uuid, period text, period_start date, metrics jsonb, PRIMARY KEY (user_id, period, period_start));
```

### 2.10 Flashcards (X6)

```sql
CREATE TABLE flashcard_decks (id uuid PRIMARY KEY, owner_id uuid REFERENCES users ON DELETE CASCADE, title text, kind text,
  is_public boolean DEFAULT false, share_slug text UNIQUE, source text);
CREATE TABLE flashcards (
  id uuid PRIMARY KEY, deck_id uuid REFERENCES flashcard_decks ON DELETE CASCADE,
  type text DEFAULT 'basic',             -- basic | cloze | code | image
  front_md text NOT NULL, back_md text NOT NULL, origin_type text, origin_id uuid,
  ease numeric(4,2) DEFAULT 2.5, interval_days int DEFAULT 0, repetitions int DEFAULT 0, lapses int DEFAULT 0, due_at timestamptz
);
CREATE INDEX ON flashcards (deck_id, due_at);
CREATE TABLE flashcard_reviews (id uuid PRIMARY KEY, card_id uuid REFERENCES flashcards ON DELETE CASCADE, user_id uuid,
  quality smallint, reviewed_at timestamptz, client_id text UNIQUE);   -- client_id for offline-sync idempotency
```

### 2.11 Sharing, peer, integrity, review tools (U5, X1 to X4)

```sql
CREATE TABLE shared_reports (
  id uuid PRIMARY KEY, owner_id uuid REFERENCES users ON DELETE CASCADE, entity_type text, entity_id uuid,
  token_hash text UNIQUE NOT NULL, visibility text DEFAULT 'unlisted', options jsonb,  -- hide_transcript, hide_code, hide_company
  expires_at timestamptz, revoked_at timestamptz, views int DEFAULT 0, og_image_key text
);

CREATE TABLE peer_availability (id uuid PRIMARY KEY, user_id uuid, starts_at timestamptz, ends_at timestamptz, prefs jsonb);
CREATE TABLE peer_sessions (
  id uuid PRIMARY KEY, a_user uuid, b_user uuid, scheduled_at timestamptz, state text, problem_id uuid,
  consent_ai boolean DEFAULT false, consent_record boolean DEFAULT false, room_key text, ended_at timestamptz
);
CREATE TABLE peer_feedback (id uuid PRIMARY KEY, session_id uuid REFERENCES peer_sessions ON DELETE CASCADE, from_user uuid, to_user uuid,
  ratings jsonb, comments text, helpful_score smallint);
CREATE TABLE peer_reputation (user_id uuid PRIMARY KEY, sessions int, no_shows int, avg_rating numeric);
CREATE TABLE user_blocks (user_id uuid, blocked_user_id uuid, PRIMARY KEY (user_id, blocked_user_id));

CREATE TABLE integrity_flags (
  id uuid PRIMARY KEY, subject_type text, subject_id uuid, user_id uuid, kind text,   -- similarity | paste | focus | ai_style
  severity text, score numeric, evidence jsonb, status text DEFAULT 'open',            -- open | confirmed | dismissed | appealed
  reviewed_by uuid, reviewed_at timestamptz, decision_note text
);
CREATE TABLE code_fingerprints (submission_id uuid PRIMARY KEY REFERENCES submissions ON DELETE CASCADE, problem_id uuid, kgram_hashes bigint[], ast_hash text);
CREATE INDEX ON code_fingerprints USING gin (kgram_hashes);

CREATE TABLE code_reviews (id uuid PRIMARY KEY, submission_id uuid REFERENCES submissions ON DELETE CASCADE, strictness text,
  findings jsonb, refactored_code text, refactor_verified boolean, model text);
CREATE TABLE complexity_analyses (id uuid PRIMARY KEY, submission_id uuid REFERENCES submissions ON DELETE CASCADE,
  claimed_time text, claimed_space text, measured jsonb, best_fit text, r2 numeric, confidence text, static_hints jsonb);
```

### 2.12 System design (C3)

```sql
CREATE TABLE system_design_prompts (id uuid PRIMARY KEY, kind text CHECK (kind IN ('hld','lld')), title text, statement_md text,
  reference jsonb, difficulty smallint, tags text[], status publish_status);
CREATE TABLE design_canvases (id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE, prompt_id uuid, session_id uuid,
  canvas jsonb NOT NULL, panel jsonb, version int DEFAULT 1, ai_review jsonb);
```

### 2.13 Platform and ops

```sql
CREATE TABLE notifications (id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE, kind text, payload jsonb, read_at timestamptz, created_at timestamptz DEFAULT now());
CREATE INDEX ON notifications (user_id, read_at, created_at DESC);
CREATE TABLE admin_audit_log (id bigserial PRIMARY KEY, actor_id uuid, action text, entity_type text, entity_id text, before jsonb, after jsonb, ip inet, at timestamptz DEFAULT now());
CREATE TABLE feature_flags (key text PRIMARY KEY, enabled boolean, rollout jsonb, updated_by uuid);
CREATE TABLE llm_usage (id bigserial PRIMARY KEY, user_id uuid, feature text, model text, input_tokens int, output_tokens int, cache_read_tokens int, cost_usd numeric(10,5), latency_ms int, session_id uuid, at timestamptz DEFAULT now());
CREATE INDEX ON llm_usage (user_id, at);
CREATE TABLE user_exports (id uuid PRIMARY KEY, user_id uuid, status text, file_key text, expires_at timestamptz);
```

---

## 3. Redis keys

| Key                            | Type         | Purpose                                       |
| ------------------------------ | ------------ | --------------------------------------------- |
| `rl:{scope}:{id}:{window}`     | counter/ZSET | Rate limiting                                 |
| `q:judge:{lane}`               | BullMQ       | Judge queues                                  |
| `lb:contest:{id}`              | ZSET         | Live standings (score encodes solved/penalty) |
| `iv:{sessionId}:state`         | hash         | Hot interview state                           |
| `iv:{sessionId}:events`        | stream       | Reconnect replay                              |
| `cache:problem:{id}:{version}` | string       | Problem payload                               |
| `cache:dash:{userId}`          | json         | Dashboard aggregates                          |
| `ws:presence:{room}`           | set          | Presence                                      |
| `idem:{userId}:{key}`          | string       | Idempotency                                   |
| `srs:due:{userId}`             | ZSET         | Quick due lookup                              |

## 4. Retention and privacy

| Data                          | Retention                                               |
| ----------------------------- | ------------------------------------------------------- |
| Accepted submissions          | Until account deletion                                  |
| Failed submissions            | 180 days                                                |
| Interview audio               | Not stored by default; if opted in, 90 days             |
| Interview transcripts, events | Until deletion by user, or 24 months inactive           |
| Resume files and chunks       | Until user deletes; hard-deleted within 24 h of request |
| Shared report                 | Until expiry/revocation                                 |
| Audit logs                    | 24 months                                               |
| LLM usage                     | 12 months                                               |

## 5. Partitioning plan

At scale, partition by month: `submissions`, `submission_results`, `interview_events`, `problem_events`, `llm_usage`. Add retention jobs that drop old partitions after archive.

## 6. Seed data checklist

Tags (topics, patterns), 150+ problems with tests, 3 sheets, 10 company packs, 6 roadmaps, 400 quiz questions, 200 aptitude items, 20 behavioral questions, 30 CS verbal questions per subject, 8 HLD and 8 LLD prompts, 10 flashcard decks, badges, interview templates, sample demo user with history.

---

## 7. Implementation notes (as built)

- **ORM:** Drizzle. The schema lives in TypeScript at `packages/db/src/schema/{identity,problems,submissions}.ts` and is the source of truth; row and insert types are inferred from it (`typeof users.$inferSelect`). Repositories are plain functions taking a `Db` (the database or a transaction) and use the Drizzle query builder, with `sql` for the odd expression. IDs are UUID v7 generated in the app (`newId()`).
- **Migrations:** `packages/db/migrations`, applied in order by `pnpm db:migrate` (Drizzle's migrator; history in `drizzle.__drizzle_migrations`; forward-only). `0000_extensions` and `0002_triggers` are hand-written SQL (`pnpm db:generate -- --custom --name=...`); `0001_baseline` was generated from the schema with `pnpm db:generate`. Change flow: edit the schema, run `pnpm db:generate`, review the SQL, commit both. `pnpm db:reset` drops and rebuilds the dev database.
- **Triggers:** `0002_triggers` attaches `set_updated_at()` to every table that had `updated_at` at that time and maintains `problems.search`. **A new table must add its own `updated_at` trigger in its migration**; `apps/api/src/test/schema.test.ts` fails if one is missing, and also checks that every table has `created_at`/`updated_at`.
- **Applied so far (25 tables):** identity (users, profiles, user_settings, oauth_accounts, auth_sessions, email_tokens, **user_totp**), problem bank (problems, problem_versions, tags, problem_tags, companies, problem_companies, problem_languages, test_cases, hints, editorials, sheets, sheet_problems), submissions (submissions, submission_results, code_drafts, custom_tests, problem_events, user_problem_state).
- **Differences from the DDL above:** `created_at`/`updated_at` everywhere; `NOT NULL` added to defaulted columns; `CHECK` constraints on `status`, `theme`, `hint_mode`, `checker`, `visibility`, `email_tokens.kind`; `token_hash` columns are `UNIQUE` (looked up by hash; only SHA-256 of refresh and email tokens is stored); `editorials.problem_id` is `UNIQUE`; `problems.created_by`, `problem_versions.changed_by` and `sheets.owner_id` are `ON DELETE SET NULL` so deleting an account never deletes authored content; `auth_sessions.mfa_verified` (second factor carried through refresh); `oauth_accounts.email`; `user_totp` holds the AES-GCM-encrypted seed, the last accepted time step (replay protection) and hashed recovery codes.
- **Not yet created:** hint_usage, bookmarks, notes, SRS, contests, interviews and everything after §2.4. Each arrives in a migration with its feature.
- **Seed:** `pnpm db:seed` inserts 22 topic and 10 pattern tags and a local demo user (`demo@prepquest.dev` / `demo-password`, verified). Idempotent; refuses to run when `NODE_ENV=production`.
- **Account deletion:** `DELETE /me` marks the account `pending_deletion`; `pnpm --filter @prepquest/api db:purge` (to be run daily by the scheduler once it exists) hard-deletes accounts older than 14 days and relies on `ON DELETE CASCADE` for every user-owned table.
- **Phase 3 additions:** `0003` adds `draft_history` (last 5 autosave snapshots per user/problem/language) and `admin_audit_log` (actor, role, action, entity, before/after, reason, IP; the log keeps `actor_id` without a foreign key so it outlives the account); `0004` adds their `updated_at` triggers; `0005` adds `problems.signature` (jsonb: function name, typed params, return type), used to validate test files and later to generate drivers. Importing backfills it without creating a new version.
- **Versions and tests:** `test_cases` rows are per `(problem, version)`; a new version copies or replaces them and the old rows stay for old submissions. Objects live at `problems/<slug>/v<N>/NN.in|out`; editing a problem in the admin copies rows forward and shares the same object keys across versions.
- **Query gotchas (Drizzle):** in a single-table SELECT list, interpolated columns lose their table prefix (`${problems.id}` renders `"id"`), so a correlated subquery binds the name to its own table. Use raw qualified names (`problems.id`) in select-list subqueries; WHERE and ORDER BY keep the prefix. `TRUNCATE users CASCADE` also truncates problems (they reference users), which matters in tests.
- **Phase 4 additions:** `0006` adds `bookmarks` and `notes` (`notes` is generic by `entity_type`, one row per user and problem via a partial unique index; `version` supports conflict-safe saves) and four columns on `submission_results` (`kind`, `label`, `input_preview`, `expected_preview`; previews are stored only for samples and custom runs). `0007` adds the `updated_at` triggers. `note_versions`, `user_tags` and `user_tag_links` are still not created. `submissions.total` is set when the job is queued (the number of tests it will run) and the judge's final event overwrites `passed`/`total`.
- **Phase 5 additions:** `0008` adds `hint_usage` (one row per tier viewed), `xp_events` (append-only ledger; `profiles.xp` is the running total), `badges` (catalog, upserted from `analytics-core` when the API starts), `badges_earned`, `activity_days` (per local day in the player's time zone; the heatmap and streak source), `user_problem_state.first_seen_at` (hint and give-up cooldowns count from the first time a problem is opened) and `gave_up_at`, and `submissions.rewards` (jsonb: XP, level change, streak, badges, set when the submission finishes). `0009` adds the triggers. Hints and editorials are **not** part of a problem version: importing or editing them never creates one (the content hash ignores them).

## Phase 8 additions (as built)

New tables: `question_bank` (slug, category cs/behavioral/hld/lld, topic, competency, difficulty, text, reference_answer, followups, rubric_points, tags, status), `company_packs` (slug, title, role, level, version, `data` jsonb, status, `provisional`, created_by), `ideal_answers`, `star_scores`, `speech_metrics` (all keyed by session, with `updated_at` triggers in migration 0013). `question_memory` gains `topic` and `embedding vector(1024)` (hnsw index); `interview_scorecards` gains `extras_status` and `extras_attempts`; user settings gain `personalized_callbacks`.

## Phase 9 additions (as built)

`study_plans` (one active per user, `version`, `inputs`, `phases`, `warnings`, `narrative_md`, `replanned_on`), `plan_tasks` (stable `key` unique per plan, `status` todo/done/skipped/moved, `locked`, `custom`, `why`, `phase`, `topic`), `plan_diffs` (per version change with a reason), `goal_templates`, `daily_goals` (`items`, `completed`, `rewarded`), `readiness_snapshots` (user, target, local day), `diagnostics` (the five problem slugs). `topic_mastery` is not stored: it is computed per request. Triggers in migration 0016.

## Phase 10 additions (as built)

`srs_cards` (`due_on date` in the learner's local day, `ease`, `interval_days`, `repetitions`, `lapses`, `suspended`, unique per user and problem), `srs_reviews` (`quality`, `source` auto or manual, `reviewed_on` for the daily cap), `quiz_questions` (slug from content, `type`, `options`, `answer`, `explanation_md`, `interview_line`), `quiz_attempts` (`mode`, ordered `question_ids`, `deadline_at`, `xp_awarded`), `quiz_attempt_answers`, `roadmaps` (graph in `data`), `user_tracks`, and `user_settings.review_cap`. Not built: `quiz_sets`, `aptitude_items`, `oa_*`, `sql_*`, `roadmap_nodes` and `roadmap_edges` (the graph is a JSON column). Triggers in migration 0018.

## Phase 11 additions (as built)

`sql_datasets` (`schema_sql`, `seed_sql`, `dialect` always sqlite), `sql_problems` (`expected_query`, `order_sensitive`, `hint`, `solution_note`, `position`), `sql_attempts` (`verdict` AC, WA, ERROR or TLE, `xp_awarded`), `aptitude_items` (`section`, `type` single or blank, `shortcut_md`, `est_seconds`), `oa_templates` (`sections` JSON, `negative_marking`, `calculator`, `kind` oa or drill) and `oa_attempts` (`state` JSON with the items, answers and clocks of every section, `report` JSON, `marks`, `max_marks`, `xp_awarded`). Triggers in migration 0021. Not built: `quiz_sets`, `roadmap_nodes` and `roadmap_edges`.

## Phase 12 additions (as built)

`contests` (`kind` weekly, oa or private; `scoring` icpc or points; `freeze_minutes`; `visibility`; `invite_code`; `cancelled`; a window check `ends_at > starts_at`), `contest_problems` (`label`, `points`, `ordinal`) and `contest_participants` (`kind` live or virtual, `started_at`, `ends_at`, `integrity` JSON with blur and paste counts; one live row per user and contest). Triggers in migration 0023. `submissions.contest_id` (already present) links contest-mode attempts. Not built: `contest_standings` (standings are computed on request) and `lb:contest:{id}` in Redis.
