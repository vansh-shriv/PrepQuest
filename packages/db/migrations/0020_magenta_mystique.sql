CREATE TABLE "aptitude_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"section" text NOT NULL,
	"topic" text NOT NULL,
	"difficulty" smallint DEFAULT 2 NOT NULL,
	"type" text DEFAULT 'single' NOT NULL,
	"body_md" text NOT NULL,
	"options" jsonb,
	"answer" jsonb NOT NULL,
	"explanation_md" text NOT NULL,
	"shortcut_md" text,
	"est_seconds" integer DEFAULT 60 NOT NULL,
	"status" "publish_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aptitude_items_slug_unique" UNIQUE("slug"),
	CONSTRAINT "aptitude_items_type_check" CHECK ("aptitude_items"."type" IN ('single','blank')),
	CONSTRAINT "aptitude_items_difficulty_check" CHECK ("aptitude_items"."difficulty" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "oa_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"state" jsonb NOT NULL,
	"report" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"marks" numeric(6, 2),
	"max_marks" integer,
	"xp_awarded" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oa_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'oa' NOT NULL,
	"sections" jsonb NOT NULL,
	"negative_marking" numeric(4, 2) DEFAULT '0' NOT NULL,
	"calculator" boolean DEFAULT false NOT NULL,
	"status" "publish_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oa_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sql_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"query" text NOT NULL,
	"verdict" text NOT NULL,
	"message" text,
	"row_count" integer,
	"run_ms" integer,
	"xp_awarded" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sql_attempts_verdict_check" CHECK ("sql_attempts"."verdict" IN ('AC','WA','ERROR','TLE'))
);
--> statement-breakpoint
CREATE TABLE "sql_datasets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"schema_sql" text NOT NULL,
	"seed_sql" text NOT NULL,
	"dialect" text DEFAULT 'sqlite' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sql_datasets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sql_problems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dataset_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"topic" text NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"statement_md" text NOT NULL,
	"expected_query" text NOT NULL,
	"order_sensitive" boolean DEFAULT false NOT NULL,
	"hint" text,
	"solution_note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "publish_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sql_problems_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "oa_attempts" ADD CONSTRAINT "oa_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oa_attempts" ADD CONSTRAINT "oa_attempts_template_id_oa_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."oa_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sql_attempts" ADD CONSTRAINT "sql_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sql_attempts" ADD CONSTRAINT "sql_attempts_problem_id_sql_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."sql_problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sql_problems" ADD CONSTRAINT "sql_problems_dataset_id_sql_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."sql_datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aptitude_items_section_idx" ON "aptitude_items" USING btree ("section","topic","status");--> statement-breakpoint
CREATE INDEX "oa_attempts_user_idx" ON "oa_attempts" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "oa_attempts_template_idx" ON "oa_attempts" USING btree ("template_id","finished_at");--> statement-breakpoint
CREATE INDEX "sql_attempts_user_problem_idx" ON "sql_attempts" USING btree ("user_id","problem_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sql_problems_list_idx" ON "sql_problems" USING btree ("status","topic","difficulty");