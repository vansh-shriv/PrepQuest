-- 003: submissions, drafts, per-user problem state (D3, D2, U2, A5). Doc 10 §2.3-2.4 (core subset).
-- Hints usage, bookmarks, notes, SRS arrive in later migrations with their features.

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
  hints_used smallint NOT NULL DEFAULT 0, note text,
  active_seconds int, first_run_seconds int,      -- A5 metrics
  idempotency_key text, queued_at timestamptz, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submissions_user_created_idx ON submissions (user_id, created_at DESC);
CREATE INDEX submissions_user_problem_idx ON submissions (user_id, problem_id, created_at DESC);
CREATE INDEX submissions_problem_verdict_idx ON submissions (problem_id, verdict, time_ms);
CREATE INDEX submissions_contest_idx ON submissions (contest_id, user_id) WHERE contest_id IS NOT NULL;
CREATE UNIQUE INDEX submissions_idempotency_idx ON submissions (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE submission_results (
  submission_id uuid REFERENCES submissions ON DELETE CASCADE,
  test_ordinal int, verdict verdict NOT NULL,
  time_ms int, memory_kb int, stdout_tail text, stderr_tail text, checker_msg text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, test_ordinal)
);

CREATE TABLE code_drafts (                -- D2 autosave
  user_id uuid REFERENCES users ON DELETE CASCADE, problem_id uuid REFERENCES problems,
  language text, code text NOT NULL, cursor jsonb, version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, problem_id, language)
);

CREATE TABLE custom_tests (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE,
  problem_id uuid REFERENCES problems, label text, input text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE problem_events (             -- A5 raw timing events (partition monthly at scale)
  id bigserial PRIMARY KEY, user_id uuid, problem_id uuid, kind text,
  at timestamptz NOT NULL DEFAULT now(), meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX problem_events_user_idx ON problem_events (user_id, problem_id, at);

CREATE TABLE user_problem_state (
  user_id uuid REFERENCES users ON DELETE CASCADE, problem_id uuid REFERENCES problems,
  status text NOT NULL DEFAULT 'unseen' CHECK (status IN ('unseen','attempted','solved')),
  attempts int NOT NULL DEFAULT 0, first_ac_at timestamptz, first_try_ac boolean,
  best_time_ms int, hints_used smallint NOT NULL DEFAULT 0, clean_solve boolean NOT NULL DEFAULT false,
  total_active_seconds int NOT NULL DEFAULT 0, solve_rating text,   -- easy|good|hard|again
  last_submission_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, problem_id)
);

CREATE TRIGGER submissions_updated BEFORE UPDATE ON submissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER submission_results_updated BEFORE UPDATE ON submission_results FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER code_drafts_updated BEFORE UPDATE ON code_drafts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER custom_tests_updated BEFORE UPDATE ON custom_tests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER problem_events_updated BEFORE UPDATE ON problem_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_problem_state_updated BEFORE UPDATE ON user_problem_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();
