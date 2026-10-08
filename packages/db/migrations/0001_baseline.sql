CREATE TYPE "public"."user_role" AS ENUM('user', 'content_editor', 'reviewer', 'moderator', 'support', 'admin');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('draft', 'in_review', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('QUEUED', 'COMPILING', 'RUNNING', 'AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'IE');--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" "inet",
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "email_tokens_kind_check" CHECK ("email_tokens"."kind" IN ('verify_email','reset_password'))
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"email" "citext",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_accounts_provider_user_key" UNIQUE("provider","provider_user_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"handle" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"avatar_key" text,
	"bio" text,
	"college" text,
	"branch" text,
	"grad_year" integer,
	"country" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"public_profile" boolean DEFAULT false NOT NULL,
	"privacy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"placement_date" date,
	"hours_per_day" jsonb,
	"target_roles" text[],
	"target_companies" text[],
	"track" text,
	"onboarding_completed_at" timestamp with time zone,
	"xp" bigint DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"streak_current" integer DEFAULT 0 NOT NULL,
	"streak_best" integer DEFAULT 0 NOT NULL,
	"streak_last_active" date,
	"streak_freezes" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"readable_mode" boolean DEFAULT false NOT NULL,
	"retro_cursor" boolean DEFAULT true NOT NULL,
	"sound" boolean DEFAULT false NOT NULL,
	"reduced_motion" boolean DEFAULT false NOT NULL,
	"editor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shortcuts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hint_mode" text DEFAULT 'strict' NOT NULL,
	"open_editorials" boolean DEFAULT false NOT NULL,
	"default_language" text DEFAULT 'cpp' NOT NULL,
	"notifications" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quiet_hours" jsonb,
	"personalized_callbacks" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_theme_check" CHECK ("user_settings"."theme" IN ('cream','night','contrast','system')),
	CONSTRAINT "user_settings_hint_mode_check" CHECK ("user_settings"."hint_mode" IN ('strict','relaxed'))
);
--> statement-breakpoint
CREATE TABLE "user_totp" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_enc" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_step" bigint,
	"recovery_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('active','suspended','pending_deletion'))
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"pack_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "editorials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"problem_id" uuid NOT NULL,
	"approaches" jsonb NOT NULL,
	"talk_track_md" text,
	"related_problem_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editorials_problem_id_unique" UNIQUE("problem_id")
);
--> statement-breakpoint
CREATE TABLE "hints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"problem_id" uuid NOT NULL,
	"tier" smallint NOT NULL,
	"body_md" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hints_problem_tier_key" UNIQUE("problem_id","tier"),
	CONSTRAINT "hints_tier_check" CHECK ("hints"."tier" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "problem_companies" (
	"problem_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"frequency" smallint DEFAULT 1 NOT NULL,
	"last_seen_year" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_companies_problem_id_company_id_pk" PRIMARY KEY("problem_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "problem_languages" (
	"problem_id" uuid NOT NULL,
	"language" text NOT NULL,
	"time_limit_ms" integer NOT NULL,
	"memory_limit_kb" integer NOT NULL,
	"starter_code" text NOT NULL,
	"driver_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_languages_problem_id_language_pk" PRIMARY KEY("problem_id","language")
);
--> statement-breakpoint
CREATE TABLE "problem_tags" (
	"problem_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_tags_problem_id_tag_id_pk" PRIMARY KEY("problem_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "problem_versions" (
	"problem_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" uuid,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_versions_problem_id_version_pk" PRIMARY KEY("problem_id","version")
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"statement_md" text NOT NULL,
	"constraints_md" text,
	"difficulty" "difficulty" NOT NULL,
	"examples" jsonb NOT NULL,
	"checker" text DEFAULT 'exact' NOT NULL,
	"checker_config" jsonb,
	"est_minutes" integer,
	"acceptance_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"submissions_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"source" text,
	"license" text,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"search" "tsvector",
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problems_slug_unique" UNIQUE("slug"),
	CONSTRAINT "problems_checker_check" CHECK ("problems"."checker" IN ('exact','tokens','float','special'))
);
--> statement-breakpoint
CREATE TABLE "sheet_problems" (
	"sheet_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"section" text,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_problems_sheet_id_problem_id_pk" PRIMARY KEY("sheet_id","problem_id")
);
--> statement-breakpoint
CREATE TABLE "sheets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_id" uuid,
	"visibility" text DEFAULT 'public' NOT NULL,
	"company_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheets_slug_unique" UNIQUE("slug"),
	CONSTRAINT "sheets_visibility_check" CHECK ("sheets"."visibility" IN ('public','private'))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tags_kind_check" CHECK ("tags"."kind" IN ('topic','pattern'))
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"problem_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"input_key" text NOT NULL,
	"output_key" text NOT NULL,
	"input_bytes" integer,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_cases_problem_version_ordinal_key" UNIQUE("problem_id","version","ordinal"),
	CONSTRAINT "test_cases_kind_check" CHECK ("test_cases"."kind" IN ('sample','hidden','edge','stress'))
);
--> statement-breakpoint
CREATE TABLE "code_drafts" (
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"language" text NOT NULL,
	"code" text NOT NULL,
	"cursor" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_drafts_user_id_problem_id_language_pk" PRIMARY KEY("user_id","problem_id","language")
);
--> statement-breakpoint
CREATE TABLE "custom_tests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid,
	"label" text,
	"input" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problem_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"problem_id" uuid,
	"kind" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_results" (
	"submission_id" uuid NOT NULL,
	"test_ordinal" integer NOT NULL,
	"verdict" "verdict" NOT NULL,
	"time_ms" integer,
	"memory_kb" integer,
	"stdout_tail" text,
	"stderr_tail" text,
	"checker_msg" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_results_submission_id_test_ordinal_pk" PRIMARY KEY("submission_id","test_ordinal")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"problem_version" integer NOT NULL,
	"language" text NOT NULL,
	"code" text NOT NULL,
	"code_hash" text NOT NULL,
	"kind" text NOT NULL,
	"mode" text DEFAULT 'practice' NOT NULL,
	"contest_id" uuid,
	"interview_session_id" uuid,
	"verdict" "verdict" DEFAULT 'QUEUED' NOT NULL,
	"time_ms" integer,
	"memory_kb" integer,
	"passed" integer,
	"total" integer,
	"failing_test_ordinal" integer,
	"compile_output" text,
	"stderr_tail" text,
	"hints_used" smallint DEFAULT 0 NOT NULL,
	"note" text,
	"active_seconds" integer,
	"first_run_seconds" integer,
	"idempotency_key" text,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_kind_check" CHECK ("submissions"."kind" IN ('run','submit')),
	CONSTRAINT "submissions_mode_check" CHECK ("submissions"."mode" IN ('practice','contest','interview','review'))
);
--> statement-breakpoint
CREATE TABLE "user_problem_state" (
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"status" text DEFAULT 'unseen' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_ac_at" timestamp with time zone,
	"first_try_ac" boolean,
	"best_time_ms" integer,
	"hints_used" smallint DEFAULT 0 NOT NULL,
	"clean_solve" boolean DEFAULT false NOT NULL,
	"total_active_seconds" integer DEFAULT 0 NOT NULL,
	"solve_rating" text,
	"last_submission_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_problem_state_user_id_problem_id_pk" PRIMARY KEY("user_id","problem_id"),
	CONSTRAINT "user_problem_state_status_check" CHECK ("user_problem_state"."status" IN ('unseen','attempted','solved'))
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_totp" ADD CONSTRAINT "user_totp_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorials" ADD CONSTRAINT "editorials_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hints" ADD CONSTRAINT "hints_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_companies" ADD CONSTRAINT "problem_companies_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_companies" ADD CONSTRAINT "problem_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_languages" ADD CONSTRAINT "problem_languages_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_tags" ADD CONSTRAINT "problem_tags_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_tags" ADD CONSTRAINT "problem_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_versions" ADD CONSTRAINT "problem_versions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_versions" ADD CONSTRAINT "problem_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_problems" ADD CONSTRAINT "sheet_problems_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_problems" ADD CONSTRAINT "sheet_problems_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_parent_id_tags_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_drafts" ADD CONSTRAINT "code_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_drafts" ADD CONSTRAINT "code_drafts_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_tests" ADD CONSTRAINT "custom_tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_tests" ADD CONSTRAINT "custom_tests_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_results" ADD CONSTRAINT "submission_results_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_problem_state" ADD CONSTRAINT "user_problem_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_problem_state" ADD CONSTRAINT "user_problem_state_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_family_idx" ON "auth_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "email_tokens_user_idx" ON "email_tokens" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "oauth_accounts_user_idx" ON "oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_pending_deletion_idx" ON "users" USING btree ("deletion_requested_at") WHERE "users"."deletion_requested_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "problem_tags_tag_idx" ON "problem_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "problems_search_idx" ON "problems" USING gin ("search");--> statement-breakpoint
CREATE INDEX "problems_title_trgm" ON "problems" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "problems_filter_idx" ON "problems" USING btree ("status","difficulty");--> statement-breakpoint
CREATE INDEX "problem_events_user_idx" ON "problem_events" USING btree ("user_id","problem_id","at");--> statement-breakpoint
CREATE INDEX "submissions_user_created_idx" ON "submissions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submissions_user_problem_idx" ON "submissions" USING btree ("user_id","problem_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submissions_problem_verdict_idx" ON "submissions" USING btree ("problem_id","verdict","time_ms");--> statement-breakpoint
CREATE INDEX "submissions_contest_idx" ON "submissions" USING btree ("contest_id","user_id") WHERE "submissions"."contest_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_idempotency_idx" ON "submissions" USING btree ("user_id","idempotency_key") WHERE "submissions"."idempotency_key" IS NOT NULL;