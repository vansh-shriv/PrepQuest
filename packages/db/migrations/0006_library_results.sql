CREATE TABLE "bookmarks" (
	"user_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"folder" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_user_id_problem_id_pk" PRIMARY KEY("user_id","problem_id")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"body_md" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_entity_type_check" CHECK ("notes"."entity_type" IN ('problem','interview_moment','quiz_question','general'))
);
--> statement-breakpoint
ALTER TABLE "submission_results" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "submission_results" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "submission_results" ADD COLUMN "input_preview" text;--> statement-breakpoint
ALTER TABLE "submission_results" ADD COLUMN "expected_preview" text;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notes_user_entity_idx" ON "notes" USING btree ("user_id","entity_type","entity_id") WHERE "notes"."entity_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notes_user_updated_idx" ON "notes" USING btree ("user_id","updated_at" DESC NULLS LAST);