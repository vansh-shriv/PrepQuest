CREATE TABLE "code_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"strictness" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text,
	"comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ratings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refactor_code" text,
	"refactor_notes" text,
	"refactor_submission_id" uuid,
	"refactor_status" text DEFAULT 'none' NOT NULL,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_reviews_submission_strictness_key" UNIQUE("submission_id","strictness"),
	CONSTRAINT "code_reviews_strictness_check" CHECK ("code_reviews"."strictness" IN ('gentle','strict','pedantic')),
	CONSTRAINT "code_reviews_status_check" CHECK ("code_reviews"."status" IN ('pending','ready','failed')),
	CONSTRAINT "code_reviews_refactor_check" CHECK ("code_reviews"."refactor_status" IN ('none','checking','verified','rejected'))
);
--> statement-breakpoint
CREATE TABLE "complexity_analyses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"run_submission_id" uuid,
	"claimed" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complexity_analyses_submission_key" UNIQUE("submission_id"),
	CONSTRAINT "complexity_analyses_status_check" CHECK ("complexity_analyses"."status" IN ('running','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "review_strictness" text DEFAULT 'strict' NOT NULL;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "scale" jsonb;--> statement-breakpoint
ALTER TABLE "code_reviews" ADD CONSTRAINT "code_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_reviews" ADD CONSTRAINT "code_reviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_reviews" ADD CONSTRAINT "code_reviews_refactor_submission_id_submissions_id_fk" FOREIGN KEY ("refactor_submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complexity_analyses" ADD CONSTRAINT "complexity_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complexity_analyses" ADD CONSTRAINT "complexity_analyses_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complexity_analyses" ADD CONSTRAINT "complexity_analyses_run_submission_id_submissions_id_fk" FOREIGN KEY ("run_submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_review_strictness_check" CHECK ("user_settings"."review_strictness" IN ('gentle','strict','pedantic'));