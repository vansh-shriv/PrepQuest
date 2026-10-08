-- 002: problem bank (D1, D2, D4, D5, X7). Doc 10 §2.2.

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
  checker text NOT NULL DEFAULT 'exact' CHECK (checker IN ('exact','tokens','float','special')),
  checker_config jsonb,
  est_minutes int, acceptance_rate numeric(5,2) NOT NULL DEFAULT 0,
  submissions_count int NOT NULL DEFAULT 0, accepted_count int NOT NULL DEFAULT 0,
  source text, license text,              -- provenance
  status publish_status NOT NULL DEFAULT 'draft',
  current_version int NOT NULL DEFAULT 1,
  search tsvector,
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX problems_search_idx ON problems USING gin(search);
CREATE INDEX problems_title_trgm ON problems USING gin(title gin_trgm_ops);
CREATE INDEX problems_filter_idx ON problems (status, difficulty);

-- keep the full-text vector in sync (title weighted above statement)
CREATE OR REPLACE FUNCTION problems_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.statement_md, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER problems_search BEFORE INSERT OR UPDATE OF title, statement_md ON problems
  FOR EACH ROW EXECUTE FUNCTION problems_search_update();

CREATE TABLE problem_versions (
  problem_id uuid REFERENCES problems ON DELETE CASCADE, version int,
  snapshot jsonb NOT NULL, changed_by uuid REFERENCES users, change_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (problem_id, version)
);

CREATE TABLE tags (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('topic','pattern')),
  slug text UNIQUE NOT NULL, name text NOT NULL, parent_id uuid REFERENCES tags,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE problem_tags (
  problem_id uuid REFERENCES problems ON DELETE CASCADE,
  tag_id uuid REFERENCES tags,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (problem_id, tag_id)
);
CREATE INDEX problem_tags_tag_idx ON problem_tags (tag_id);

CREATE TABLE companies (
  id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, pack_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE problem_companies (
  problem_id uuid REFERENCES problems ON DELETE CASCADE,
  company_id uuid REFERENCES companies,
  frequency smallint NOT NULL DEFAULT 1, last_seen_year smallint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (problem_id, company_id)
);

CREATE TABLE problem_languages (          -- per-language limits + templates
  problem_id uuid REFERENCES problems ON DELETE CASCADE,
  language text NOT NULL,                 -- cpp | java | python | ...
  time_limit_ms int NOT NULL, memory_limit_kb int NOT NULL,
  starter_code text NOT NULL, driver_code text,   -- hidden harness
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (problem_id, language)
);

CREATE TABLE test_cases (
  id uuid PRIMARY KEY, problem_id uuid NOT NULL REFERENCES problems ON DELETE CASCADE,
  version int NOT NULL, ordinal int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sample','hidden','edge','stress')),
  label text,                             -- shown on failure: "edge: empty input"
  input_key text NOT NULL, output_key text NOT NULL,   -- object storage keys
  input_bytes int, weight int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (problem_id, version, ordinal)
);

CREATE TABLE hints (                      -- D4
  id uuid PRIMARY KEY, problem_id uuid REFERENCES problems ON DELETE CASCADE,
  tier smallint NOT NULL CHECK (tier BETWEEN 1 AND 3), body_md text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (problem_id, tier)
);

CREATE TABLE editorials (                 -- D5
  id uuid PRIMARY KEY, problem_id uuid UNIQUE REFERENCES problems ON DELETE CASCADE,
  approaches jsonb NOT NULL,              -- [{name, intuition, steps, code:{lang:code}, time, space, pitfalls}]
  talk_track_md text, related_problem_ids uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sheets (
  id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, title text NOT NULL, description text,
  owner_id uuid REFERENCES users, visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  company_id uuid REFERENCES companies, version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sheet_problems (
  sheet_id uuid REFERENCES sheets ON DELETE CASCADE,
  problem_id uuid REFERENCES problems, section text, ordinal int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sheet_id, problem_id)
);

CREATE TRIGGER problems_updated BEFORE UPDATE ON problems FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER problem_versions_updated BEFORE UPDATE ON problem_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tags_updated BEFORE UPDATE ON tags FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER problem_tags_updated BEFORE UPDATE ON problem_tags FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER problem_companies_updated BEFORE UPDATE ON problem_companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER problem_languages_updated BEFORE UPDATE ON problem_languages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER test_cases_updated BEFORE UPDATE ON test_cases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER hints_updated BEFORE UPDATE ON hints FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER editorials_updated BEFORE UPDATE ON editorials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sheets_updated BEFORE UPDATE ON sheets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sheet_problems_updated BEFORE UPDATE ON sheet_problems FOR EACH ROW EXECUTE FUNCTION set_updated_at();
