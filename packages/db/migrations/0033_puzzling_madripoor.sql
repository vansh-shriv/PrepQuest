CREATE TABLE "peer_availability" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"prefs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_availability_order_check" CHECK ("peer_availability"."ends_at" > "peer_availability"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "peer_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"blocked_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_blocks_pair_key" UNIQUE("user_id","blocked_user_id"),
	CONSTRAINT "peer_blocks_distinct_check" CHECK ("peer_blocks"."user_id" <> "peer_blocks"."blocked_user_id")
);
--> statement-breakpoint
CREATE TABLE "peer_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"from_user" uuid NOT NULL,
	"to_user" uuid NOT NULL,
	"ratings" jsonb NOT NULL,
	"comments" text NOT NULL,
	"nudges" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_feedback_session_from_key" UNIQUE("session_id","from_user")
);
--> statement-breakpoint
CREATE TABLE "peer_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"topic" text NOT NULL,
	"difficulty" smallint NOT NULL,
	"minutes" smallint NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "peer_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reported_id" uuid NOT NULL,
	"session_id" uuid,
	"reason" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_reports_reason_check" CHECK ("peer_reports"."reason" IN ('abuse','harassment','cheating','no_show','other')),
	CONSTRAINT "peer_reports_status_check" CHECK ("peer_reports"."status" IN ('open','reviewed'))
);
--> statement-breakpoint
CREATE TABLE "peer_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"a_user" uuid NOT NULL,
	"b_user" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"minutes" smallint NOT NULL,
	"topic" text NOT NULL,
	"difficulty" smallint NOT NULL,
	"source" text NOT NULL,
	"state" text DEFAULT 'scheduled' NOT NULL,
	"first_candidate" text NOT NULL,
	"questions" jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"cancelled_by" uuid,
	"no_show_user" uuid,
	"a_consent_ai" boolean DEFAULT false NOT NULL,
	"b_consent_ai" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_sessions_distinct_check" CHECK ("peer_sessions"."a_user" <> "peer_sessions"."b_user"),
	CONSTRAINT "peer_sessions_source_check" CHECK ("peer_sessions"."source" IN ('match','invite')),
	CONSTRAINT "peer_sessions_state_check" CHECK ("peer_sessions"."state" IN ('scheduled','live','completed','cancelled','no_show')),
	CONSTRAINT "peer_sessions_first_check" CHECK ("peer_sessions"."first_candidate" IN ('a','b'))
);
--> statement-breakpoint
ALTER TABLE "peer_availability" ADD CONSTRAINT "peer_availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_blocks" ADD CONSTRAINT "peer_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_blocks" ADD CONSTRAINT "peer_blocks_blocked_user_id_users_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_feedback" ADD CONSTRAINT "peer_feedback_session_id_peer_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."peer_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_feedback" ADD CONSTRAINT "peer_feedback_from_user_users_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_feedback" ADD CONSTRAINT "peer_feedback_to_user_users_id_fk" FOREIGN KEY ("to_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_invites" ADD CONSTRAINT "peer_invites_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_invites" ADD CONSTRAINT "peer_invites_session_id_peer_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."peer_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reports" ADD CONSTRAINT "peer_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reports" ADD CONSTRAINT "peer_reports_reported_id_users_id_fk" FOREIGN KEY ("reported_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reports" ADD CONSTRAINT "peer_reports_session_id_peer_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."peer_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sessions" ADD CONSTRAINT "peer_sessions_a_user_users_id_fk" FOREIGN KEY ("a_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sessions" ADD CONSTRAINT "peer_sessions_b_user_users_id_fk" FOREIGN KEY ("b_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sessions" ADD CONSTRAINT "peer_sessions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sessions" ADD CONSTRAINT "peer_sessions_no_show_user_users_id_fk" FOREIGN KEY ("no_show_user") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peer_availability_user_idx" ON "peer_availability" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "peer_availability_window_idx" ON "peer_availability" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "peer_feedback_to_idx" ON "peer_feedback" USING btree ("to_user");--> statement-breakpoint
CREATE INDEX "peer_invites_owner_idx" ON "peer_invites" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "peer_reports_reported_idx" ON "peer_reports" USING btree ("reported_id");--> statement-breakpoint
CREATE INDEX "peer_sessions_a_idx" ON "peer_sessions" USING btree ("a_user","scheduled_at");--> statement-breakpoint
CREATE INDEX "peer_sessions_b_idx" ON "peer_sessions" USING btree ("b_user","scheduled_at");