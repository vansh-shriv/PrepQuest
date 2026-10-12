CREATE TABLE "daily_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_date" date NOT NULL,
	"items" jsonb NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"rewarded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_goals_user_date_unique" UNIQUE("user_id","goal_date")
);
--> statement-breakpoint
CREATE TABLE "diagnostics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_slugs" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_templates" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preset" text DEFAULT 'standard' NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_diffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer NOT NULL,
	"reason" text NOT NULL,
	"diff" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"key" text NOT NULL,
	"planned_date" date NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text,
	"ref" text,
	"title" text NOT NULL,
	"est_minutes" smallint NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"custom" boolean DEFAULT false NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"phase" text DEFAULT 'pattern_mastery' NOT NULL,
	"topic" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_tasks_plan_key_unique" UNIQUE("plan_id","key"),
	CONSTRAINT "plan_tasks_status_check" CHECK ("plan_tasks"."status" IN ('todo','done','skipped','moved'))
);
--> statement-breakpoint
CREATE TABLE "readiness_snapshots" (
	"user_id" uuid NOT NULL,
	"target_key" text NOT NULL,
	"snap_date" date NOT NULL,
	"score" numeric(5, 2),
	"band" numeric(4, 2),
	"components" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readiness_snapshots_user_id_target_key_snap_date_pk" PRIMARY KEY("user_id","target_key","snap_date")
);
--> statement-breakpoint
CREATE TABLE "study_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"target_key" text DEFAULT 'general' NOT NULL,
	"placement_date" date,
	"inputs" jsonb NOT NULL,
	"phases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"narrative_md" text,
	"replanned_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_goals" ADD CONSTRAINT "daily_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_templates" ADD CONSTRAINT "goal_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_diffs" ADD CONSTRAINT "plan_diffs_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_tasks" ADD CONSTRAINT "plan_tasks_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_snapshots" ADD CONSTRAINT "readiness_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnostics_user_idx" ON "diagnostics" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "plan_diffs_plan_idx" ON "plan_diffs" USING btree ("plan_id","to_version" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "plan_tasks_plan_date_idx" ON "plan_tasks" USING btree ("plan_id","planned_date");--> statement-breakpoint
CREATE UNIQUE INDEX "study_plans_one_active_idx" ON "study_plans" USING btree ("user_id") WHERE "study_plans"."active";--> statement-breakpoint
CREATE INDEX "study_plans_user_idx" ON "study_plans" USING btree ("user_id","created_at" DESC NULLS LAST);