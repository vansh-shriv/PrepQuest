CREATE TABLE "activity_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"problems" integer DEFAULT 0 NOT NULL,
	"quizzes" integer DEFAULT 0 NOT NULL,
	"interviews" integer DEFAULT 0 NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sprite" text NOT NULL,
	"rule" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badges_earned" (
	"user_id" uuid NOT NULL,
	"badge_id" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badges_earned_user_id_badge_id_pk" PRIMARY KEY("user_id","badge_id")
);
--> statement-breakpoint
CREATE TABLE "hint_usage" (
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"tier" smallint NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text DEFAULT 'practice' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hint_usage_user_id_problem_id_tier_pk" PRIMARY KEY("user_id","problem_id","tier"),
	CONSTRAINT "hint_usage_tier_check" CHECK ("hint_usage"."tier" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "rewards" jsonb;--> statement-breakpoint
ALTER TABLE "user_problem_state" ADD COLUMN "first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_problem_state" ADD COLUMN "gave_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_days" ADD CONSTRAINT "activity_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges_earned" ADD CONSTRAINT "badges_earned_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges_earned" ADD CONSTRAINT "badges_earned_badge_id_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hint_usage" ADD CONSTRAINT "hint_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hint_usage" ADD CONSTRAINT "hint_usage_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "xp_events_user_idx" ON "xp_events" USING btree ("user_id","at" DESC NULLS LAST);