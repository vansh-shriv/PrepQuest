CREATE TABLE "design_canvases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"session_id" uuid,
	"canvas" jsonb NOT NULL,
	"panel" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"review_status" text DEFAULT 'none' NOT NULL,
	"ai_review" jsonb,
	"review_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_canvases_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "design_canvases_review_status_check" CHECK ("design_canvases"."review_status" IN ('none','pending','ready','failed'))
);
--> statement-breakpoint
CREATE TABLE "system_design_prompts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'hld' NOT NULL,
	"title" text NOT NULL,
	"statement_md" text NOT NULL,
	"requirement_hints" jsonb NOT NULL,
	"reference" jsonb NOT NULL,
	"difficulty" smallint NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_design_prompts_slug_unique" UNIQUE("slug"),
	CONSTRAINT "system_design_prompts_kind_check" CHECK ("system_design_prompts"."kind" IN ('hld','lld')),
	CONSTRAINT "system_design_prompts_status_check" CHECK ("system_design_prompts"."status" IN ('draft','published','archived'))
);
--> statement-breakpoint
ALTER TABLE "design_canvases" ADD CONSTRAINT "design_canvases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_canvases" ADD CONSTRAINT "design_canvases_prompt_id_system_design_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."system_design_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_canvases_user_idx" ON "design_canvases" USING btree ("user_id","updated_at");