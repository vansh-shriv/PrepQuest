CREATE TABLE "integrity_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"contest_id" uuid,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"score" numeric(5, 4),
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"decision_note" text,
	"appeal_text" text,
	"appealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrity_flags_subject_kind_key" UNIQUE("subject_type","subject_id","kind"),
	CONSTRAINT "integrity_flags_kind_check" CHECK ("integrity_flags"."kind" IN ('similarity','paste','focus')),
	CONSTRAINT "integrity_flags_severity_check" CHECK ("integrity_flags"."severity" IN ('low','medium','high')),
	CONSTRAINT "integrity_flags_status_check" CHECK ("integrity_flags"."status" IN ('open','confirmed','dismissed','escalated','appealed'))
);
--> statement-breakpoint
ALTER TABLE "contest_participants" ADD COLUMN "disqualified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD CONSTRAINT "integrity_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD CONSTRAINT "integrity_flags_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD CONSTRAINT "integrity_flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integrity_flags_status_idx" ON "integrity_flags" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "integrity_flags_user_idx" ON "integrity_flags" USING btree ("user_id");