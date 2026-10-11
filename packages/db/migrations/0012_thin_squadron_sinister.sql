CREATE TABLE "company_packs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"role" text DEFAULT 'SDE' NOT NULL,
	"level" text DEFAULT 'sde1' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"status" "publish_status" DEFAULT 'published' NOT NULL,
	"reviewed_at" date,
	"provisional" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_packs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ideal_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"question_index" smallint NOT NULL,
	"question_ref" text NOT NULL,
	"question_text" text NOT NULL,
	"user_answer_summary" text NOT NULL,
	"ideal_md" text NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"star_rewrite_md" text,
	"added_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ideal_answers_session_question_key" UNIQUE("session_id","question_index")
);
--> statement-breakpoint
CREATE TABLE "question_bank" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"category" text NOT NULL,
	"topic" text NOT NULL,
	"competency" text,
	"difficulty" smallint DEFAULT 3 NOT NULL,
	"text" text NOT NULL,
	"reference_answer" text,
	"followups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rubric_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "publish_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_bank_slug_unique" UNIQUE("slug"),
	CONSTRAINT "question_bank_category_check" CHECK ("question_bank"."category" IN ('cs','behavioral','hld','lld')),
	CONSTRAINT "question_bank_difficulty_check" CHECK ("question_bank"."difficulty" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "speech_metrics" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"words" integer NOT NULL,
	"wpm" numeric(6, 1),
	"filler_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filler_per_min" numeric(6, 2),
	"long_pauses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hedging_rate" numeric(6, 3),
	"series" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"basis" text DEFAULT 'text' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "star_scores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_seq" integer NOT NULL,
	"s" smallint NOT NULL,
	"t" smallint NOT NULL,
	"a" smallint NOT NULL,
	"r" smallint NOT NULL,
	"specificity" smallint NOT NULL,
	"ownership_ratio" numeric(4, 3),
	"impact" smallint NOT NULL,
	"reflection" smallint NOT NULL,
	"justification" text,
	"rewrite_md" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "star_scores_session_turn_key" UNIQUE("session_id","turn_seq")
);
--> statement-breakpoint
ALTER TABLE "question_memory" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "question_memory" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "company_packs" ADD CONSTRAINT "company_packs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideal_answers" ADD CONSTRAINT "ideal_answers_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speech_metrics" ADD CONSTRAINT "speech_metrics_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "star_scores" ADD CONSTRAINT "star_scores_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_packs_status_idx" ON "company_packs" USING btree ("status","provisional");--> statement-breakpoint
CREATE INDEX "question_bank_category_idx" ON "question_bank" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "question_memory_embedding_idx" ON "question_memory" USING hnsw ("embedding" vector_cosine_ops);