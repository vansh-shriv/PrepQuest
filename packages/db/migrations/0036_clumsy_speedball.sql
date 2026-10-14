ALTER TABLE "peer_sessions" ADD COLUMN "room_state" text;--> statement-breakpoint
ALTER TABLE "peer_sessions" ADD COLUMN "suggest_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "peer_sessions" ADD COLUMN "suggest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "peer_sessions" ADD COLUMN "suggested" jsonb DEFAULT '[]'::jsonb NOT NULL;