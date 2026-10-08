-- 001: extensions, shared helpers, identity and accounts (U1). Doc 10 §2.1.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TYPE user_role AS ENUM ('user','content_editor','reviewer','moderator','support','admin');

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email citext UNIQUE NOT NULL,
  email_verified_at timestamptz,
  password_hash text,                       -- argon2id, null for OAuth-only
  role user_role NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending_deletion')),
  deletion_requested_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
  target_roles text[], target_companies text[],
  track text,                               -- sde | fullstack | ml | embedded | data
  onboarding_completed_at timestamptz,
  xp bigint NOT NULL DEFAULT 0, level int NOT NULL DEFAULT 1,
  streak_current int NOT NULL DEFAULT 0, streak_best int NOT NULL DEFAULT 0,
  streak_last_active date, streak_freezes int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('cream','night','contrast','system')),
  readable_mode boolean NOT NULL DEFAULT false,
  retro_cursor boolean NOT NULL DEFAULT true,
  sound boolean NOT NULL DEFAULT false,
  reduced_motion boolean NOT NULL DEFAULT false,
  editor jsonb NOT NULL DEFAULT '{}',       -- font, tab size, vim, minimap
  shortcuts jsonb NOT NULL DEFAULT '{}',
  hint_mode text NOT NULL DEFAULT 'strict' CHECK (hint_mode IN ('strict','relaxed')),
  open_editorials boolean NOT NULL DEFAULT false,
  default_language text NOT NULL DEFAULT 'cpp',
  notifications jsonb NOT NULL DEFAULT '{}', quiet_hours jsonb,
  personalized_callbacks boolean NOT NULL DEFAULT true,   -- X5
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_accounts (               -- table only; OAuth flows arrive later
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider text NOT NULL, provider_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE auth_sessions (                -- refresh token families
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  family_id uuid NOT NULL, token_hash text NOT NULL UNIQUE, user_agent text, ip inet,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, replaced_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id, revoked_at);
CREATE INDEX auth_sessions_family_idx ON auth_sessions (family_id);

CREATE TABLE email_tokens (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify_email','reset_password')),
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_idx ON email_tokens (user_id, kind);

CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_settings_updated BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER oauth_accounts_updated BEFORE UPDATE ON oauth_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER auth_sessions_updated BEFORE UPDATE ON auth_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER email_tokens_updated BEFORE UPDATE ON email_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
