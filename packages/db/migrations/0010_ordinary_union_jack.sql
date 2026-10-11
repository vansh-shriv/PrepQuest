CREATE TYPE "public"."interview_state" AS ENUM('SETUP', 'WARMUP', 'PROBLEM', 'CLARIFY', 'APPROACH', 'CODING', 'TESTING', 'OPTIMIZE', 'FOLLOWUP', 'WRAPUP', 'ENDING', 'COMPLETED', 'ABANDONED', 'FAILED');--> statement-breakpoint
CREATE TABLE "interview_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"offset_ms" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_scorecards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"rubric_id" text NOT NULL,
	"rubric_version" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"overall" smallint,
	"band" text,
	"summary" text,
	"strengths" jsonb,
	"red_flags" jsonb,
	"next_actions" jsonb,
	"coverage" jsonb,
	"model" text,
	"prompt_version" text,
	"helpful" smallint,
	"feedback_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_scorecards_session_id_unique" UNIQUE("session_id"),
	CONSTRAINT "interview_scorecards_overall_check" CHECK ("interview_scorecards"."overall" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "interview_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"type" text NOT NULL,
	"role" text,
	"company_name" text,
	"level" text DEFAULT 'sde1' NOT NULL,
	"resume_id" uuid,
	"jd_id" uuid,
	"persona" text DEFAULT 'neutral' NOT NULL,
	"difficulty" smallint DEFAULT 3 NOT NULL,
	"adaptive" boolean DEFAULT true NOT NULL,
	"hint_budget" smallint DEFAULT 2 NOT NULL,
	"interruption_level" text DEFAULT 'normal' NOT NULL,
	"mode" text DEFAULT 'text' NOT NULL,
	"realistic" boolean DEFAULT true NOT NULL,
	"state" "interview_state" DEFAULT 'SETUP' NOT NULL,
	"plan" jsonb NOT NULL,
	"state_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rolling_summary" text,
	"hints_given" smallint DEFAULT 0 NOT NULL,
	"pauses_used" smallint DEFAULT 0 NOT NULL,
	"paused_at" timestamp with time zone,
	"planned_seconds" integer NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"prompt_version" text,
	"model_config" jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_sessions_difficulty_check" CHECK ("interview_sessions"."difficulty" BETWEEN 1 AND 5),
	CONSTRAINT "interview_sessions_hint_budget_check" CHECK ("interview_sessions"."hint_budget" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "interview_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"speaker" text NOT NULL,
	"text" text NOT NULL,
	"offset_ms" integer NOT NULL,
	"modality" text DEFAULT 'text' NOT NULL,
	"words" jsonb,
	"meta" jsonb,
	"client_msg_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_turns_session_seq_key" UNIQUE("session_id","seq"),
	CONSTRAINT "interview_turns_speaker_check" CHECK ("interview_turns"."speaker" IN ('interviewer','candidate','system'))
);
--> statement-breakpoint
CREATE TABLE "job_descriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"company" text,
	"role" text,
	"raw_text" text NOT NULL,
	"analysis" jsonb,
	"gap" jsonb,
	"resume_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_memory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" text NOT NULL,
	"ref_key" text NOT NULL,
	"question_text" text NOT NULL,
	"outcome" smallint,
	"weak" boolean DEFAULT false NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"resume_id" uuid NOT NULL,
	"section" text NOT NULL,
	"ref" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"file_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"parse_error" text,
	"parsed" jsonb,
	"claims" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"user_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorecard_scores" (
	"scorecard_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"score" smallint,
	"weight" numeric(4, 3) NOT NULL,
	"justification" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scorecard_scores_scorecard_id_dimension_pk" PRIMARY KEY("scorecard_id","dimension"),
	CONSTRAINT "scorecard_scores_score_check" CHECK ("scorecard_scores"."score" IS NULL OR "scorecard_scores"."score" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "transcript_annotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"offset_ms" integer NOT NULL,
	"turn_seq" integer NOT NULL,
	"kind" text NOT NULL,
	"dimension" text,
	"text" text NOT NULL,
	"severity" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_annotations_kind_check" CHECK ("transcript_annotations"."kind" IN ('positive','improve','missed','red_flag'))
);
--> statement-breakpoint
ALTER TABLE "interview_events" ADD CONSTRAINT "interview_events_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_jd_id_job_descriptions_id_fk" FOREIGN KEY ("jd_id") REFERENCES "public"."job_descriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD CONSTRAINT "interview_turns_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD CONSTRAINT "job_descriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD CONSTRAINT "job_descriptions_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_memory" ADD CONSTRAINT "question_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_memory" ADD CONSTRAINT "question_memory_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_chunks" ADD CONSTRAINT "resume_chunks_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_scores" ADD CONSTRAINT "scorecard_scores_scorecard_id_interview_scorecards_id_fk" FOREIGN KEY ("scorecard_id") REFERENCES "public"."interview_scorecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_annotations" ADD CONSTRAINT "transcript_annotations_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_events_session_idx" ON "interview_events" USING btree ("session_id","offset_ms");--> statement-breakpoint
CREATE INDEX "interview_sessions_user_idx" ON "interview_sessions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "interview_sessions_active_idx" ON "interview_sessions" USING btree ("ends_at") WHERE "interview_sessions"."ended_at" IS NULL AND "interview_sessions"."started_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_sessions_idem_idx" ON "interview_sessions" USING btree ("user_id","idempotency_key") WHERE "interview_sessions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turns_client_msg_idx" ON "interview_turns" USING btree ("session_id","client_msg_id") WHERE "interview_turns"."client_msg_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "job_descriptions_user_idx" ON "job_descriptions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "llm_usage_user_idx" ON "llm_usage" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "llm_usage_session_idx" ON "llm_usage" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "question_memory_user_idx" ON "question_memory" USING btree ("user_id","asked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "resume_chunks_resume_idx" ON "resume_chunks" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX "resume_chunks_embedding_idx" ON "resume_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "resumes_user_idx" ON "resumes" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_one_default_idx" ON "resumes" USING btree ("user_id") WHERE "resumes"."is_default";--> statement-breakpoint
CREATE INDEX "transcript_annotations_session_idx" ON "transcript_annotations" USING btree ("session_id","offset_ms");