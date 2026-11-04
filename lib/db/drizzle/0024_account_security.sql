-- Migration: two-factor sign-in, per-browser member sessions, recovery codes,
-- API key creators and audit actors (docs/SECURITY_AND_ACCESS_HANDOFF.md). Additive.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "require_mfa" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "totp_secret" text;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "totp_enabled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "totp_last_step" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "member_id" text NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_agent" text,
  "ip_address" text,
  "method" text DEFAULT 'password' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_member_sessions_member" ON "member_sessions" ("member_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_recovery_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "member_id" text NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_recovery_codes_member" ON "member_recovery_codes" ("member_id");
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "created_by_member_id" text;
--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "actor_name" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_log_user_created" ON "activity_log" ("user_id", "created_at");
