ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_user_id_idx" ON "activity_log" ("user_id");
