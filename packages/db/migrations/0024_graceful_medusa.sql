CREATE TABLE "flashcard_decks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'custom' NOT NULL,
	"starter_slug" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flashcard_decks_starter_slug_unique" UNIQUE("starter_slug"),
	CONSTRAINT "flashcard_decks_kind_check" CHECK ("flashcard_decks"."kind" IN ('patterns','formulas','cs','behavioral','mistakes','custom')),
	CONSTRAINT "flashcard_decks_owner_check" CHECK ("flashcard_decks"."owner_id" IS NOT NULL OR "flashcard_decks"."starter_slug" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "flashcard_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"quality" smallint NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"reviewed_on" date NOT NULL,
	"prev_interval" integer DEFAULT 0 NOT NULL,
	"new_interval" integer DEFAULT 0 NOT NULL,
	"was_new" boolean DEFAULT false NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flashcard_reviews_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "flashcard_reviews_quality_check" CHECK ("flashcard_reviews"."quality" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "flashcards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deck_id" uuid NOT NULL,
	"type" text DEFAULT 'basic' NOT NULL,
	"front_md" text NOT NULL,
	"back_md" text DEFAULT '' NOT NULL,
	"origin_type" text,
	"origin_id" uuid,
	"ease" numeric(4, 2) DEFAULT '2.50' NOT NULL,
	"interval_days" integer DEFAULT 0 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"due_on" date NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flashcards_type_check" CHECK ("flashcards"."type" IN ('basic','cloze','code'))
);
--> statement-breakpoint
CREATE TABLE "shared_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"token_hash" text NOT NULL,
	"visibility" text DEFAULT 'unlisted' NOT NULL,
	"options" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_reports_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "shared_reports_type_check" CHECK ("shared_reports"."entity_type" IN ('scorecard','contest','readiness')),
	CONSTRAINT "shared_reports_visibility_check" CHECK ("shared_reports"."visibility" IN ('unlisted','public'))
);
--> statement-breakpoint
ALTER TABLE "flashcard_decks" ADD CONSTRAINT "flashcard_decks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_reviews" ADD CONSTRAINT "flashcard_reviews_card_id_flashcards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."flashcards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_reviews" ADD CONSTRAINT "flashcard_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_deck_id_flashcard_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."flashcard_decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_reports" ADD CONSTRAINT "shared_reports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flashcard_decks_owner_idx" ON "flashcard_decks" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "flashcard_reviews_user_day_idx" ON "flashcard_reviews" USING btree ("user_id","reviewed_on");--> statement-breakpoint
CREATE INDEX "flashcard_reviews_card_idx" ON "flashcard_reviews" USING btree ("card_id","reviewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "flashcards_deck_due_idx" ON "flashcards" USING btree ("deck_id","due_on");--> statement-breakpoint
CREATE INDEX "flashcards_origin_idx" ON "flashcards" USING btree ("origin_type","origin_id");--> statement-breakpoint
CREATE INDEX "shared_reports_owner_idx" ON "shared_reports" USING btree ("owner_id","created_at" DESC NULLS LAST);